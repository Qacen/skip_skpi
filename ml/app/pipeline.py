"""Recognition pipeline: decode -> detect -> match -> read (per bottle).

This module defines the interfaces the real ML components will implement
(`Detector`, `Matcher`, `LabelReader`) plus deterministic stub implementations
so the API contract can be exercised end-to-end before the real model exists.

Where the real model plugs in
------------------------------
- `Detector.detect`  -> `app.detector_rfdetr.RFDETRDetector` (RF-DETR-Seg
  Small) segments bottle(s) in the photo; see `app/detect_postprocess.py` for
  the dedup/area-filter/ordering/primary-choice/label_bbox logic shared by
  the real detector and its tests. `StubDetector` remains available
  (`DETECTOR=stub`) and always reports exactly one bottle.
- `Matcher.match`     -> replace `StubMatcher` with: SigLIP2 embedding of the
  cropped label -> pgvector top-K nearest neighbour search -> a re-ranking step.
- `LabelReader.read`  -> replace `StubLabelReader` with OCR (free-text `text`)
  plus attribute classifiers/heuristics for color/sweetness/vintage.

`Pipeline` itself does not change: it detects once, then matches+reads every
detected bottle independently, and times each stage.
"""
from __future__ import annotations

import hashlib
import io
import time
from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable

from PIL import Image, ImageOps

from app.catalog import Catalog
from app.config import settings

MODEL_NAME = "wine-label-stub"
MODEL_VERSION = "0.2.0-multibottle"

# Alpha-compositing background: the website's page background (#fdfbf6), not
# black -- a PNG with transparency (screenshot, cut-out sticker, ...) should
# blend in the way it would on the site, not gain a black halo.
ALPHA_BACKGROUND = (0xFD, 0xFB, 0xF6)

# HEIC/HEIF support is optional: `pillow-heif` is a small, self-contained wheel
# (bundles libheif) so it is worth registering when present, but its absence
# must not break JPEG/PNG/WEBP decoding.
try:
    import pillow_heif

    pillow_heif.register_heif_opener()
except Exception:  # pragma: no cover - exercised only when the dep is missing
    pass


# --------------------------------------------------------------------------- #
# Data types passed between pipeline stages
# --------------------------------------------------------------------------- #


@dataclass
class BottleDetection:
    bbox: list[int]
    label_bbox: list[int] | None
    center: list[int]
    score: float
    source: str  # "detector" | "full_image"
    # Real detector's raw segmentation mask (`app.mask_utils.RawMask`), still
    # in small/resized-image space; `None` for the stub detector and the
    # `full_image` pseudo-bottle. Turned into the response `mask` field by
    # `app.mask_utils.build_mask_field` according to `?masks=`.
    mask_raw: Any = None


@dataclass
class DetectionResult:
    width: int
    height: int
    detector: str  # "rfdetr-seg-small" | "stub"
    bottles: list[BottleDetection]
    primary: int  # index into `bottles`, always valid
    shelf: bool = False  # many bottles (shelf photo): crops embedded at SHELF_EMBED_PATCHES


@dataclass
class Neighbor:
    """One nearest-catalog-entry candidate (`match.neighbors[i]` / `confidence.top5[i]`)."""

    slug: str
    score: float
    embed_score: float
    source: str  # "catalog" | "video" | "amwine" | "winedb_ru" (always "catalog" for the stub)
    info: dict | None = None  # for external (non-catalog) wines: name, producer, country, color, sugar, price_rub, url


@dataclass
class MatchResult:
    found: bool
    slug: str | None
    top1: float
    margin: float
    # Always up to 5 entries (or the catalog size, if smaller) -- independent
    # of the request's `?k=`; mirrored at `confidence.top5` (slug + score
    # only). `neighbors` is the same underlying ranking truncated to `k`, so
    # `top5 == neighbors[:5]` whenever `k >= 5`.
    top5: list[Neighbor] = field(default_factory=list)
    neighbors: list[Neighbor] = field(default_factory=list)


@dataclass
class ReadResult:
    color: str | None
    sweetness: str | None
    vintage: str | None
    text: str | None
    kind: str | None = None       # drink kind (wine / sparkling / water / soda / beer / juice / spirits / other), not-found bottles only
    kind_p: float | None = None


@dataclass
class BottleResult:
    detection: BottleDetection
    match: MatchResult
    read: ReadResult


