#!/usr/bin/env python3
"""Build per-wine "extra" enrichment JSONs for the catalog from the winedb + amwine datasets.

Inputs (read-only):
  /Users/stanislav/lct/web/data/catalog.json                       catalog slugs (2105 wines)
  /Users/stanislav/lct/winedb/out/wines_master.jsonl                merged wine records (svo_slugs, vintages, ...)
  /Users/stanislav/lct/winedb/out/wine_sources.csv                  per-source records (price/taste/aroma/awards + url, keyed by wine_id)
  /Users/stanislav/lct/winedb/out/wineries_master.csv                winery directory (license, vineyard_ha, contacts)
  /Users/stanislav/lct/amwine/match/final/amwine_svo_matches.csv     amwine sku <-> svo_slug matches (status/relation/confidence)
  /Users/stanislav/lct/amwine/match/final/amwine_reviews_matched.parquet   58k amwine reviews, already resolved to svo_slug

Output:
  /Users/stanislav/lct/web/data/extra/<slug>.json   one file per catalog slug that has >=1 non-empty block
  /Users/stanislav/lct/web/data/extra/_stats.json   coverage counters

Usage (needs pandas+pyarrow to read the amwine reviews parquet):
  python3 /Users/stanislav/lct/web/scripts/build_extra.py
  (NOTE: /Users/stanislav/lct/ml/.venv/bin/python does NOT have pandas/pyarrow installed, despite the
   task brief assuming it does -- see caveats printed at the end of the run / in the report. This script
   was run with the system python3 (/Library/Frameworks/Python.framework/Versions/3.14/bin/python3),
   which does have pandas 3.0.0 + pyarrow 23.0.1. It never touches /Users/stanislav/lct/ml.)
"""
import csv
import json
import pathlib
import re
import statistics
import sys
from collections import defaultdict

WEB = pathlib.Path("/Users/stanislav/lct/web")
CATALOG = WEB / "data" / "catalog.json"
OUT_DIR = WEB / "data" / "extra"

WINEDB = pathlib.Path("/Users/stanislav/lct/winedb/out")
WINES_MASTER = WINEDB / "wines_master.jsonl"
WINE_SOURCES = WINEDB / "wine_sources.csv"
WINERIES_MASTER = WINEDB / "wineries_master.csv"

AMWINE = pathlib.Path("/Users/stanislav/lct/amwine/match/final")
AMWINE_MATCHES = AMWINE / "amwine_svo_matches.csv"
AMWINE_REVIEWS = AMWINE / "amwine_reviews_matched.parquet"

SRC_LABELS = {
    "rbc_guide": "РБК Вино",
    "top100": "Топ-100 российских вин",
    "swn": "Simple Wine News",
    "krasnostop": "Красностоп",
    "amwine": "AMWINE",
    "winery_dirs": "Каталог виноделен",
    "winery_sites": "Сайт винодельни",
    "russianvine": "RussianVine",
    "small_shops": "Винный магазин",
    "globus_vinofan": "Глобус Винофан",
    "vino_svoe": "Своё Вино",
}

YEAR_RE = re.compile(r"(19|20)\d{2}")
LEGAL_TOKENS = {
    "ооо", "оао", "зао", "пао", "ип", "кфх", "гуп", "муп", "нко", "тов",
    "ao", "oao", "ooo", "zao", "pao", "llc", "ltd", "gmbh", "plc", "sa", "srl", "co", "inc",
}


# ---------------------------------------------------------------- helpers --

def parse_price(raw):
    """'1 399,00 ₽' / '299.0' / '1800' -> float rubles, or None if missing/garbage."""
    if not raw:
        return None
    s = raw.replace("\xa0", " ")
    s = re.sub(r"[₽\s]", "", s)
    s = s.replace(",", ".")
    if not s:
        return None
    try:
        val = float(s)
    except ValueError:
        return None
    if val < 150 or val > 200000:
        return None
    return round(val, 2)


HTML_TAG_RE = re.compile(r"<[a-zA-Z/][^>]{0,300}>")


def strip_html(s):
    if not s or "<" not in s:
        return s or ""
    import html as _html
    s = HTML_TAG_RE.sub(" ", s)
    return _html.unescape(s)


