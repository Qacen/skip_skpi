#!/usr/bin/env python3
"""Local real-time client: camera / video -> remote /rt/detect -> LOCAL front-row filter + tracking -> sharpest crop per bottle -> /rt/identify.
Run on your machine, the server is reached through the SSH tunnel (ssh -L 8000:localhost:8000 ...):
  python rt_client.py --src 0                      # webcam
  python rt_client.py --src video.mov --save out.mp4
Live sliders (window "filter") tune the filter; keys: q quit, space pause, b toggle boxes.
deps: pip install opencv-python numpy requests pillow
"""
import argparse, io, os, threading, time
from concurrent.futures import ThreadPoolExecutor
import cv2, numpy as np, requests
from PIL import Image, ImageDraw, ImageFont

ap = argparse.ArgumentParser()
ap.add_argument("--src", default="0"); ap.add_argument("--url", default="http://127.0.0.1:8000")
ap.add_argument("--det-every", type=int, default=5); ap.add_argument("--width", type=int, default=720); ap.add_argument("--save", default="")
ap.add_argument("--font", default=""); ap.add_argument("--headless", action="store_true"); ap.add_argument("--max-frames", type=int, default=0)
a = ap.parse_args()
S = requests.Session()
print("server:", S.get(a.url + "/rt/info", timeout=600).json())
FONT = None
for f in [a.font, "/System/Library/Fonts/Supplemental/Arial Unicode.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "C:/Windows/Fonts/arial.ttf"]:
    try: FONT = ImageFont.truetype(f, 18); break
    except Exception: pass
FONT = FONT or ImageFont.load_default()
# ---- live filter parameters (sliders) ----
P = {"score x100": 30, "rel height x100": 70, "rel area x100": 45, "min height %": 20, "show cos x100": 55, "sharp min": 60}
if not a.headless: cv2.namedWindow("filter"); [cv2.createTrackbar(k, "filter", v, 100 if "sharp" not in k else 400, lambda x: None) for k, v in P.items()]
def p(k): return P[k] if a.headless else cv2.getTrackbarPos(k, "filter")
def jpg(img, q=88): return cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, q])[1].tobytes()
def front_row(dets, H):
    """FRONT ROW ONLY: score, height >= rel_h * tallest, mask area >= rel_a * mean(3 largest), height >= min %"""
    dets = [d for d in dets if d["score"] >= p("score x100") / 100]
    if not dets: return []
    hmax = max(d["bbox"][3] - d["bbox"][1] for d in dets); top = sorted([d.get("mask_area", 0) for d in dets], reverse=True)[:3]; amean = np.mean(top) if top else 0
    keep = []
    for d in dets:
        h = d["bbox"][3] - d["bbox"][1]
        if h < p("rel height x100") / 100 * hmax or h < p("min height %") / 100 * H: continue
        if amean and d.get("mask_area", amean) < p("rel area x100") / 100 * amean: continue
        keep.append(d)
    return keep
def iou(a, b):
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0])); iy = max(0, min(a[3], b[3]) - max(a[1], b[1])); i = ix * iy
    return i / ((a[2]-a[0])*(a[3]-a[1]) + (b[2]-b[0])*(b[3]-b[1]) - i + 1e-9)
inflight = []   # [(future, T since that frame)]
tracks, nid, pool = {}, 0, ThreadPoolExecutor(6); lock = threading.Lock(); det_future = None; last_dets = []
id_inflight = [None]
def identify_batch(items):
    """items: [(tid, crop)] -> ONE /rt/identify request (the server embeds all crops in one batch)"""
    try:
        files = [("files", (f"{tid}.jpg", jpg(c, 92), "image/jpeg")) for tid, c in items]
        res = S.post(a.url + "/rt/identify?k=1", files=files, timeout=30).json()["results"]
        with lock:
            for (tid, _), r in zip(items, res):
                if tid in tracks: tracks[tid].update(name=r[0]["name"], cos=r[0]["cos"], src=r[0]["source"], done=True); tracks[tid]["busy"] = False
                if os.environ.get("RT_LOG"):
                    print(f"ID tid={tid} cos={r[0]['cos']:.3f} {r[0]['source']} {r[0]['name'][:50]}", flush=True)
                    os.makedirs("/tmp/rt_crops", exist_ok=True); cv2.imwrite(f"/tmp/rt_crops/{tid}_{r[0]['cos']:.2f}.jpg", dict(items)[tid])
    except Exception as e:
        print("identify error", e)
        with lock:
            for tid, _ in items:
                if tid in tracks: tracks[tid]["busy"] = False
