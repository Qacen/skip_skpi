"""Real matcher: SigLIP2 so400m naflex (1024 patches) embedding of the bottle crop -> nearest catalog wines.

Pipeline for one photo (all bottles are embedded in one batch):
  1. crop = detector bbox + 10 % padding on every side (clipped to the image);
  2. SigLIP2 naflex vision tower, max_num_patches=1024, L2-normalised 1152-d vector;
  3. cosine similarity to every index vector (catalog card vectors + optional linked video views),
     aggregated per slug by max -> top-K neighbours;
  4. found / not_found: top-1 cosine >= FOUND_MIN_COS (see ML_SERVICE.md §7 for the calibration).

Index file (`INDEX_PATH`, npz, built by wine_seg/kernels/ml_export or scripts/build_index.py):
  slug[N] (str), source[N] ("catalog" | "video" | ...), vectors[N, 1152] (fp16, L2-normalised), model, crop.
Catalog card vectors are mean(card photo, label band 30-92 % of the card photo), re-normalised.

Measured on real-photo 87 (wine_seg/PLAN.md): top-1 0.793, top-5 0.931; exact + probable top-1 0.918.
"""
from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

logger = logging.getLogger("app.matcher_siglip")

DEFAULT_EMBEDDER = "google/siglip2-so400m-patch16-naflex"


def pick_device(requested: str) -> str:
    import torch

    requested = (requested or "cpu").lower()
    if requested == "cuda" and torch.cuda.is_available():
        return "cuda"
    if requested == "mps" and torch.backends.mps.is_available():
        return "mps"
    if requested not in ("cpu", "cuda", "mps"):
        logger.warning("unknown DEVICE=%s; using cpu", requested)
    elif requested != "cpu":
        logger.warning("DEVICE=%s requested but not available; using cpu", requested)
    return "cpu"


def crop_box(image: Image.Image, bbox: list[int] | list[float], pad: float, max_side: int = 0) -> Image.Image:
    """bbox [x1,y1,x2,y2] expanded by `pad` of its width/height on every side, clipped to the image;
    optionally downscaled so the long side is <= max_side (0 = keep)."""
    width, height = image.size
    x1, y1, x2, y2 = bbox
    pw, ph = pad * (x2 - x1), pad * (y2 - y1)
    box = (int(max(0, x1 - pw)), int(max(0, y1 - ph)), int(min(width, x2 + pw)), int(min(height, y2 + ph)))
    crop = image if (box[2] - box[0] < 8 or box[3] - box[1] < 8) else image.crop(box)
    if max_side and max(crop.size) > max_side:
        crop = crop.copy()
        crop.thumbnail((max_side, max_side), Image.BICUBIC)
    return crop


def label_zone(crop: Image.Image, top: float = 0.25, bottom: float = 0.95) -> Image.Image:
    """Cheap front-label zone: rows 25-95 % of the padded bottle crop (SAM3 label masks gave no gain, +0.5 s)."""
    w, h = crop.size
    return crop.crop((0, int(top * h), w, max(int(top * h) + 1, int(bottom * h))))


