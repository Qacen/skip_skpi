#!/usr/bin/env python3
"""Evaluate the recognition service the way the organiser's scoring script does: send photos one by one to
POST /api/predict (multipart "file"), the service answers {"slug": "..."}, time each request and compare the
slug to ground truth. Also calls POST /api/wines/search-by-photo (same photo) to read confidence.top5 for R@5 / F1@5
-> these two calls together give everything the organiser's script + our own top-5 metrics need, without touching
the ML service directly. stdlib only (urllib); no install required.

Ground truth: wine_seg/runs/rp/evalds/rp_eval.csv (columns: photo_id, file, subset, target_slug, alt_slugs, ...).
A prediction is a HIT if it equals target_slug or is listed in alt_slugs (same wine under a different catalog entry).

Metrics per subset (exact | probable | same_line) and overall:
  accuracy@1  - доля совпадений (hit1 / n)
  R@5         - доля попаданий в топ-5 (hit5 / n)
  F1@1        - macro F1 over the target slugs seen in that subset, sklearn-equivalent to
                f1_score(y_true, y_pred, average='macro', labels=sorted(set(target_slug))); to stay consistent with the
                hit1/alt_slugs definition above, a HIT's y_pred is normalized to target_slug (an alt-slug match is not a
                different class, it is the same wine), a MISS keeps the service's actual top-1 slug as y_pred.
  F1@5        - the same macro-F1, but "correct" means hit5 (target in top-5) instead of an exact top-1 match; a MISS
                still uses the service's top-1 slug as the (wrong) predicted class, since F1 needs one label per photo.
  latency     - p50/p90/max/mean wall time of the /api/predict call, ms
  errors      - requests that raised (timeout, non-200, bad JSON)

Usage:
  python3 web/scripts/eval_service.py --subset exact
  python3 web/scripts/eval_service.py --subset all --limit 20
  python3 web/scripts/eval_service.py --url http://localhost:3000 --labels wine_seg/runs/rp/evalds/rp_eval.csv --photos wine_seg/runs/rp

Writes web/data/metrics.json (read by GET /api/metrics -> app/pages/metrics.vue) and prints a markdown summary table.
"""
import argparse
import csv
import json
import mimetypes
import statistics
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]          # /Users/stanislav/lct
WEB = Path(__file__).resolve().parents[1]            # /Users/stanislav/lct/web
DEFAULT_LABELS = ROOT / 'wine_seg' / 'runs' / 'rp' / 'evalds' / 'rp_eval.csv'
DEFAULT_PHOTOS = ROOT / 'wine_seg' / 'runs' / 'rp'
SUBSETS = ['exact', 'probable', 'same_line']


def post_multipart(url: str, field: str, path: Path, timeout: float):
    """POST one file as multipart/form-data with the stdlib only. Returns (json_or_None, elapsed_ms, error_or_None)."""
    boundary = uuid.uuid4().hex
    ctype = mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
    head = (f'--{boundary}\r\nContent-Disposition: form-data; name="{field}"; filename="{path.name}"\r\n'
            f'Content-Type: {ctype}\r\n\r\n').encode()
    body = head + path.read_bytes() + f'\r\n--{boundary}--\r\n'.encode()
    req = urllib.request.Request(url, data=body, method='POST',
                                  headers={'Content-Type': f'multipart/form-data; boundary={boundary}'})
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
        ms = (time.perf_counter() - t0) * 1000
        return json.loads(raw), ms, None
    except Exception as e:                                            # timeout, HTTPError, connection error, bad JSON
        ms = (time.perf_counter() - t0) * 1000
        return None, ms, f'{type(e).__name__}: {e}'


def ml_model(url: str) -> str | None:
    """GET /api/ml/status -> the active backend's model name, if reachable."""
    try:
        with urllib.request.urlopen(f'{url}/api/ml/status', timeout=5) as resp:
            status = json.loads(resp.read())
        ok = next((e for e in status.get('endpoints', []) if e.get('ok')), None)
        return ok.get('model') if ok else None
    except Exception:
        return None


def pctl(values: list[float], p: float) -> float | None:
    if not values:
        return None
    s = sorted(values)
    k = (len(s) - 1) * p
    lo, hi = int(k), min(int(k) + 1, len(s) - 1)
    return s[lo] if lo == hi else s[lo] + (s[hi] - s[lo]) * (k - lo)


def f1_macro(pairs: list[tuple[str, str]], labels: list[str]) -> float:
    """sklearn-equivalent f1_score(y_true, y_pred, average='macro', labels=labels), zero_division=0, no sklearn dep."""
    if not labels:
        return 0.0
    scores = []
    for label in labels:
        tp = sum(1 for t, p in pairs if t == label and p == label)
        fp = sum(1 for t, p in pairs if t != label and p == label)
        fn = sum(1 for t, p in pairs if t == label and p != label)
        prec = tp / (tp + fp) if (tp + fp) else 0.0
        rec = tp / (tp + fn) if (tp + fn) else 0.0
        scores.append(2 * prec * rec / (prec + rec) if (prec + rec) else 0.0)
    return sum(scores) / len(scores)