src = int(a.src) if a.src.isdigit() else a.src
cap = cv2.VideoCapture(src); fps = cap.get(cv2.CAP_PROP_FPS) or 30; writer = None; prev_g = None; k = 0; show_boxes = False; t_last = time.time(); fps_ema = 0
while True:
    ok, full = cap.read()
    if not ok: break
    s = a.width / full.shape[1]; fr = cv2.resize(full, (a.width, round(full.shape[0] * s))); H, W = fr.shape[:2]; g = cv2.cvtColor(fr, cv2.COLOR_BGR2GRAY)
    # optical flow: move every track box (points found once per frame)
    A = np.eye(3)
    if prev_g is not None:
        p0 = cv2.goodFeaturesToTrack(prev_g, 800, 0.01, 7)
        if p0 is not None:
            p1, st, _ = cv2.calcOpticalFlowPyrLK(prev_g, g, p0, None, winSize=(21, 21), maxLevel=3); ok_ = st.ravel() == 1
            if ok_.sum() >= 12:
                M, _ = cv2.estimateAffinePartial2D(p0.reshape(-1, 2)[ok_], p1.reshape(-1, 2)[ok_], method=cv2.RANSAC, ransacReprojThreshold=3.0)
                if M is not None: A = np.vstack([M, [0, 0, 1]])
    def warp(b, T):
        c = np.array([[b[0], b[1], 1], [b[2], b[3], 1]], float) @ T.T; return [min(c[0, 0], c[1, 0]), min(c[0, 1], c[1, 1]), max(c[0, 0], c[1, 0]), max(c[0, 1], c[1, 1])]
    with lock:
        for t in tracks.values(): t["box"] = warp(t["box"], A)
    for x in last_dets: x["bbox"] = warp(x["bbox"], A)   # keep the debug boxes glued to the scene too
    inflight = [(f_, A @ T_) for f_, T_ in inflight]
    prev_g = g
    # detection (async, every N frames)
    if len(inflight) < 3 and k % a.det_every == 0:
        sm = fr; img = jpg(sm, 80); inflight.append((pool.submit(lambda b: S.post(a.url + "/rt/detect?threshold=0.2", files={"file": ("f.jpg", b, "image/jpeg")}, timeout=30).json(), img), np.eye(3)))
    if inflight and inflight[0][0].done():
        det_future, pending_T = inflight.pop(0)
        try:
            last_dets = det_future.result()["bottles"]; f_ = 1.0
            for x in last_dets: x["bbox"] = [v * f_ for v in x["bbox"]]; x["mask_area"] = x.get("mask_area", 0) * f_ * f_
        except Exception as e: print("detect error", e); last_dets = []
        for x in last_dets: x["bbox"] = warp(x["bbox"], pending_T)   # detections are ~1 s old: move them by the camera motion since
        keep = [x for x in front_row(last_dets, H) if x["bbox"][1] > 0.01 * H and x["bbox"][3] < 0.99 * H]; used = set()
        with lock:
            for tid, t in list(tracks.items()):
                best, bj = 0.3, -1
                for j, d in enumerate(keep):
                    if j not in used and iou(t["box"], d["bbox"]) > best: best, bj = iou(t["box"], d["bbox"]), j
                if bj >= 0: t["box"] = keep[bj]["bbox"]; t["miss"] = 0; t["hits"] += 1; used.add(bj)
                else:
                    t["miss"] += 1
                    if t["miss"] > 3: del tracks[tid]
            for j, d in enumerate(keep):
                if j not in used: tracks[nid] = {"born": time.time(), "box": d["bbox"], "miss": 0, "hits": 1, "sharp": 0, "id_sharp": 0, "name": None, "cos": 0, "busy": False, "n": 0}; nid += 1
    with lock:   # merge duplicate tracks (keep the older one)
        ids = sorted(tracks)
        for i1 in ids:
            for i2 in ids:
                if i1 < i2 and i1 in tracks and i2 in tracks and iou(tracks[i1]["box"], tracks[i2]["box"]) > 0.45:
                    a_, b_ = tracks[i1], tracks[i2]
                    if b_["name"] and (not a_["name"] or b_["cos"] > a_["cos"]): a_.update(name=b_["name"], cos=b_["cos"])
                    del tracks[i2]
    # sharpest crop per track -> identify (from the full-resolution frame)
    with lock:
        for tid, t in tracks.items():
            x1, y1, x2, y2 = t["box"]
            if x1 < 2 or x2 > W - 2 or t["miss"] > 0: continue
            pw, ph = 0.1 * (x2 - x1), 0.1 * (y2 - y1); X1, Y1, X2, Y2 = [int(v / s) for v in (max(0, x1 - pw), max(0, y1 - ph), min(W, x2 + pw), min(H, y2 + ph))]
            c = full[Y1:Y2, X1:X2]
            if c.size == 0: continue
            lz = cv2.cvtColor(c[int(0.4 * c.shape[0]):int(0.95 * c.shape[0])], cv2.COLOR_BGR2GRAY)
            if lz.size == 0: continue
            sh = cv2.Laplacian(cv2.resize(lz, (160, max(8, int(160 * lz.shape[0] / max(1, lz.shape[1]))))), cv2.CV_64F).var()
            if sh > t["sharp"]: t["sharp"], t["crop"] = sh, c.copy()
            # wait at most 0.5 s for a sharp frame, then identify the best crop seen so far as is
            first_due = t["n"] == 0 and time.time() - t["born"] >= 0.5 and "crop" in t
            if not t["busy"] and t["n"] < 4 and (first_due or t["sharp"] > max(p("sharp min"), 1.25 * t["id_sharp"])):
                t["want"] = True
        need = [(tid, t) for tid, t in tracks.items() if t.get("want") and not t["busy"]]
        if need and (id_inflight[0] is None or id_inflight[0].done()):
            for tid, t in need: t["busy"] = True; t["want"] = False; t["n"] += 1; t["id_sharp"] = t["sharp"]
            id_inflight[0] = pool.submit(identify_batch, [(tid, t["crop"]) for tid, t in need])
    # render: dots + names for identified bottles
    im = Image.fromarray(cv2.cvtColor(fr, cv2.COLOR_BGR2RGB)); d = ImageDraw.Draw(im)
    if show_boxes:
        with lock:
            for t in tracks.values(): d.rectangle(t["box"], outline=(0, 200, 0), width=2)
    with lock:
        for t in tracks.values():
            if t["miss"] > 1 or t["box"][0] < 2 or t["box"][2] > W - 2: continue
            if not t.get("done"): status = "распознаю…"
            elif t["cos"] >= p("show cos x100") / 100: status = f"{t['name'][:34]} {t['cos']:.2f}"
            else: status = "не найдено"
            x1, y1, x2, y2 = t["box"]; cx, cy = (x1 + x2) / 2, y1 + 0.6 * (y2 - y1)
            d.ellipse([cx - 8, cy - 8, cx + 8, cy + 8], fill="white", outline="black", width=2); d.ellipse([cx - 4, cy - 4, cx + 4, cy + 4], fill=(220, 30, 60))
            lab = status; tw = d.textlength(lab, font=FONT); lx = min(max(4, cx - tw / 2), W - tw - 8)
            d.rounded_rectangle([lx - 5, cy - 38, lx + tw + 5, cy - 16], radius=7, fill="white"); d.text((lx, cy - 37), lab, fill="black", font=FONT)
    if not isinstance(src, int):  # video file: play at its own fps, like a live camera
        time.sleep(max(0.0, 1 / fps - (time.time() - t_last)))
    now = time.time(); fps_ema = 0.9 * fps_ema + 0.1 / max(1e-3, now - t_last); t_last = now
    d.text((8, 8), f"{fps_ema:.1f} fps  tracks {len(tracks)}", fill=(255, 255, 0), font=FONT)
    out = cv2.cvtColor(np.array(im), cv2.COLOR_RGB2BGR)
    if not a.headless: cv2.imshow("wine", out)
    if a.save:
        writer = writer or cv2.VideoWriter(a.save, cv2.VideoWriter_fourcc(*"mp4v"), fps, (W, H)); writer.write(out)
    if a.max_frames and k >= a.max_frames: break
    key = 255 if a.headless else cv2.waitKey(1) & 0xFF
    if key == ord("q"): break
    if key == ord("b"): show_boxes = not show_boxes
    if key == ord(" "): cv2.waitKey(0)
    k += 1
if writer: writer.release()
