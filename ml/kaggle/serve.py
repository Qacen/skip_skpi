#!/usr/bin/env python3
"""Run the recognition service on a Kaggle GPU (T4) and publish it through a Cloudflare quick tunnel.

In a Kaggle notebook (GPU T4, Internet on) with the inputs attached:
  - dataset  qujvxta/wine-ml-service  (this ml/ folder + index_naflex1024.npz + reader_text.npz + catalog.json)
  - notebook output qujvxta/wine-ml-export (siglip2-naflex-vision-fp16/) — optional, otherwise the model is pulled from Hugging Face
run
  !python /kaggle/input/wine-ml-service/ml/kaggle/serve.py --hours 11
The public URL (https://<random>.trycloudflare.com) is printed and written to /kaggle/working/tunnel_url.txt.
It lives while the session runs; a new session gives a new URL. No auth: anyone with the URL can call the API.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument("--port", type=int, default=8000)
ap.add_argument("--hours", type=float, default=11.5, help="keep the server + tunnel alive this long")
ap.add_argument("--selftest", type=int, default=5, help="photos to send through the public URL after start (0 = skip)")
ap.add_argument("--no-tunnel", action="store_true")
ap.add_argument("--work", default="/kaggle/working")
ap.add_argument("--model", default="auto", choices=["auto", "tuned", "base"],
                help="auto: the fine-tuned tower if its weights are attached, else the base one")
a = ap.parse_args()
WORK = Path(a.work)
T0 = time.time()


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def find(pattern: str, cond=lambda p: True) -> str | None:
    hits = [p for p in glob.glob(pattern, recursive=True) if cond(p)]
    return sorted(hits, key=len)[0] if hits else None


# ---------------- code + artefacts ----------------
here = Path(__file__).resolve().parents[1]
src = here if (here / "app" / "main.py").exists() else Path(find("/kaggle/input/**/app/main.py")).parents[1]
code = WORK / "ml"
if code.resolve() != src.resolve():
    shutil.rmtree(code, ignore_errors=True)
    shutil.copytree(src, code, ignore=shutil.ignore_patterns(".venv", "__pycache__", ".pytest_cache", "weights"))
(code / "weights").mkdir(exist_ok=True)
vision = find("/kaggle/input/**/siglip2-naflex-vision-fp16/config.json")
tuned = None if a.model == "base" else find("/kaggle/input/**/siglip2-naflex-vision-tuned-fp16/config.json")
# the service's own index (catalog cards only) wins over any other npz in the inputs
# (the export kernel also outputs a catalog+video index, which is worse on real photos: top-1 0.64 vs 0.79)
index = str(src / "index" / "index_naflex1024.npz") if (src / "index" / "index_naflex1024.npz").exists() else find("/kaggle/input/**/index_naflex1024.npz")
reader = str(src / "index" / "reader_text.npz") if (src / "index" / "reader_text.npz").exists() else find("/kaggle/input/**/reader_text.npz")
catalog = str(src / "index" / "catalog.json") if (src / "index" / "catalog.json").exists() else find("/kaggle/input/**/catalog.json")
rfdetr_w = find("/kaggle/input/**/rf-detr-seg-small.pt")
if rfdetr_w:
    shutil.copy(rfdetr_w, code / "weights" / "rf-detr-seg-small.pt")
# detector: RF-DETR-Seg Nano by default here (live AR: input 312 vs 384, same masks quality on our shelf frames);
# RFDETR_VARIANT=seg-small for the previous one. Weights: attached input, else rfdetr downloads them (internet on)
rfdetr_variant = os.environ.get("RFDETR_VARIANT", "seg-nano")
if rfdetr_variant == "seg-nano" and (w := find("/kaggle/input/**/rf-detr-seg-nano.pt")):
    shutil.copy(w, code / "weights" / "rf-detr-seg-nano.pt")
base_path = str(Path(vision).parent) if vision else "google/siglip2-so400m-patch16-naflex"
env = dict(os.environ,
           DEVICE="cuda", DETECTOR="rfdetr", RFDETR_VARIANT=rfdetr_variant, MATCHER="siglip", READER="siglip",
           EMBEDDER_PATH=base_path, INDEX_PATH=index, READER_TEXT_PATH=reader, CATALOG_PATH=catalog,
           WEIGHTS_DIR=str(code / "weights"), PYTHONUNBUFFERED="1", TOKENIZERS_PARALLELISM="false",
           RT_DET_PRECISION=os.environ.get("RT_DET_PRECISION", "amp"), RT_DET_COMPILE=os.environ.get("RT_DET_COMPILE", "max-autotune"),
           EMBED_PRECISION=os.environ.get("EMBED_PRECISION", "fp16"))
tuned_index = src / "index" / "index_tuned_naflex1024.npz"
if tuned and tuned_index.exists():
    # fine-tuned vision tower (dobermanjohn/secret_a) + its own catalog index; the label reader keeps the base tower
    env.update(EMBEDDER_PATH=str(Path(tuned).parent), INDEX_PATH=str(tuned_index), READER_EMBEDDER_PATH=base_path,
               CROP_MAX_SIDE="1152", FOUND_MIN_COS=os.environ.get("FOUND_MIN_COS", "0.62"))
elif a.model == "tuned":
    raise SystemExit("--model tuned: attach the notebook output qujvxta/wine-tuned-export (siglip2-naflex-vision-tuned-fp16)")
index = env["INDEX_PATH"]
log(f"code {code}\n  embedder {env['EMBEDDER_PATH']}\n  reader tower {env.get('READER_EMBEDDER_PATH', env['EMBEDDER_PATH'])}\n  index {index}\n  reader {reader}\n  catalog {catalog}")

# ---------------- dependencies ----------------
need = [p for m, p in (("fastapi", "fastapi"), ("uvicorn", "uvicorn[standard]"), ("multipart", "python-multipart"),
                       ("rfdetr", "rfdetr"), ("pillow_heif", "pillow-heif")) if not __import__("importlib").util.find_spec(m)]
if need:
    log(f"pip install {' '.join(need)}")
    subprocess.run([sys.executable, "-m", "pip", "install", "-q", *need], check=True)

# ---------------- server ----------------
srv_log = open(WORK / "uvicorn.log", "w")
server = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", str(a.port)],
                          cwd=code, env=env, stdout=srv_log, stderr=subprocess.STDOUT)
local = f"http://127.0.0.1:{a.port}"
for _ in range(900):
    if server.poll() is not None:
        srv_log.flush()
        print(open(WORK / "uvicorn.log").read()[-4000:])
        raise SystemExit("server exited during start-up")
    try:
        health = json.load(urllib.request.urlopen(f"{local}/health", timeout=2))
        break
    except Exception:
        time.sleep(1)
else:
    raise SystemExit("server did not come up in 15 min")
log(f"server up in {time.time() - T0:.0f}s: {json.dumps(health, ensure_ascii=False)}")
# warm-up: the first requests pay for CUDA kernel selection in the detector (~4 s)
try:
    import io as _io
    from PIL import Image as _Image
    _buf = _io.BytesIO(); _Image.new("RGB", (900, 1200), (180, 160, 140)).save(_buf, "JPEG"); _img = _buf.getvalue()
    _bd = "wu" + str(int(time.time()))
    for _ in range(3):
        _body = (f"--{_bd}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"w.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n").encode() + _img + f"\r\n--{_bd}--\r\n".encode()
        urllib.request.urlopen(urllib.request.Request(f"{local}/recognize", data=_body, headers={"Content-Type": f"multipart/form-data; boundary={_bd}"}), timeout=120).read()
    log("warm-up done")
except Exception as e:  # warm-up is best effort
    log(f"warm-up skipped: {e!r}")

# ---------------- tunnel ----------------
public = None
tunnel = None


def start_tunnel() -> str:
    global tunnel
    binp = WORK / "cloudflared"
    if not binp.exists():
        urllib.request.urlretrieve("https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64", binp)
        binp.chmod(0o755)
    tunnel = subprocess.Popen([str(binp), "tunnel", "--no-autoupdate", "--url", local],
                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    url = None
    t_end = time.time() + 90
    while time.time() < t_end and url is None:
        line = tunnel.stdout.readline()
        if not line:
            time.sleep(0.2)
            continue
        m = re.search(r"https://[a-z0-9-]+\.trycloudflare\.com", line)
        if m:
            url = m.group(0)
    if url is None:
        raise RuntimeError("cloudflared did not print a URL")
    threading.Thread(target=lambda: [None for _ in tunnel.stdout], daemon=True).start()  # drain its output
    for _ in range(90):  # wait until DNS + the edge actually route to us (quick-tunnel names can take ~10-60 s)
        try:
            urllib.request.urlopen(f"{url}/health", timeout=5)
            break
        except Exception:
            time.sleep(2)
    else:
        log("warning: the public URL did not answer within 3 min (DNS may still be propagating)")
    return url


if not a.no_tunnel:
    public = start_tunnel()
    (WORK / "tunnel_url.txt").write_text(public + "\n")
    bar = "=" * 72
    log(f"\n{bar}\n  PUBLIC URL:  {public}\n  docs:        {public}/docs\n  predict:     curl -F file=@photo.jpg {public}/predict\n  site:        echo '{public}' > web/ml-url.txt   (in the lct repo root; the site re-reads it on every scan)\n{bar}")

# ---------------- self-test through the public URL ----------------
if a.selftest:
    import requests

    base = public or local
    photos = sorted(glob.glob("/kaggle/input/**/*.webp", recursive=True) + glob.glob("/kaggle/input/**/*.jpg", recursive=True))
    photos = [p for p in photos if "siglip2" not in p][: a.selftest]
    for p in photos:
        t_ = time.perf_counter()
        try:
            r = requests.post(f"{base}/recognize", files={"file": (os.path.basename(p), open(p, "rb").read())}, timeout=60)
        except Exception as e:  # the self-test must never take the server down
            log(f"selftest via {base} failed: {e!r}"); continue
        wall = (time.perf_counter() - t_) * 1000
        j = r.json() if r.ok else {}
        log(f"selftest {os.path.basename(p)[:40]:40s} {r.status_code} {j.get('status')} {j.get('slug')} "
            f"server {j.get('timing_ms', {}).get('total')} ms, wall {wall:.0f} ms")

# ---------------- keep alive ----------------
deadline = T0 + a.hours * 3600
while time.time() < deadline:
    time.sleep(60)
    if server.poll() is not None:
        srv_log.flush()
        print(open(WORK / "uvicorn.log").read()[-4000:])
        raise SystemExit("server died")
    if not a.no_tunnel and tunnel is not None and tunnel.poll() is not None:
        log("tunnel exited, restarting (the URL changes)")
        public = start_tunnel()
        (WORK / "tunnel_url.txt").write_text(public + "\n")
        log(f"NEW PUBLIC URL: {public}\n  site:        echo \"{public}\" > web/ml-url.txt")
    if int(time.time() - T0) % 600 < 60:
        log(f"alive {(time.time() - T0) / 3600:.1f} h, url {public or local}")
log("time is up, shutting down")
server.terminate()
if tunnel is not None:
    tunnel.terminate()