def summarize(entries: list[dict]) -> dict:
    n = len(entries)
    hit1 = sum(1 for e in entries if e['hit1'])
    hit5 = sum(1 for e in entries if e['hit5'])
    labels = sorted({e['target'] for e in entries})
    pairs1 = [(e['target'], e['target'] if e['hit1'] else (e['pred'] or '')) for e in entries]
    pairs5 = [(e['target'], e['target'] if e['hit5'] else (e['pred'] or '')) for e in entries]
    times = [e['ms'] for e in entries if e['ms'] is not None and not e['error']]
    return {
        'n': n,
        'accuracy_at1': hit1 / n if n else 0.0,
        'recall_at5': hit5 / n if n else 0.0,
        'f1_at1': f1_macro(pairs1, labels),
        'f1_at5': f1_macro(pairs5, labels),
        'latency_ms': {
            'p50': pctl(times, 0.5), 'p90': pctl(times, 0.9),
            'max': max(times) if times else None,
            'mean': statistics.fmean(times) if times else None,
        },
        'errors': sum(1 for e in entries if e['error']),
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--url', default='http://localhost:3000', help='site base URL (default: %(default)s)')
    ap.add_argument('--labels', default=str(DEFAULT_LABELS), help='ground-truth CSV (default: %(default)s)')
    ap.add_argument('--photos', default=str(DEFAULT_PHOTOS), help='folder with the photo files (default: %(default)s)')
    ap.add_argument('--subset', choices=[*SUBSETS, 'all'], default='all', help='which rows to evaluate (default: %(default)s)')
    ap.add_argument('--limit', type=int, default=None, help='cap the number of photos (after --subset filtering)')
    ap.add_argument('--timeout', type=float, default=30.0, help='per-request timeout, seconds (default: %(default)s)')
    ap.add_argument('--out', default=str(WEB / 'data' / 'metrics.json'), help='output JSON path')
    args = ap.parse_args()

    labels_path, photos_dir = Path(args.labels), Path(args.photos)
    with open(labels_path, encoding='utf-8') as f:
        rows = list(csv.DictReader(f))
    if args.subset != 'all':
        rows = [r for r in rows if r['subset'] == args.subset]
    if args.limit:
        rows = rows[:args.limit]
    if not rows:
        sys.exit(f'no rows to evaluate (labels={labels_path}, subset={args.subset})')

    model = ml_model(args.url)
    print(f'evaluating {len(rows)} photos against {args.url} (model: {model or "?"})', file=sys.stderr)

    per_photo = []
    for i, row in enumerate(rows, 1):
        photo = photos_dir / row['file']
        target = row['target_slug']
        alts = {a.strip() for a in (row.get('alt_slugs') or '').split(',') if a.strip()}
        accept = {target} | alts

        pred_body, ms, err = post_multipart(f'{args.url}/api/predict', 'file', photo, args.timeout)
        pred = (pred_body or {}).get('slug') or ''

        search_body, _, serr = post_multipart(f'{args.url}/api/wines/search-by-photo', 'file', photo, args.timeout)
        if search_body and not serr:
            top5 = [c.get('slug') for c in ((search_body.get('confidence') or {}).get('top5') or [])]
        else:
            top5 = [pred] if pred else []                              # search failed -> fall back to /predict's answer

        hit1 = bool(pred) and pred in accept
        hit5 = any(s in accept for s in top5)
        per_photo.append({
            'photo_id': row['photo_id'], 'subset': row['subset'], 'target': target, 'pred': pred, 'top5': top5,
            'hit1': hit1, 'hit5': hit5, 'ms': round(ms, 1), 'error': err,
        })
        status = 'OK ' if hit1 else ('~5 ' if hit5 else 'MISS')
        print(f'[{i}/{len(rows)}] {row["photo_id"]} {status} {pred or "?"} vs {target} ({ms:.0f} ms)'
              + (f'  ! {err}' if err else ''), file=sys.stderr)

    subsets = {s: summarize([e for e in per_photo if e['subset'] == s]) for s in SUBSETS if any(e['subset'] == s for e in per_photo)}
    overall = summarize(per_photo)

    out = {
        'generated_at': datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z'),
        'url': args.url, 'model': model, 'subset_arg': args.subset,
        'subsets': subsets, 'overall': overall, 'per_photo': per_photo,
    }
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'\nwrote {out_path}', file=sys.stderr)

    def row_md(name, m):
        lat = m['latency_ms']
        return (f"| {name} | {m['n']} | {m['accuracy_at1']:.1%} | {m['recall_at5']:.1%} | {m['f1_at1']:.3f} | {m['f1_at5']:.3f} | "
                f"{lat['p50']:.0f} | {lat['p90']:.0f} | {lat['max']:.0f} | {m['errors']} |" if lat['p50'] is not None else
                f"| {name} | {m['n']} | {m['accuracy_at1']:.1%} | {m['recall_at5']:.1%} | {m['f1_at1']:.3f} | {m['f1_at5']:.3f} | - | - | - | {m['errors']} |")

    print('\n| subset | n | acc@1 | R@5 | F1@1 | F1@5 | p50 ms | p90 ms | max ms | errors |')
    print('|---|---|---|---|---|---|---|---|---|---|')
    for s in SUBSETS:
        if s in subsets:
            print(row_md(s, subsets[s]))
    print(row_md('overall', overall))


if __name__ == '__main__':
    main()