@dataclass
class PipelineOutput:
    width: int
    height: int
    detector: str
    bottles: list[BottleResult]
    primary: int
    timing_ms: dict[str, float]


# --------------------------------------------------------------------------- #
# Interfaces the real model will implement
# --------------------------------------------------------------------------- #


@runtime_checkable
class Detector(Protocol):
    """Finds bottle(s) in the photo.

    Real implementation: `app.detector_rfdetr.RFDETRDetector`, an RF-DETR-Seg
    instance-segmentation wrapper. Returns one bbox (from the segmentation
    mask) per bottle plus a tighter label bbox used to crop before matching.
    """

    def detect(self, image: Image.Image) -> DetectionResult: ...


@runtime_checkable
class Matcher(Protocol):
    """Embeds the (cropped) label of one bottle and finds nearest catalog entries.

    Real implementation: SigLIP2 image embedding of the label crop -> pgvector
    approximate top-K search over the catalog -> a re-ranking step (e.g. a
    cross-encoder or a metadata-aware boost) to pick the final top1/top5.

    `force` is a stub-only testing hook (see config.ALLOW_FORCE); a real
    matcher does not need to support it. `k` bounds `MatchResult.neighbors`'
    length (already clamped to [1, 50] by `app.main`); it does not affect
    `top1`/`margin`/`top5`, which always rank over up to 5 candidates.
    """

    def match(
        self,
        image: Image.Image,
        bottle: BottleDetection,
        raw_bytes: bytes,
        force: str | None = None,
        k: int = 10,
    ) -> MatchResult: ...


@runtime_checkable
class LabelReader(Protocol):
    """Reads auxiliary attributes off one bottle's label (OCR + attributes).

    Real implementation: OCR (classic engine or a small VLM) for the free-text
    field, plus classifiers/heuristics for color/sweetness/vintage that can be
    cross-checked against the matched catalog entry.
    """

    def read(
        self,
        image: Image.Image,
        bottle: BottleDetection,
        match: MatchResult,
        catalog: Catalog,
    ) -> ReadResult: ...


# --------------------------------------------------------------------------- #
# Stub implementations
# --------------------------------------------------------------------------- #


class StubDetector:
    """Always reports exactly one bottle, in a fixed central band."""

    name = "stub"

    def detect(self, image: Image.Image) -> DetectionResult:
        width, height = image.size
        landscape = width > height

        if landscape:
            bx1, by1 = 0.40 * width, 0.05 * height
            bx2, by2 = 0.60 * width, 0.95 * height
        else:
            bx1, by1 = 0.34 * width, 0.08 * height
            bx2, by2 = 0.66 * width, 0.95 * height

        bbox = [round(bx1), round(by1), round(bx2), round(by2)]
        bw = bbox[2] - bbox[0]
        bh = bbox[3] - bbox[1]

        label_bbox = [
            round(bbox[0] + 0.06 * bw),
            round(bbox[1] + 0.45 * bh),
            round(bbox[2] - 0.06 * bw),
            round(bbox[1] + 0.80 * bh),
        ]
        center = [round((bbox[0] + bbox[2]) / 2), round((bbox[1] + bbox[3]) / 2)]

        bottle = BottleDetection(bbox=bbox, label_bbox=label_bbox, center=center, score=0.9, source="detector")
        return DetectionResult(width=width, height=height, detector=self.name, bottles=[bottle], primary=0)


