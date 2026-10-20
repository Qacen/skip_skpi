"""Real-time API: raw detection (no filtering — the client filters) + identification of client-chosen crops.

POST /rt/detect     image -> every COCO "bottle" box above ?threshold (default 0.25): bbox, score, mask area (+ polygon with ?poly=1)
POST /rt/identify   one or more crop images (multipart field "files") -> top-k wines from the merged index (svoe_vino + external)
POST /rt/masks      image -> RF-DETR-Seg instance masks at full resolution: ?format=polygon | rle (COCO) | png (label map) | overlay (JPEG)
GET  /rt/info       precision / compile settings actually in effect, GPU, index size

Env:
  RT_DET_PRECISION  fp32 | amp (autocast fp16)            default: amp on GPUs with tensor cores (cc >= 7.0), fp32 otherwise
  RT_DET_COMPILE    off | default | max-autotune          default off; torch.compile needs Triton -> CUDA cc >= 7.0
  RT_FORCE          1 = apply amp/compile even on old GPUs (GTX 10xx), at your own risk
  EMBED_PRECISION   fp16 | amp | fp32 | auto              SigLIP embedder (app/matcher_siglip.py)
  RT_INDEX_PATH     merged index npz (id, source, vectors)   default ml/index/index_merged_tuned.npz
  RT_NAMES_PATH     wines_merged.csv (id, source, name, ...) default ml/index/wines_merged.csv
"""
from __future__ import annotations

import contextlib
import io
import logging
import os
import threading
import time
from pathlib import Path

import numpy as np
from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from PIL import Image, ImageOps

logger = logging.getLogger("app.realtime")
router = APIRouter(prefix="/rt", tags=["realtime"])
_ML = Path(__file__).resolve().parents[1]
_state: dict = {}
_lock = threading.Lock()


def _setup() -> dict:
    with _lock:
        if _state:
            return _state
        import torch
        from app.main import get_components, get_detector

        det, _ = get_detector()
        comp = get_components()
        info: dict = {"gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu"}
        cc = torch.cuda.get_device_capability(0) if torch.cuda.is_available() else (0, 0)
        info["compute_capability"] = f"{cc[0]}.{cc[1]}"
        force = os.environ.get("RT_FORCE", "0") == "1"
        prec = os.environ.get("RT_DET_PRECISION", "amp" if cc[0] >= 7 else "fp32").lower()
        if prec == "amp" and cc[0] < 7 and not force:
            logger.warning("RT_DET_PRECISION=amp on cc %s (no tensor cores, fp16 is slower) -> fp32; RT_FORCE=1 to override", info["compute_capability"])
            prec = "fp32"
        info["det_precision"] = prec
        mode = os.environ.get("RT_DET_COMPILE", "off").lower()
        info["det_compile"] = "off"
        rf = getattr(det, "_model", None)
        if mode != "off" and rf is not None:
            if cc[0] < 7 and not force:
                logger.warning("torch.compile needs Triton (CUDA cc >= 7.0); GPU cc %s -> compile off", info["compute_capability"])
            else:
                try:
                    holder = rf.model                       # rfdetr wrapper -> .model (LWDETR nn.Module)
                    holder.model = torch.compile(holder.model, mode=None if mode == "default" else mode)
                    info["det_compile"] = mode
                except Exception as e:  # noqa: BLE001
                    logger.warning("torch.compile failed (%r) -> eager", e)
        emb = comp["matcher"].embedder if hasattr(comp["matcher"], "embedder") else None
        info["embed_precision"] = getattr(emb, "precision", "n/a")
        z = np.load(os.environ.get("RT_INDEX_PATH", str(_ML / "index" / "index_merged_tuned.npz")), allow_pickle=False)
        ids = z["id"].astype(str); src = z["source"].astype(str)
        vec = z["vectors"].astype(np.float32); vec /= np.linalg.norm(vec, axis=1, keepdims=True) + 1e-9
        names = {}
        npath = os.environ.get("RT_NAMES_PATH", str(_ML / "index" / "wines_merged.csv"))
        if os.path.exists(npath):
            import csv
            with open(npath, encoding="utf-8") as fh:
                names = {r["id"]: r["name"] for r in csv.DictReader(fh)}
        info["index_size"] = len(ids)
        _state.update(det=det, emb=emb, ids=ids, src=src, vec=vec, names=names, info=info, torch=torch,
                      ac=(lambda: torch.autocast("cuda", dtype=torch.float16)) if prec == "amp" else (lambda: contextlib.nullcontext()))
        # warm-up (compile happens on the first calls)
        t0 = time.time()
        for _ in range(3):
            with _state["ac"]():
                det._model.predict(Image.new("RGB", (720, 1280), (128, 128, 128)), threshold=0.5)
        info["warmup_s"] = round(time.time() - t0, 1)
        return _state