class SiglipEmbedder:
    """SigLIP2 naflex vision tower only (the catalog side and all text prompts are precomputed)."""

    def __init__(self, model_path: str, device: str, max_patches: int = 1024) -> None:
        import torch
        from transformers import AutoImageProcessor, Siglip2VisionModel
        from transformers.utils import logging as hf_logging

        hf_logging.disable_progress_bar()  # no "Loading weights" bars in the service log

        self.torch = torch
        self.device = pick_device(device)
        # fp16 on CUDA and MPS (MPS: 0.46 s vs 0.66 s per 1024-patch crop, cosine to fp32 0.99998); fp32 on CPU.
        # EMBED_PRECISION: fp16 (weights in fp16), amp (fp32 weights + autocast fp16), fp32, auto (default).
        # auto: fp16 on MPS and on CUDA GPUs with tensor cores (compute capability >= 7.0); fp32 on Pascal (GTX 10xx: fp16 is ~64x slower) and CPU.
        import os as _os
        prec = _os.environ.get("EMBED_PRECISION", "auto").lower()
        cc = torch.cuda.get_device_capability(0) if self.device == "cuda" else (0, 0)
        if prec == "auto":
            prec = "fp16" if self.device == "mps" or (self.device == "cuda" and cc[0] >= 7) else "fp32"
        self.precision = prec
        self.dtype = torch.float16 if prec == "fp16" else torch.float32
        self.amp = prec == "amp" and self.device == "cuda"
        self.max_patches = max_patches
        self.processor = AutoImageProcessor.from_pretrained(model_path)
        self.model = Siglip2VisionModel.from_pretrained(model_path, torch_dtype=self.dtype).to(self.device).eval()
        self._lock = threading.Lock()  # one forward pass at a time (uvicorn runs sync endpoints in a thread pool)
        self.embed([Image.new("RGB", (64, 128), (200, 200, 200))])  # warm-up (kernels, allocator)

    def embed(self, images: list[Image.Image], max_patches: int | None = None) -> np.ndarray:
        if not images:
            return np.zeros((0, 1152), np.float32)
        torch = self.torch
        import contextlib
        ac = torch.autocast("cuda", dtype=torch.float16) if self.amp else contextlib.nullcontext()
        with self._lock, torch.inference_mode(), ac:
            x = self.processor(images=images, max_num_patches=max_patches or self.max_patches, return_tensors="pt")
            out = self.model(
                pixel_values=x["pixel_values"].to(self.device, self.dtype),
                pixel_attention_mask=x["pixel_attention_mask"].to(self.device),
                spatial_shapes=x["spatial_shapes"].to(self.device),
            )
            v = torch.nn.functional.normalize(out.pooler_output.float(), dim=-1)
        return v.cpu().numpy()


@dataclass
class VectorIndex:
    """In-memory vector index (brute force; 2-3k vectors -> < 1 ms per query)."""

    slugs: list[str]                 # unique slugs, order of `vec_slug` ids
    vectors: np.ndarray              # (N, D) float32, L2-normalised
    vec_slug: np.ndarray             # (N,) int -> index into `slugs`
    vec_source: np.ndarray           # (N,) str
    meta: dict[str, str] = field(default_factory=dict)

    @classmethod
    def load(cls, path: Path, allowed_slugs: set[str] | None = None, sources: set[str] | None = None) -> "VectorIndex":
        z = np.load(path, allow_pickle=False)
        slug = z["slug"].astype(str)
        source = z["source"].astype(str) if "source" in z.files else np.array(["catalog"] * len(slug))
        keep = np.ones(len(slug), bool)
        if allowed_slugs is not None:
            keep &= np.isin(slug, list(allowed_slugs))
        if sources:
            keep &= np.isin(source, list(sources))
        vec = z["vectors"][keep].astype(np.float32)
        vec /= np.linalg.norm(vec, axis=1, keepdims=True) + 1e-9
        uniq, inv = np.unique(slug[keep], return_inverse=True)
        meta = {k: str(z[k]) for k in ("model", "crop", "catalog_view") if k in z.files}
        return cls(slugs=list(uniq), vectors=vec, vec_slug=inv, vec_source=source[keep], meta=meta)

    def __len__(self) -> int:
        return len(self.slugs)

    def search(self, queries: np.ndarray, k: int) -> list[list[tuple[str, float, str]]]:
        """Per query: [(slug, cosine, source of the best vector)] sorted desc, aggregated per slug by max."""
        sims = queries @ self.vectors.T  # (Q, N)
        out = []
        n_slugs = len(self.slugs)
        for s in sims:
            best = np.full(n_slugs, -2.0, np.float32)
            np.maximum.at(best, self.vec_slug, s)
            top = np.argpartition(-best, min(k, n_slugs - 1))[:k]
            top = top[np.argsort(-best[top])]
            # source of the winning vector per slug
            res = []
            for j in top:
                mask = self.vec_slug == j
                src = self.vec_source[mask][int(np.argmax(s[mask]))]
                res.append((self.slugs[j], float(best[j]), str(src)))
            out.append(res)
        return out


