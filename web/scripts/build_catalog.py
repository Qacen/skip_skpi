#!/usr/bin/env python3
"""Build static catalog data for the frontend from the local svo-vino scrape (/Users/stanislav/lct/vino_svoe).
-> data/catalog.json   compact list for the grid, filters and search (read by server/api)
-> data/wines/<slug>.json  full card (same fields as vino-svoe.ru /api/wines/<slug>)
-> data/filters.json   filter groups (colour, sweetness, region, grape, manufacturer, dishes)
-> public/img/wines/<slug>.webp   bottle photo, flattened on white, tight crop, long side 640 px
usage: python3 scripts/build_catalog.py [--force-images]"""
import json, re, sys, pathlib, collections
from concurrent.futures import ProcessPoolExecutor
import numpy as np
import pandas as pd
from PIL import Image

SRC = pathlib.Path("/Users/stanislav/lct/vino_svoe")
ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA, IMG = ROOT / "data", ROOT / "public" / "img" / "wines"

COLORS = {"белое": ("white", "Белое"), "красное": ("red", "Красное"), "розовое": ("rose", "Розовое"), "оранжевое": ("orange", "Оранжевое")}
SWEET = [("экстра брют", "extra_brut", "Экстра брют"), ("брют натюр", "brut_nature", "Брют натюр"), ("брют", "brut", "Брют"),
         ("полусухое", "semi_dry", "Полусухое"), ("полусладкое", "semi_sweet", "Полусладкое"), ("сладкое", "sweet", "Сладкое"), ("сухое", "dry", "Сухое")]


def parse_category(c):
    c = (c or "").lower()
    col = next((v for k, v in COLORS.items() if c.startswith(k)), ("", ""))
    sw = next(((key, name) for k, key, name in SWEET if k in c), ("", ""))
    return col, sw


def image_one(args):
    slug, f, force = args
    dst = IMG / f"{slug}.webp"
    if dst.exists() and not force:
        return True
    try:
        im = Image.open(SRC / f)
        if im.mode in ("RGBA", "LA", "P"):
            im = im.convert("RGBA"); b = Image.new("RGB", im.size, "white"); b.paste(im, mask=im.split()[3]); im = b
        im = im.convert("RGB")
        a = np.asarray(im.convert("L")); ys, xs = np.nonzero(a < 246)
        if len(xs):
            pad = int(0.03 * max(im.size))
            im = im.crop((max(0, xs.min() - pad), max(0, ys.min() - pad), min(im.size[0], xs.max() + pad), min(im.size[1], ys.max() + pad)))
        im.thumbnail((640, 640))
        im.save(dst, "WEBP", quality=82, method=5)
        return True
    except Exception as e:
        print("image error", slug, e)
        return False


def main():
    force = "--force-images" in sys.argv
    (DATA / "wines").mkdir(parents=True, exist_ok=True); IMG.mkdir(parents=True, exist_ok=True)
    cat = pd.read_csv(SRC / "wines.csv").fillna("")
    raw = {p.stem: json.load(open(p)) for p in (SRC / "raw_json").glob("*.json")}
    with ProcessPoolExecutor(6) as ex:
        ok = list(ex.map(image_one, [(r.slug, r.image_file, force) for r in cat.itertuples()], chunksize=16))
    items, facets = [], collections.defaultdict(collections.Counter)
    for r, good in zip(cat.itertuples(), ok):
        if not good:
            continue
        d = raw.get(r.slug, {})
        (col_key, col_name), (sw_key, sw_name) = parse_category(r.category)
        grapes = [g["name"] for g in d.get("grapes", [])] or [g.strip() for g in str(r.grapes).split(",") if g.strip()]
        dishes = [x["name"] for x in d.get("dishes", [])]
        year = (re.findall(r"(?<!\d)(19[5-9]\d|20[0-3]\d)(?!\d)", r.title) or [""])[-1]
        rating = d.get("publicRating", r.public_rating) or None
        guide_rating = d.get("rating")  # Roskachestvo guide score (5-point), only ~166 wines have it
        it = {"slug": r.slug, "title": str(r.title).strip(), "manufacturer": r.manufacturer, "manufacturerSlug": r.manufacturer_slug, "region": r.region,
              "category": r.category, "color": col_key, "sweetness": sw_key, "grapes": grapes, "dishes": dishes, "year": year,
              "rating": round(float(rating), 2) if rating not in (None, "") else None, "alcohol": d.get("alcohol", r.alcohol or None),
              "guideRating": round(float(guide_rating), 2) if guide_rating not in (None, "") else None,
              "gradient": (d.get("category") or {}).get("backgroundGradient", ""), "img": f"/img/wines/{r.slug}.webp"}
        items.append(it)
        full = {**it, "colorDescription": d.get("color", r.color), "description": d.get("description", r.description), "temperature": d.get("temperature", r.temperature)}
        json.dump(full, open(DATA / "wines" / f"{r.slug}.json", "w"), ensure_ascii=False)
        facets["color"][(col_key, col_name)] += 1 if col_key else 0
        facets["sweetness"][(sw_key, sw_name)] += 1 if sw_key else 0
        facets["region"][(r.region, r.region)] += 1 if r.region else 0
        facets["manufacturer"][(r.manufacturer, r.manufacturer)] += 1 if r.manufacturer else 0
        for g in grapes:
            facets["grape"][(g, g)] += 1
        for x in dishes:
            facets["dish"][(x, x)] += 1
    items.sort(key=lambda x: (-(x["rating"] or 0), x["title"]))
    json.dump(items, open(DATA / "catalog.json", "w"), ensure_ascii=False, separators=(",", ":"))
    names = {"color": "Цвет", "sweetness": "Категория", "region": "Регион", "grape": "Сорт винограда", "manufacturer": "Производитель", "dish": "Гастросочетания"}
    order = {"color": [c[0] for c in COLORS.values()], "sweetness": [s[1] for s in SWEET]}
    filters = []
    for key, title in names.items():
        vals = [{"value": k, "name": n, "count": c} for (k, n), c in facets[key].items() if k and c]
        if key in order:
            vals.sort(key=lambda v: order[key].index(v["value"]) if v["value"] in order[key] else 99)
        else:
            vals.sort(key=lambda v: v["name"].lower())
        filters.append({"key": key, "name": title, "searchable": key in ("region", "grape", "manufacturer", "dish"), "values": vals})
    json.dump(filters, open(DATA / "filters.json", "w"), ensure_ascii=False)
    print(f"wines {len(items)} | images ok {sum(ok)} | filters {[(f['key'], len(f['values'])) for f in filters]}")


if __name__ == "__main__":
    main()