def trim_text(s, limit):
    s = " ".join(strip_html(s).split())
    if len(s) <= limit:
        return s
    cut = s[:limit]
    if " " in cut:
        cut = cut[: cut.rfind(" ")]
    return cut.rstrip(",.;:- ") + "…"


def extract_year(s):
    m = YEAR_RE.search(s)
    return int(m.group()) if m else None


def award_sort_key(s):
    y = extract_year(s)
    return (0, -y) if y else (1, 0)


def dedupe_awards(raw_list):
    seen = {}
    order = []
    for s in raw_list:
        s = s.strip()
        if not s:
            continue
        key = re.sub(r"\s+", " ", s.lower())
        if key not in seen:
            seen[key] = s
            order.append(key)
    uniq = [seen[k] for k in order]
    drop = set()
    for i, a in enumerate(uniq):
        an = re.sub(r"\s+", " ", a.lower())
        for j, b in enumerate(uniq):
            if i == j:
                continue
            bn = re.sub(r"\s+", " ", b.lower())
            if an != bn and an in bn and len(a) < len(b):
                drop.add(i)
                break
    result = [a for i, a in enumerate(uniq) if i not in drop]
    result.sort(key=award_sort_key)
    return result[:12]


def normalize_org(s):
    if not s:
        return ""
    s = s.lower().replace("ё", "е")
    s = re.sub(r"[«»\"'’“”]", " ", s)
    s = re.sub(r"[^\w\s]", " ", s, flags=re.UNICODE)
    s = re.sub(r"\s+", " ", s).strip()
    tokens = [t for t in s.split(" ") if t and t not in LEGAL_TOKENS]
    return " ".join(tokens)


def parse_vineyard_ha(raw):
    if not raw:
        return None
    vals = []
    for p in raw.split(";"):
        p = p.strip().lower().replace("\xa0", " ")
        for word in ("гектаров", "гектар", "га", "около"):
            p = p.replace(word, "")
        p = p.strip()
        p = re.sub(r"(?<=\d) (?=\d)", "", p)  # drop thousands-separator spaces
        p = p.replace(",", ".")
        p = re.sub(r"[^\d.]", "", p)
        if not p:
            continue
        try:
            v = float(p)
        except ValueError:
            continue
        if 0 < v <= 100000:
            vals.append(v)
    if not vals:
        return None
    return round(statistics.median(vals), 2)


def parse_regions(raw):
    if not raw:
        return []
    out, seen = [], set()
    for p in raw.split(";"):
        p = p.strip()
        if not p or re.fullmatch(r"\d{1,3}", p):
            continue
        k = p.lower()
        if k in seen:
            continue
        seen.add(k)
        out.append(p)
    return out[:6]


def first_field(raw, prefer_prefix=None):
    parts = [p.strip() for p in (raw or "").split(";") if p.strip()]
    if not parts:
        return None
    if prefer_prefix:
        pref = [p for p in parts if p.startswith(prefer_prefix)]
        if pref:
            return pref[0]
    return parts[0]


# ------------------------------------------------------------------ load --

def load_catalog():
    return json.loads(CATALOG.read_text(encoding="utf-8"))


def load_wines_master():
    """-> slug_to_wine_id, wine_id_to_vintages, wine_id_to_producer_key"""
    slug_to_wine_id = {}
    wine_id_to_vintages = {}
    wine_id_to_pkey = {}
    with open(WINES_MASTER, encoding="utf-8") as f:
        for line in f:
            d = json.loads(line)
            wid = d["wine_id"]
            wine_id_to_vintages[wid] = d.get("vintages") or []
            wine_id_to_pkey[wid] = d.get("producer_key") or ""
            for s in d.get("svo_slugs") or []:
                slug_to_wine_id[s] = wid  # verified 1:1 (no slug maps to >1 wine_id)
    return slug_to_wine_id, wine_id_to_vintages, wine_id_to_pkey