def cos_to_score(cos: float) -> float:
    """Contract score in [0, 1] (higher = closer); for SigLIP image-image cosine the useful range is ~0.6-0.9."""
    return round(float(min(1.0, max(0.0, cos))), 4)


# --------------------------------------------------------------------------- #
# Matcher (implements app.pipeline.Matcher)
# --------------------------------------------------------------------------- #


class EmbeddingCache:
    """Per-request cache of bottle embeddings, shared by the matcher and the label reader.

    Keyed by the PIL image object of the current request and the bottle bbox; only the latest image is kept.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._image_id: int | None = None
        self._data: dict[tuple, np.ndarray] = {}

    def get(self, image: Image.Image, key: tuple) -> np.ndarray | None:
        with self._lock:
            return self._data.get(key) if self._image_id == id(image) else None

    def put(self, image: Image.Image, key: tuple, vec: np.ndarray) -> None:
        with self._lock:
            if self._image_id != id(image):
                self._image_id, self._data = id(image), {}
            self._data[key] = vec


def build_match_result(match_cls: Any, candidate_cls: Any, found: bool, neighbors: list[dict[str, Any]]) -> Any:
    """Builds the pipeline's MatchResult from scored neighbours, filling only the fields the dataclass has
    (the contract grows over time: neighbors / embed_score / source are optional extras)."""
    import dataclasses

    c_fields = {f.name for f in dataclasses.fields(candidate_cls)}
    cands = [candidate_cls(**{k: v for k, v in n.items() if k in c_fields}) for n in neighbors]
    top1 = neighbors[0]["score"] if neighbors else 0.0
    margin = round(top1 - neighbors[1]["score"], 4) if len(neighbors) > 1 else round(top1, 4)
    kw: dict[str, Any] = {
        "found": found and bool(neighbors),
        "slug": neighbors[0]["slug"] if (found and neighbors) else None,
        "top1": top1,
        "margin": margin,
        "top5": cands[:5],
    }
    m_fields = {f.name for f in dataclasses.fields(match_cls)}
    if "neighbors" in m_fields:
        kw["neighbors"] = cands
    return match_cls(**{k: v for k, v in kw.items() if k in m_fields})


class SiglipMatcher:
    """`Matcher`: SigLIP2 naflex-1024 embedding of bbox+10 % -> index search -> neighbours."""

    name = "siglip2-naflex-1024"

    def __init__(
        self,
        embedder: SiglipEmbedder,
        index: VectorIndex,
        match_cls: Any,
        candidate_cls: Any,
        crop_pad: float = 0.10,
        found_min_cos: float = 0.76,
        k: int = 10,
        cache: EmbeddingCache | None = None,
        embed_label_zone: bool = True,
        label_zone_for: str = "primary",
        crop_max_side: int = 0,
    ) -> None:
        self.embedder, self.index = embedder, index
        self.match_cls, self.candidate_cls = match_cls, candidate_cls
        self.crop_pad, self.found_min_cos, self.k = crop_pad, found_min_cos, k
        self.cache = cache or EmbeddingCache()
        self.embed_label_zone = embed_label_zone
        self.label_zone_for = label_zone_for  # "primary" | "all"
        self.crop_max_side = crop_max_side
        self.last_timing: dict[str, float] = {}

    def embed_bottles(self, image: Image.Image, bboxes: list[list[int]], primary: int | None = None, patches: int | None = None) -> np.ndarray:
        """One forward pass for all bottle crops + the label zones the reader will need
        (only the primary bottle's by default: the label zone is one more 1024-patch image)."""
        import time

        crops = [crop_box(image, b, self.crop_pad, self.crop_max_side) for b in bboxes]
        if primary is not None and 0 <= primary < len(bboxes):  # the reader may need to know the main bottle
            self.cache.put(image, ("primary",), np.array(bboxes[primary]))
        if not self.embed_label_zone:
            lab_idx: list[int] = []
        elif self.label_zone_for == "all" or primary is None:
            lab_idx = list(range(len(crops)))
        else:
            lab_idx = [primary] if 0 <= primary < len(crops) else []
        t0 = time.perf_counter()
        if patches:   # shelf: smaller query crops; the primary's label zone keeps full resolution for the vintage reader
            vec = np.concatenate([self.embedder.embed(crops, patches), self.embedder.embed([label_zone(crops[i]) for i in lab_idx])]) \
                if lab_idx else self.embedder.embed(crops, patches)
        else:
            vec = self.embedder.embed(crops + [label_zone(crops[i]) for i in lab_idx])
        self.last_timing["embed"] = round((time.perf_counter() - t0) * 1000, 3)
        crop_vec = vec[: len(crops)]
        for i, b in enumerate(bboxes):
            self.cache.put(image, ("crop", tuple(b)), crop_vec[i])
        for j, i in enumerate(lab_idx):
            self.cache.put(image, ("label", tuple(bboxes[i])), vec[len(crops) + j])
        return crop_vec

    # extended gallery (AMWINE + other Russian wines, ids "amw:<sku>" / "wdb:<id>"): searched only with scope="all"
    ext_index: "VectorIndex | None" = None
    ext_meta: dict = {}
    CATALOG_BONUS = 0.02  # the same wine is often in both galleries: prefer the catalog card on near-ties

    def _search(self, vecs: np.ndarray, k: int, scope: str) -> list[list[tuple[str, float, str]]]:
        res = self.index.search(vecs, k)
        if scope != "all" or self.ext_index is None:
            return res
        ext = self.ext_index.search(vecs, k)
        out = []
        for a, b in zip(res, ext):
            merged = [(s, c, src, c + self.CATALOG_BONUS) for s, c, src in a] + [(s, c, src, c) for s, c, src in b]
            merged.sort(key=lambda x: -x[3])
            out.append([(s, c, src) for s, c, src, _ in merged[:k]])
        return out

    def _neighbors(self, res: list[tuple[str, float, str]]) -> list[dict]:
        out = []
        for s, c, src in res:
            n = {"slug": s, "score": cos_to_score(c), "embed_score": cos_to_score(c), "source": src}
            if s in self.ext_meta:
                n["info"] = self.ext_meta[s]
            out.append(n)
        return out

    def match_many(self, image: Image.Image, bboxes: list[list[int]], k: int | None = None, primary: int | None = None,
                   scope: str = "catalog", patches: int | None = None, found_min_cos: float | None = None) -> list[Any]:
        import time

        k = max(5, k or self.k)
        crop_vec = self.embed_bottles(image, bboxes, primary=primary, patches=patches)
        t0 = time.perf_counter()
        results = self._search(crop_vec, k, scope)
        self.last_timing["search"] = round((time.perf_counter() - t0) * 1000, 3)
        out = []
        for res in results:
            neighbors = self._neighbors(res)
            found = bool(res) and res[0][1] >= (found_min_cos if found_min_cos is not None else self.found_min_cos)
            out.append(build_match_result(self.match_cls, self.candidate_cls, found, neighbors))
        return out

    def match(self, image: Image.Image, bottle: Any, raw_bytes: bytes = b"", force: str | None = None, k: int | None = None) -> Any:
        vec = self.cache.get(image, ("crop", tuple(bottle.bbox)))
        if vec is None:
            return self.match_many(image, [bottle.bbox], k=k)[0]
        res = self.index.search(vec[None], max(5, k or self.k))[0]
        neighbors = [{"slug": s, "score": cos_to_score(c), "embed_score": cos_to_score(c), "source": src} for s, c, src in res]
        return build_match_result(self.match_cls, self.candidate_cls, bool(res) and res[0][1] >= self.found_min_cos, neighbors)