def _load(data: bytes) -> Image.Image:
    im = ImageOps.exif_transpose(Image.open(io.BytesIO(data)))
    return im.convert("RGB")


@router.get("/info")
def info() -> dict:
    return _setup()["info"]


@router.post("/detect")
async def detect(file: UploadFile = File(...), threshold: float = Query(0.25, ge=0.05, le=0.95),
                 max_side: int = Query(1280, ge=256, le=2048), poly: int = Query(0)) -> dict:
    st = _setup(); t0 = time.perf_counter()
    try:
        im = _load(await file.read())
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, "Could not decode image") from exc
    W, H = im.size; s = min(1.0, max_side / max(W, H))
    small = im.resize((round(W * s), round(H * s))) if s < 1 else im
    t1 = time.perf_counter()
    torch = st["torch"]
    with st["ac"]():
        r = st["det"]._model.predict(small, threshold=threshold)
    if torch.cuda.is_available():
        torch.cuda.synchronize()
    t2 = time.perf_counter()
    out = []
    masks = getattr(r, "mask", None)
    for i in range(len(r)):
        if int(r.class_id[i]) != 44:
            continue
        b = [float(v) / s for v in r.xyxy[i]]
        o = {"bbox": [round(v, 1) for v in b], "score": round(float(r.confidence[i]), 4)}
        if masks is not None:
            m = masks[i]
            o["mask_area"] = int(m.sum() / (s * s))
            if poly:
                import cv2
                cs, _ = cv2.findContours(m.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                if cs:
                    c = max(cs, key=cv2.contourArea); c = cv2.approxPolyDP(c, 2.0, True)
                    o["polygon"] = [[round(float(x) / s, 1), round(float(y) / s, 1)] for x, y in c.reshape(-1, 2)]
        out.append(o)
    return {"width": W, "height": H, "bottles": out,
            "ms": {"decode": round((t1 - t0) * 1000, 1), "detect": round((t2 - t1) * 1000, 1), "total": round((time.perf_counter() - t0) * 1000, 1)}}


@router.post("/identify")
async def identify(files: list[UploadFile] = File(...), k: int = Query(5, ge=1, le=20), max_side: int = Query(1152, ge=256, le=2048)) -> dict:
    st = _setup(); t0 = time.perf_counter()
    ims = []
    for f in files:
        try:
            im = _load(await f.read()); im.thumbnail((max_side, max_side)); ims.append(im)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(400, f"Could not decode {f.filename}") from exc
    t1 = time.perf_counter()
    q = st["emb"].embed(ims)
    t2 = time.perf_counter()
    S = q @ st["vec"].T
    res = []
    for row in S:
        top = np.argpartition(-row, k)[:k]; top = top[np.argsort(-row[top])]
        res.append([{"id": st["ids"][j], "source": st["src"][j], "name": st["names"].get(st["ids"][j], ""), "cos": round(float(row[j]), 4)} for j in top])
    return {"results": res, "ms": {"decode": round((t1 - t0) * 1000, 1), "embed": round((t2 - t1) * 1000, 1),
                                   "search": round((time.perf_counter() - t2) * 1000, 1), "n": len(ims)}}


def _rle(mask: np.ndarray) -> dict:
    """COCO uncompressed RLE (column-major, starts with the count of zeros) of a full-resolution boolean mask."""
    flat = np.asfortranarray(mask).ravel(order="F").astype(np.uint8)
    change = np.flatnonzero(np.diff(np.concatenate([[0], flat, [0]])))
    runs = np.diff(np.concatenate([[0], change, [flat.size]]))
    return {"size": [int(mask.shape[0]), int(mask.shape[1])], "counts": [int(x) for x in runs]}


@router.post("/masks")
async def masks(file: UploadFile = File(...), threshold: float = Query(0.25, ge=0.05, le=0.95),
                max_side: int = Query(1280, ge=256, le=2048),
                format: str = Query("polygon", pattern="^(polygon|rle|png|overlay)$",
                                    description="polygon / rle: JSON per bottle; png: one 8-bit label map (pixel = bottle index + 1, 0 = background); "
                                                "overlay: JPEG of the photo with coloured masks"),
                all_classes: int = Query(0, description="1 = every COCO class the detector finds, not only bottles")):
    """RF-DETR-Seg instance masks at the ORIGINAL photo resolution, left -> right (raw detector output, no shelf / centre logic)."""
    from fastapi.responses import Response
    import cv2

    st = _setup(); t0 = time.perf_counter()
    try:
        im = _load(await file.read())
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, "Could not decode image") from exc
    W, H = im.size; s = min(1.0, max_side / max(W, H))
    small = im.resize((round(W * s), round(H * s))) if s < 1 else im
    with st["ac"]():
        r = st["det"]._model.predict(small, threshold=threshold)
    if st["torch"].cuda.is_available():
        st["torch"].cuda.synchronize()
    t1 = time.perf_counter()
    mk = getattr(r, "mask", None)
    if mk is None:
        raise HTTPException(501, "the detector checkpoint has no segmentation head")
    keep = [i for i in range(len(r)) if all_classes or int(r.class_id[i]) == 44]
    keep.sort(key=lambda i: float(r.xyxy[i][0]))
    full = [cv2.resize(mk[i].astype(np.uint8), (W, H), interpolation=cv2.INTER_NEAREST).astype(bool) for i in keep]
    if format in ("png", "overlay"):
        if format == "png":
            lab = np.zeros((H, W), np.uint8)
            for n, m in enumerate(full[:255], 1):
                lab[m & (lab == 0)] = n
            buf = io.BytesIO(); Image.fromarray(lab, "L").save(buf, "PNG")
            return Response(buf.getvalue(), media_type="image/png", headers={"X-Bottles": str(len(full))})
        rgb = np.asarray(im).astype(np.float32)
        rng = np.random.default_rng(0)
        for m in full:
            c = rng.integers(60, 255, 3).astype(np.float32)
            rgb[m] = rgb[m] * 0.45 + c * 0.55
            cs, _ = cv2.findContours(m.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            cv2.drawContours(rgb, cs, -1, (255, 255, 255), max(2, W // 500))
        buf = io.BytesIO(); Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)).save(buf, "JPEG", quality=88)
        return Response(buf.getvalue(), media_type="image/jpeg", headers={"X-Bottles": str(len(full))})
    out = []
    for i, m in zip(keep, full):
        o = {"bbox": [round(float(v) / s, 1) for v in r.xyxy[i]], "score": round(float(r.confidence[i]), 4),
             "class_id": int(r.class_id[i]), "area": int(m.sum())}
        if format == "rle":
            o["rle"] = _rle(m)
        else:
            cs, _ = cv2.findContours(m.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            cs = sorted(cs, key=cv2.contourArea, reverse=True)
            o["polygons"] = [[[int(x), int(y)] for x, y in cv2.approxPolyDP(c, max(1.0, W / 1000), True).reshape(-1, 2)] for c in cs if cv2.contourArea(c) > 25]
        out.append(o)
    return {"width": W, "height": H, "format": format, "bottles": out,
            "ms": {"detect": round((t1 - t0) * 1000, 1), "total": round((time.perf_counter() - t0) * 1000, 1)}}
