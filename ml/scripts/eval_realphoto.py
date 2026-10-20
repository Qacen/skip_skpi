#!/usr/bin/env python3
"""End-to-end check of a RUNNING service on the real-photo eval set (87 photos): accuracy per subset + latency.

Works against a local server or the public Kaggle tunnel:
  python scripts/eval_realphoto.py --url http://127.0.0.1:8010 \
      --photos "~/Downloads/Реальные фото" --eval ../wine_seg/runs/rp/evalds/rp_eval.csv
Counts a hit when the top-1 slug is the target or one of its alt_slugs (other vintage / label version of the same wine).
"""
from __future__ import annotations

import argparse
import csv
import json
import statistics
import time
from pathlib import Path

import requests

ap = argparse.ArgumentParser()
ap.add_argument("--url", default="http://127.0.0.1:8010")
ap.add_argument("--photos", required=True)
ap.add_argument("--eval", required=True)
ap.add_argument("--endpoint", default="recognize", choices=["recognize", "predict"])
ap.add_argument("--limit", type=int, default=0)
ap.add_argument("--out", default="")
a = ap.parse_args()

rows = list(csv.DictReader(open(a.eval, encoding="utf-8")))
if a.limit:
    rows = rows[: a.limit]
photos = Path(a.photos).expanduser()
res = []
for r in rows:
    data = (photos / r["file"]).read_bytes()
    for attempt in range(5):  # tolerate a flaky tunnel / DNS for a moment
        try:
            t0 = time.perf_counter()
            resp = requests.post(f"{a.url.rstrip('/')}/{a.endpoint}", files={"file": (r["file"], data, "image/webp")}, timeout=60)
            wall = (time.perf_counter() - t0) * 1000
            break
        except requests.exceptions.ConnectionError:
            if attempt == 4:
                raise
            time.sleep(3)
    resp.raise_for_status()
    j = resp.json()
    ok = {r["target_slug"], *[s for s in r["alt_slugs"].split(",") if s]}
    if a.endpoint == "predict":
        top = [j.get("slug") or ""]
        status, server_ms = ("found" if top[0] else "not_found"), None
        cos1 = margin = None
    else:
        top = [c["slug"] for c in j["confidence"]["top5"]]
        status, server_ms = j["status"], j["timing_ms"]["total"]
        cos1, margin = j["confidence"]["top1"], j["confidence"]["margin"]
    res.append({"photo_id": r["photo_id"], "subset": r["subset"], "target": r["target_slug"], "top5": top,
                "hit1": bool(top) and top[0] in ok, "hit5": any(s in ok for s in top[:5]), "status": status,
                "wall_ms": round(wall, 1), "server_ms": server_ms, "top1_score": cos1, "margin": margin})
    print(f"{r['photo_id']} {r['subset']:9s} hit1={int(res[-1]['hit1'])} hit5={int(res[-1]['hit5'])} {status:9s} {wall:7.0f} ms")

def summ(sel):
    n = len(sel)
    return {"n": n, "top1": round(sum(x["hit1"] for x in sel) / n, 3), "top5": round(sum(x["hit5"] for x in sel) / n, 3)} if n else {}
out = {"all": summ(res)}
for s in ("exact", "probable", "same_line"):
    out[s] = summ([x for x in res if x["subset"] == s])
out["exact+probable"] = summ([x for x in res if x["subset"] != "same_line"])
walls = sorted(x["wall_ms"] for x in res)
out["latency_wall_ms"] = {"p50": round(statistics.median(walls), 1), "p90": round(walls[int(0.9 * (len(walls) - 1))], 1), "max": walls[-1]}
srv = sorted(x["server_ms"] for x in res if x["server_ms"] is not None)
if srv:
    out["latency_server_ms"] = {"p50": round(statistics.median(srv), 1), "p90": round(srv[int(0.9 * (len(srv) - 1))], 1), "max": srv[-1]}
out["found_rate"] = {s: round(sum(x["status"] == "found" for x in res if x["subset"] == s) / max(1, sum(x["subset"] == s for x in res)), 3) for s in ("exact", "probable", "same_line")}
print(json.dumps(out, ensure_ascii=False, indent=1))
if a.out:
    json.dump({"summary": out, "per_photo": res}, open(a.out, "w"), ensure_ascii=False, indent=1)