class StubMatcher:
    """Deterministic pseudo-match derived from sha1(raw upload bytes + bbox).

    Mixing the bottle's bbox into the hash means different bottles on the same
    multi-bottle photo get different, deterministic matches. Mirrors the demo
    logic already used by the Nuxt frontend (web/server/utils/recognizer.ts)
    so both sides agree while there is no real model.
    """

    def __init__(self, catalog: Catalog, not_found_every: int) -> None:
        self.catalog = catalog
        self.not_found_every = not_found_every

    @staticmethod
    def _distinct_indices(h: bytes, count: int, n: int) -> list[int]:
        """`count` distinct catalog indices in [0, n), deterministic from `h`.

        Reads 4-byte chunks of `h` (offsets 0, 4, 8, 12, 16 -- a 20-byte SHA1
        digest gives exactly 5), then extends the stream by re-hashing `h`
        with an incrementing counter for `count > 5` (the `?k=` case). The
        first 5 indices are byte-for-byte identical to the original 5-slot
        scheme, so existing determinism/uniqueness invariants are preserved.
        """
        indices: list[int] = []
        block_no = 0
        block = h
        while len(indices) < count:
            for offset in range(0, len(block) - 3, 4):
                idx = int.from_bytes(block[offset : offset + 4], "big") % n
                while idx in indices:
                    idx = (idx + 1) % n
                indices.append(idx)
                if len(indices) >= count:
                    break
            block_no += 1
            block = hashlib.sha1(h + block_no.to_bytes(2, "big")).digest()
        return indices

    @staticmethod
    def _score_sequence(top1_raw: float, count: int, found: bool) -> list[float]:
        """Monotonically non-increasing scores, first 5 matching the original scheme."""
        deltas = [0.0, 0.23 if found else 0.03, 0.27, 0.30, 0.33]
        while len(deltas) < count:
            deltas.append(deltas[-1] + 0.03)
        return [round(min(1.0, max(0.0, top1_raw - d)), 3) for d in deltas[:count]]

    def match(
        self,
        image: Image.Image,
        bottle: BottleDetection,
        raw_bytes: bytes,
        force: str | None = None,
        k: int = 10,
    ) -> MatchResult:
        n = len(self.catalog)
        if n == 0:
            return MatchResult(found=False, slug=None, top1=0.0, margin=0.0, top5=[], neighbors=[])

        k_clamped = max(1, min(k, 50))
        # Always rank at least 5 (or the whole catalog) candidates so top1/
        # margin/top5 stay well-defined regardless of how few neighbors were
        # actually requested; `neighbors` below just truncates the same list.
        count = min(max(k_clamped, 5), n)

        bbox_suffix = ",".join(str(v) for v in bottle.bbox).encode("ascii")
        h = hashlib.sha1(raw_bytes + b"|" + bbox_suffix).digest()

        natural_found = self.not_found_every <= 0 or h[0] % self.not_found_every != 0
        if force == "found":
            found = True
        elif force == "not_found":
            found = False
        else:
            found = natural_found

        indices = self._distinct_indices(h, count, n)
        top1_raw = (0.86 + (h[1] % 12) / 100) if found else (0.41 + (h[1] % 10) / 100)
        scores = self._score_sequence(top1_raw, count, found)
        margin = round(scores[0] - scores[1], 3) if len(scores) > 1 else scores[0]

        slugs = [self.catalog.by_index(i)["slug"] for i in indices]
        ranked = [
            Neighbor(
                slug=s,
                score=sc,
                embed_score=round(min(1.0, max(0.0, sc + ((h[(2 + i) % len(h)] % 9) - 4) / 100)), 3),
                source="catalog",
            )
            for i, (s, sc) in enumerate(zip(slugs, scores))
        ]

        return MatchResult(
            found=found,
            slug=slugs[0] if found else None,
            top1=scores[0],
            margin=margin,
            top5=ranked[:5],
            neighbors=ranked[:k_clamped],
        )


class StubLabelReader:
    """Reports the color/sweetness/vintage of the top-1 candidate; no OCR yet."""

    def read(
        self,
        image: Image.Image,
        bottle: BottleDetection,
        match: MatchResult,
        catalog: Catalog,
    ) -> ReadResult:
        if not match.top5:
            return ReadResult(color=None, sweetness=None, vintage=None, text=None)

        item = catalog.by_slug(match.top5[0].slug) or {}
        vintage = item.get("year") or None
        return ReadResult(color=item.get("color"), sweetness=item.get("sweetness"), vintage=vintage, text=None)


# --------------------------------------------------------------------------- #
# Orchestration
# --------------------------------------------------------------------------- #


def decode_image(raw_bytes: bytes) -> Image.Image:
    """Bytes -> EXIF-transposed RGB image, ready for the detector.

    - Rotates/flips per the EXIF orientation tag.
    - A PNG (or any image) with an alpha channel is composited onto the
      site's page background `#fdfbf6` -- *not* black -- before anything
      else touches it, so a transparent background renders the way it would
      on the site.
    - HEIC/HEIF decodes too when `pillow-heif` is installed (see the module
      import above); otherwise it raises like any other undecodable image.
    """
    image = ImageOps.exif_transpose(Image.open(io.BytesIO(raw_bytes)))
    if image is None:  # pragma: no cover - exif_transpose only returns None for None input
        raise ValueError("could not decode image")

    if image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info):
        rgba = image.convert("RGBA")
        background = Image.new("RGB", rgba.size, ALPHA_BACKGROUND)
        background.paste(rgba, mask=rgba.split()[-1])
        return background

    if image.mode != "RGB":
        image = image.convert("RGB")
    return image