def load_wine_sources():
    """-> wine_id -> list of {src,url,price_rub(parsed),taste,aroma,awards(list),vintage}"""
    by_wine = defaultdict(list)
    with open(WINE_SOURCES, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            wid = row.get("wine_id")
            if not wid:
                continue
            by_wine[wid].append({
                "src": row.get("src") or "",
                "url": (row.get("url") or "").strip(),
                "price": parse_price(row.get("price_rub")),
                "taste": (row.get("taste") or "").strip(),
                "aroma": (row.get("aroma") or "").strip(),
                "awards": [a.strip() for a in (row.get("awards") or "").split(";") if a.strip()],
                "vintage": (row.get("vintage") or "").strip(),
            })
    return by_wine


JUNK_INN_THRESHOLD = 15  # rows with more distinct INNs than this are catch-all merge buckets
# (winedb's wineries_master has a handful of rows -- e.g. "Валерий Захарьин" with 245 INNs --
#  where the dedup pipeline lumped many unrelated wineries' legal_names/inns together under one
#  placeholder row; a real single winery never has this many legal entities). We keep such a row's
#  own display `name` in the fallback index (that part is reliable) but never its legal_names list,
#  which is what was producing false "unambiguous" matches like "Château Le Grand Vostock" -> that bucket.


def load_wineries():
    """-> winery_by_key (winery_key -> row), name_index (normalized name -> set(winery_id))"""
    winery_by_key = {}
    winery_by_id = {}
    name_index = defaultdict(set)
    with open(WINERIES_MASTER, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            wid = row["winery_id"]
            winery_by_id[wid] = row
            if row.get("winery_key"):
                winery_by_key[row["winery_key"]] = row
            n_inns = len([x for x in (row.get("inns") or "").split(";") if x.strip()])
            names = [row.get("name") or ""]
            if n_inns <= JUNK_INN_THRESHOLD:
                names += [n.strip() for n in (row.get("legal_names") or "").split(";") if n.strip()]
            for nm in names:
                key = normalize_org(nm)
                if key:
                    name_index[key].add(wid)
    return winery_by_key, winery_by_id, name_index


def load_amwine_matches():
    """-> slug -> list of {sku, relation, confidence, is_primary, amw_url}, restricted to status=matched
    and relation in {exact, vintage_unclear}. `relation` is pipe-joined and lines up positionally with
    [svo_slug, also_slugs] when the counts match; when only one relation is given it is treated as
    applying to every listed slug (the data never has more than one also_slug). When a row has a single
    slug but >1 pipe-joined relation, the parts are NOT per-slug: they are two independent raters'
    verdicts on that same slug (confirmed via the CSV's v1/v2 columns, which are always equal to each
    other and to the single slug in this case) -- so the most favorable verdict is used instead of
    arbitrarily the first, otherwise a real match gets dropped whenever the stricter rater happens to
    be listed first (verified against the data: 7 skus / several slugs were wrongly excluded this way)."""
    out = defaultdict(list)
    with open(AMWINE_MATCHES, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row.get("status") != "matched":
                continue
            svo_slug = (row.get("svo_slug") or "").strip()
            also = (row.get("also_slugs") or "").strip()
            slugs = ([svo_slug] if svo_slug else []) + ([also] if also else [])
            if not slugs:
                continue
            parts = [p.strip() for p in (row.get("relation") or "").split("|") if p.strip()]
            if len(parts) == len(slugs):
                pairs = list(zip(slugs, parts))
            elif len(parts) == 1:
                pairs = [(s, parts[0]) for s in slugs]
            elif len(slugs) == 1 and parts:
                best = "exact" if "exact" in parts else ("vintage_unclear" if "vintage_unclear" in parts else parts[0])
                pairs = [(slugs[0], best)]
            elif parts:
                pairs = [(slugs[0], parts[0])]
            else:
                pairs = []
            for slug, relation in pairs:
                if relation not in ("exact", "vintage_unclear"):
                    continue
                out[slug].append({
                    "sku": row.get("sku"),
                    "relation": relation,
                    "confidence": row.get("confidence") or "",
                    "is_primary": slug == svo_slug,
                    "amw_url": row.get("amw_url") or None,
                })
    return out


def load_amwine_reviews():
    try:
        import pandas as pd
    except ImportError:
        sys.exit(
            "ERROR: pandas is required to read amwine_reviews_matched.parquet.\n"
            "The venv named in the task (/Users/stanislav/lct/ml/.venv) does NOT have pandas/pyarrow "
            "installed. Re-run this script with an interpreter that does, e.g. system python3."
        )
    df = pd.read_parquet(AMWINE_REVIEWS)
    by_sku = defaultdict(list)
    for row in df.itertuples(index=False):
        sku = str(row.sku)
        date = row.date if isinstance(row.date, str) and row.date else None
        text = row.text if isinstance(row.text, str) else ""
        author = row.author if isinstance(row.author, str) else ""
        by_sku[sku].append({
            "date": date,
            "rating": int(row.rating),
            "text": text.strip(),
            "author": author.strip(),
        })
    return by_sku


# -------------------------------------------------------------- builders --

def build_awards(rows):
    raw = []
    for r in rows:
        raw.extend(r["awards"])
    return dedupe_awards(raw)


def build_prices(rows):
    per_src_min = {}  # src -> (price, url)
    all_prices = []
    for r in rows:
        if r["price"] is None or r["src"] not in SRC_LABELS:
            continue
        all_prices.append(r["price"])
        cur = per_src_min.get(r["src"])
        if cur is None or r["price"] < cur[0]:
            per_src_min[r["src"]] = (r["price"], r["url"])
    if not all_prices:
        return None
    offers = sorted(
        ({"label": SRC_LABELS[src], "price": p, "url": u} for src, (p, u) in per_src_min.items() if u),
        key=lambda o: o["price"],
    )[:5]
    return {
        "min": round(min(all_prices), 2),
        "max": round(max(all_prices), 2),
        "currency": "RUB",
        "offers": offers,
    }


def build_notes(rows):
    notes = []
    for kind in ("taste", "aroma"):
        best_per_src = {}
        for r in rows:
            if r["src"] == "vino_svoe" or r["src"] not in SRC_LABELS:
                continue
            text = r[kind]
            if len(text) < 20:
                continue
            cur = best_per_src.get(r["src"])
            if cur is None or len(text) > len(cur[0]):
                best_per_src[r["src"]] = (text, r["url"])
        candidates = sorted(best_per_src.items(), key=lambda kv: len(kv[1][0]), reverse=True)
        for src, (text, url) in candidates[:2]:
            notes.append({
                "kind": kind,
                "label": SRC_LABELS[src],
                "url": url or None,
                "text": trim_text(text, 600),
            })
    return notes


def build_vintages(rows, wm_vintages):
    years = set()
    for y in wm_vintages:
        if re.fullmatch(r"\d{4}", str(y)) and 1990 <= int(y) <= 2026:
            years.add(str(y))
    for r in rows:
        v = r["vintage"]
        if re.fullmatch(r"\d{4}", v) and 1990 <= int(v) <= 2026:
            years.add(v)
    return sorted(years)


def build_reviews(slug, amwine_candidates, sku_to_reviews):
    cands = amwine_candidates.get(slug)
    if not cands:
        return None
    skus = {}
    for c in cands:
        skus.setdefault(c["sku"], c)
    all_reviews = []
    for sku in skus:
        all_reviews.extend(sku_to_reviews.get(sku, []))
    if not all_reviews:
        return None
    n = len(all_reviews)
    avg = round(sum(r["rating"] for r in all_reviews) / n, 2)

    conf_rank = {"high": 3, "medium": 2, "low": 1, "": 0}
    best = sorted(cands, key=lambda c: (c["is_primary"], conf_rank.get(c["confidence"], 0)), reverse=True)[0]
    url = best["amw_url"]

    dated = sorted((r for r in all_reviews if r["date"] and r["text"]), key=lambda r: r["date"], reverse=True)
    undated = [r for r in all_reviews if not r["date"] and r["text"]]
    long_dated = [r for r in dated if len(r["text"]) >= 40]
    pool = list(long_dated[:5])
    if len(pool) < 5:
        chosen = set(id(r) for r in pool)
        pool += [r for r in dated if id(r) not in chosen][: 5 - len(pool)]
    if len(pool) < 5:
        chosen = set(id(r) for r in pool)
        pool += [r for r in undated if len(r["text"]) >= 40 and id(r) not in chosen][: 5 - len(pool)]
    if len(pool) < 5:
        chosen = set(id(r) for r in pool)
        pool += [r for r in undated if id(r) not in chosen][: 5 - len(pool)]
    pool.sort(key=lambda r: r["date"] or "", reverse=True)

    items = [{
        "author": r["author"] or "Аноним",
        "date": r["date"][:10] if r["date"] else "",
        "rating": r["rating"],
        "text": trim_text(r["text"], 500),
    } for r in pool[:5]]

    return {"source": "AMWINE", "url": url, "n": n, "avg": avg, "items": items}


def build_winery(producer_key, manufacturer, winery_by_key, winery_by_id, name_index):
    row = None
    if producer_key and producer_key in winery_by_key:
        row = winery_by_key[producer_key]
    else:
        cand_ids = name_index.get(normalize_org(manufacturer))
        if cand_ids and len(cand_ids) == 1:
            row = winery_by_id[next(iter(cand_ids))]
    if row is None and producer_key:
        # wines_master's producer_key and wineries_master's winery_key come from two
        # separate normalization passes in winedb and occasionally disagree only by a
        # trailing token (e.g. producer_key "inkermanski" vs winery_key "inkermanski
        # zmv" for the same winery). Recover these only when unambiguous (the prefix
        # resolves to a single winery_id) -- verified against the full dataset: this
        # recovers exactly 15 catalog slugs, all belonging to one real winery.
        prefix = producer_key + " "
        cand_rows = [r for k, r in winery_by_key.items() if k.startswith(prefix)]
        cand_ids = {r["winery_id"] for r in cand_rows}
        if len(cand_ids) == 1:
            row = cand_rows[0]
    if row is None:
        return None
    lic = row.get("license_active")
    license_active = {"True": True, "False": False}.get(lic)
    return {
        "name": row.get("name") or None,
        "license_active": license_active,
        "vineyard_ha": parse_vineyard_ha(row.get("vineyard_ha")),
        "website": first_field(row.get("websites"), prefer_prefix="https://"),
        "phone": first_field(row.get("phones")),
        "regions": parse_regions(row.get("regions")),
        "inn": first_field(row.get("inns")),
    }


# -------------------------------------------------------------------- main --

def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for f in OUT_DIR.glob("*.json"):  # clear stale output so reruns are reproducible (no orphan files)
        f.unlink()

    catalog = load_catalog()
    slug_to_wine_id, wine_id_to_vintages, wine_id_to_pkey = load_wines_master()
    wine_sources = load_wine_sources()
    winery_by_key, winery_by_id, name_index = load_wineries()
    amwine_candidates = load_amwine_matches()
    sku_to_reviews = load_amwine_reviews()

    stats = defaultdict(int)
    stats["total_slugs"] = len(catalog)

    for w in catalog:
        slug = w["slug"]
        wid = slug_to_wine_id.get(slug)
        rows = wine_sources.get(wid, []) if wid else []

        extra = {}

        awards = build_awards(rows)
        if awards:
            extra["awards"] = awards
            stats["awards"] += 1

        prices = build_prices(rows)
        if prices:
            extra["prices"] = prices
            stats["prices"] += 1
            if prices["offers"]:
                stats["prices_with_offers"] += 1

        notes = build_notes(rows)
        if notes:
            extra["notes"] = notes
            stats["notes"] += 1

        vintages = build_vintages(rows, wine_id_to_vintages.get(wid, []))
        if vintages:
            extra["vintages"] = vintages
            stats["vintages"] += 1

        reviews = build_reviews(slug, amwine_candidates, sku_to_reviews)
        if reviews:
            extra["reviews"] = reviews
            stats["reviews"] += 1
            if reviews["items"]:
                stats["reviews_with_items"] += 1

        winery = build_winery(wine_id_to_pkey.get(wid, ""), w.get("manufacturer", ""), winery_by_key, winery_by_id, name_index)
        if winery:
            extra["winery"] = winery
            stats["winery"] += 1

        if extra:
            (OUT_DIR / f"{slug}.json").write_text(
                json.dumps(extra, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            stats["files_written"] += 1

    stats_out = dict(sorted(stats.items()))
    (OUT_DIR / "_stats.json").write_text(json.dumps(stats_out, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"catalog slugs           {stats['total_slugs']}")
    print(f"files written            {stats['files_written']}")
    print(f"  awards                 {stats['awards']}")
    print(f"  prices                 {stats['prices']}  (with offers: {stats['prices_with_offers']})")
    print(f"  notes                  {stats['notes']}")
    print(f"  vintages               {stats['vintages']}")
    print(f"  reviews                {stats['reviews']}  (with items: {stats['reviews_with_items']})")
    print(f"  winery                 {stats['winery']}")


if __name__ == "__main__":
    main()