class Pipeline:
    def __init__(self, detector: Detector, matcher: Matcher, reader: LabelReader, catalog: Catalog) -> None:
        self.detector = detector
        self.matcher = matcher
        self.reader = reader
        self.catalog = catalog

    def run(self, raw_bytes: bytes, force: str | None = None, k: int = 10, only_primary: bool = False, scope: str = "catalog",
            max_bottles: int | None = None) -> PipelineOutput:
        t0 = time.perf_counter()
        image = decode_image(raw_bytes)
        t1 = time.perf_counter()

        detection = self.detector.detect(image)
        if only_primary and len(detection.bottles) > 1:  # /predict: match only the main bottle (one embedding)
            detection.bottles = [detection.bottles[detection.primary]]
            detection.primary = 0
        elif max_bottles and len(detection.bottles) > max_bottles:
            # per-request cap (live AR frames: the front row only, a fast answer): the largest bottles, left -> right order kept,
            # the primary one kept if it survives; the MAX_BOTTLES setting stays the cap of photos
            def _area(b) -> float:
                x0, y0, x1, y1 = b.bbox
                return max(0.0, x1 - x0) * max(0.0, y1 - y0)
            keep = sorted(range(len(detection.bottles)), key=lambda i: _area(detection.bottles[i]), reverse=True)[:max_bottles]
            if detection.primary not in keep:
                keep[-1] = detection.primary
            keep.sort()
            detection.primary = keep.index(detection.primary)
            detection.bottles = [detection.bottles[i] for i in keep]
        t2 = time.perf_counter()

        # Stub matcher: everything happens in one pass (no real embedding/
        # search/rerank stages), so the whole elapsed time is attributed to
        # `embed` -- the stage a real matcher would spend it on -- and
        # `search`/`rerank` genuinely are 0, not just reported as such.
        # A real matcher embeds all bottles in ONE model pass (`match_many`); the stub goes bottle by bottle.
        last_timing = getattr(self.matcher, "last_timing", None)
        if isinstance(last_timing, dict):
            last_timing.clear()
        if hasattr(self.matcher, "match_many"):
            matches = self.matcher.match_many(image, [b.bbox for b in detection.bottles], k=k, primary=detection.primary, scope=scope,
                                              patches=settings.shelf_embed_patches if detection.shelf else None,
                                              found_min_cos=settings.shelf_found_min_cos if detection.shelf else None)
        else:
            matches = [self.matcher.match(image, bottle, raw_bytes, force=force, k=k) for bottle in detection.bottles]
        for m in matches:  # the contract: neighbors has length k (top5 is kept separately)
            m.neighbors = m.neighbors[:k]
        t3 = time.perf_counter()

        reads = [
            self.reader.read(image, bottle, match, self.catalog)
            for bottle, match in zip(detection.bottles, matches)
        ]
        # not in the catalog: is it wine at all? (AR on any bottle: a water / soda bottle gets «Бутылка воды», not «нет в каталоге»)
        nf = [i for i, m in enumerate(matches) if not m.found]
        if nf and hasattr(self.reader, "kinds"):
            try:
                for i, (kd, kp) in zip(nf, self.reader.kinds(image, [detection.bottles[i].bbox for i in nf])):
                    reads[i].kind, reads[i].kind_p = kd, kp
            except Exception:  # noqa: BLE001 - the drink kind is a hint, never a failure
                pass
        t4 = time.perf_counter()

        bottles = [
            BottleResult(detection=b, match=m, read=r) for b, m, r in zip(detection.bottles, matches, reads)
        ]

        mt = last_timing if isinstance(last_timing, dict) else {}
        timing_ms = {
            "decode": round((t1 - t0) * 1000, 3),
            "detect": round((t2 - t1) * 1000, 3),
            "embed": round(mt.get("embed", (t3 - t2) * 1000), 3),
            "search": round(mt.get("search", 0.0), 3),
            "rerank": 0.0,
            "read": round((t4 - t3) * 1000, 3),
            "total": round((t4 - t0) * 1000, 3),
        }
        return PipelineOutput(
            width=detection.width,
            height=detection.height,
            detector=detection.detector,
            bottles=bottles,
            primary=detection.primary,
            timing_ms=timing_ms,
        )
