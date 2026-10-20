"""FastAPI app exposing /recognize, /predict and /health.

Detection: RF-DETR-Seg Small when available (env DETECTOR). Matching: the
deterministic stub by default, or SigLIP2 naflex-1024 + vector index with
MATCHER=siglip (READER=siglip adds zero-shot vintage/colour). Contract:
ML_SERVICE.md.
"""
from __future__ import annotations

import logging
import threading
from contextlib import asynccontextmanager
from typing import Annotated, Literal

from fastapi import FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

from app.catalog import get_catalog
from app.config import settings
from app.mask_utils import MaskField, build_mask_field
from app.pipeline import (
    MODEL_NAME,
    MODEL_VERSION,
    Detector,
    Pipeline,
    StubDetector,
    StubLabelReader,
    StubMatcher,
)
from app.schemas import (
    Bottle,
    BottleMatch,
    Confidence,
    Detection,
    ErrorResponse,
    HealthResponse,
    ImageSize,
    IndexInfo,
    LabelInfo,
    MaskInfo,
    MaskRLE,
    ModelInfo,
    Neighbor,
    PredictResponse,
    ReadResult,
    RecognizeResponse,
    ScoredSlug,
    TimingMs,
)

MasksMode = Literal["polygon", "rle", "none"]

logger = logging.getLogger("app.detector")

# --------------------------------------------------------------------------- #
# Detector singleton: built once (RF-DETR loads a checkpoint into torch, which
# is far too slow to redo per-request). Primarily loaded eagerly at startup via
# the FastAPI lifespan below; `get_detector()` is a thread-safe lazy fallback
# for any code path that runs without the lifespan having fired (e.g. a bare
# `TestClient(app)` with no `with` block).
# --------------------------------------------------------------------------- #

_detector_lock = threading.Lock()
_detector_instance: Detector | None = None
_detector_name: str = "stub"


def _build_detector() -> tuple[Detector, str]:
    mode = settings.detector_mode
    if mode == "stub":
        return StubDetector(), "stub"
    try:
        from app.detector_rfdetr import RFDETRDetector

        detector = RFDETRDetector()
        return detector, detector.name
    except Exception:
        if mode == "rfdetr":
            raise
        logger.warning("RF-DETR detector unavailable; falling back to the stub detector", exc_info=True)
        return StubDetector(), "stub"


def get_detector() -> tuple[Detector, str]:
    global _detector_instance, _detector_name
    if _detector_instance is None:
        with _detector_lock:
            if _detector_instance is None:
                _detector_instance, _detector_name = _build_detector()
    return _detector_instance, _detector_name


def detector_status() -> tuple[str, bool]:
    """Current detector name and whether it has finished loading, without
    triggering a (potentially slow, first-time) load."""
    return _detector_name, _detector_instance is not None


# --------------------------------------------------------------------------- #
# Matcher + label reader: built once. MATCHER=siglip loads the SigLIP2 naflex
# vision tower (shared with READER=siglip) and the vector index; the default
# stub keeps tests fast and deterministic.
# --------------------------------------------------------------------------- #

SIGLIP_MODEL_NAME = "siglip2-naflex-1024+rfdetr-seg-s"
_components_lock = threading.Lock()
_components: dict | None = None


def _build_components() -> dict:
    catalog = get_catalog()
    if settings.matcher_mode != "siglip":
        return {"matcher": StubMatcher(catalog, settings.stub_not_found_every), "reader": StubLabelReader(),
                "demo": True, "model": ModelInfo(name=MODEL_NAME, version=MODEL_VERSION),
                "index": IndexInfo(size=len(catalog), version="stub")}
    from app.matcher_siglip import EmbeddingCache, SiglipEmbedder, SiglipMatcher, VectorIndex, pick_device
    from app.pipeline import MatchResult, Neighbor as PNeighbor, ReadResult as PReadResult

    device = pick_device(settings.device)
    embedder = SiglipEmbedder(settings.embedder_path, device, settings.embed_patches)
    slugs = {catalog.by_index(i)["slug"] for i in range(len(catalog))}
    index = VectorIndex.load(settings.index_path, allowed_slugs=slugs)
    ext_index, ext_meta = None, {}
    if settings.ext_index_path.exists():
        import json as _json
        ext_index = VectorIndex.load(settings.ext_index_path)
        if settings.ext_meta_path.exists():
            ext_meta = _json.load(open(settings.ext_meta_path, encoding="utf-8"))
        logger.info("extended index: %d wines", len(ext_index))
    cache = EmbeddingCache()
    use_reader = settings.reader_mode == "siglip"
    # a fine-tuned matcher tower is no longer aligned with the text embeddings -> the reader gets its own base tower
    separate_reader = use_reader and settings.reader_embedder_path != settings.embedder_path
    matcher = SiglipMatcher(embedder, index, MatchResult, PNeighbor, crop_pad=settings.crop_pad,
                            found_min_cos=settings.found_min_cos, k=settings.neighbors_k, cache=cache,
                            embed_label_zone=use_reader and not separate_reader, label_zone_for=settings.read_bottles,
                            crop_max_side=settings.crop_max_side)
    matcher.ext_index, matcher.ext_meta = ext_index, ext_meta
    if use_reader:
        from app.reader_siglip import SiglipLabelReader

        r_embedder = SiglipEmbedder(settings.reader_embedder_path, device, settings.embed_patches) if separate_reader else embedder
        reader = SiglipLabelReader(r_embedder, settings.reader_text_path, PReadResult, cache, crop_pad=settings.crop_pad,
                                   own_embedder=separate_reader, read_bottles=settings.read_bottles,
                                   crop_max_side=settings.crop_max_side, kind_text_path=settings.kind_text_path)
    else:
        reader = StubLabelReader()
    version = index.meta.get("model", "") or MODEL_VERSION
    logger.info("matcher=siglip device=%s index=%d slugs reader=%s", device, len(index), settings.reader_mode)
    return {"matcher": matcher, "reader": reader, "demo": False, "model": ModelInfo(name=SIGLIP_MODEL_NAME, version=version),
            "index": IndexInfo(size=len(index), version=version)}


def get_components() -> dict:
    global _components
    if _components is None:
        with _components_lock:
            if _components is None:
                _components = _build_components()
    return _components


@asynccontextmanager
async def lifespan(app: FastAPI):
    get_detector()    # warm up once, before the server starts accepting requests
    get_components()
    yield


app = FastAPI(title="Wine Bottle Recognition", version=MODEL_VERSION, lifespan=lifespan)

if settings.cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )


def _model_info() -> ModelInfo:
    return get_components()["model"]


def _pipeline() -> Pipeline:
    catalog = get_catalog()
    detector, _ = get_detector()
    return Pipeline(
        detector=detector,
        matcher=get_components()["matcher"],
        reader=get_components()["reader"],
        catalog=catalog,
    )


def _decode_force(force: str | None) -> str | None:
    """Applies ALLOW_FORCE gating; raises 400 only for an explicitly bad value."""
    if not settings.allow_force or force is None:
        return None
    if force not in ("found", "not_found"):
        raise HTTPException(status_code=400, detail="force must be 'found' or 'not_found'")
    return force


async def _read_bounded(upload: UploadFile) -> bytes:
    data = await upload.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail=f"File exceeds {settings.max_upload_mb} MB limit")
    return data


def _clamp_k(k: int | None) -> int:
    """`?k=` is clamped to [1, 50] rather than rejected with 422: an
    out-of-range value (0, negative, >50) almost always means the caller
    wanted "as few/many as possible", not a malformed request, and a search
    endpoint returning its best-effort answer beats a hard failure here.
    Documented in ML_SERVICE.md section 2/8."""
    if k is None:
        k = settings.neighbors_k
    return max(1, min(k, 50))


def _mask_schema(mask: MaskField | None) -> MaskInfo | None:
    if mask is None:
        return None
    rle = MaskRLE(size=[mask.rle["size"][0], mask.rle["size"][1]], counts=mask.rle["counts"]) if mask.rle else None
    return MaskInfo(polygon=mask.polygon, area=mask.area, rle=rle)


def _label_schema(label_bbox: list[int] | None) -> LabelInfo | None:
    if label_bbox is None:
        return None
    return LabelInfo(bbox=label_bbox, polygon=None, score=None, source="heuristic")


def _confidence_schema(match) -> Confidence:  # noqa: ANN001 - app.pipeline.MatchResult
    return Confidence(
        top1=match.top1,
        margin=match.margin,
        top5=[ScoredSlug(slug=c.slug, score=c.score) for c in match.top5],
    )


def _read_schema(read) -> ReadResult:  # noqa: ANN001 - app.pipeline.ReadResult
    return ReadResult(color=read.color, sweetness=read.sweetness, vintage=read.vintage, text=read.text,
                      kind=getattr(read, "kind", None), kind_p=getattr(read, "kind_p", None))



from app.realtime import router as rt_router  # noqa: E402  real-time endpoints (/rt/*)
app.include_router(rt_router)

@app.get("/", include_in_schema=False)
def root() -> RedirectResponse:
    return RedirectResponse(url="/docs")


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    catalog = get_catalog()
    detector_name, detector_ready = detector_status()
    return HealthResponse(
        status="ok",
        model=_model_info(),
        catalog_size=len(catalog),
        detector=detector_name,
        detector_ready=detector_ready,
        index=get_components()["index"],
    )


@app.post(
    "/recognize",
    response_model=RecognizeResponse,
    response_model_exclude_none=False,
    responses={400: {"model": ErrorResponse}, 413: {"model": ErrorResponse}},
)
async def recognize(
    file: Annotated[UploadFile | None, File()] = None,
    force: str | None = Query(default=None),
    masks: MasksMode = Query(default="polygon"),
    k: int | None = Query(default=None),
    scope: Literal["catalog", "all"] | None = Query(default=None, description="catalog: only svo-vino; all: + international / other Russian wines (AMWINE, winedb)"),
    max_bottles: int | None = Query(default=None, ge=1, le=64, description="match only the N largest bottles (live AR frames); default: the MAX_BOTTLES setting"),
) -> RecognizeResponse:
    if file is None:
        raise HTTPException(status_code=400, detail="No file provided")
    data = await _read_bounded(file)
    forced = _decode_force(force)
    k_clamped = _clamp_k(k)

    try:
        result = _pipeline().run(data, force=forced, k=k_clamped, scope=scope or settings.default_scope, max_bottles=max_bottles)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 - any decode failure becomes a 400
        raise HTTPException(status_code=400, detail="Could not decode image") from exc

    bottles = [
        Bottle(
            bbox=br.detection.bbox,
            label_bbox=br.detection.label_bbox,
            center=br.detection.center,
            score=br.detection.score,
            source=br.detection.source,
            mask=_mask_schema(
                build_mask_field(br.detection.mask_raw, masks, result.width, result.height)
            ),
            label=_label_schema(br.detection.label_bbox),
            match=BottleMatch(
                status="found" if br.match.found else "not_found",
                slug=br.match.slug,
                confidence=_confidence_schema(br.match),
                neighbors=[
                    Neighbor(slug=nb.slug, score=nb.score, embed_score=nb.embed_score, source=nb.source, info=getattr(nb, "info", None))
                    for nb in br.match.neighbors
                ],
                read=_read_schema(br.read),
            ),
        )
        for br in result.bottles
    ]

    primary = result.bottles[result.primary]
    return RecognizeResponse(
        status="found" if primary.match.found else "not_found",
        slug=primary.match.slug,
        confidence=_confidence_schema(primary.match),
        read=_read_schema(primary.read),
        primary=result.primary,
        detection=Detection(
            image=ImageSize(width=result.width, height=result.height),
            detector=result.detector,
            bottles=bottles,
        ),
        timing_ms=TimingMs(**result.timing_ms),
        model=_model_info(),
        demo=get_components()["demo"],
    )


@app.post("/predict", response_model=PredictResponse)
async def predict(request: Request) -> PredictResponse:
    """Organiser's checker: multipart field 'file'/'image', or a raw image body.

    Answers the top-1 slug of the primary bottle even when the match is below the
    "found" threshold. Never fails: any problem (missing field, unsupported content
    type, empty or oversized body, a corrupt image, a model error) is logged and
    answered with the flat `{"slug": ""}` at HTTP 200, so it can never abort the
    organiser's scoring run. `/recognize` is the endpoint that keeps normal
    400/413/503 semantics.
    """
    try:
        content_type = request.headers.get("content-type", "")

        if content_type.startswith("multipart/form-data"):
            form = await request.form()
            upload = form.get("file") or form.get("image")
            if upload is None or not hasattr(upload, "read"):
                raise ValueError("No file field found")
            data = await upload.read()
        elif (
            content_type == ""
            or content_type.startswith("image/")
            or content_type.startswith("application/octet-stream")
        ):
            data = await request.body()
        else:
            raise ValueError(f"Unsupported content type: {content_type}")

        if not data:
            raise ValueError("Empty file")
        if len(data) > settings.max_upload_bytes:
            raise ValueError(f"File exceeds {settings.max_upload_mb} MB limit")

        result = _pipeline().run(data, k=settings.neighbors_k, only_primary=True)
        # Always the top-1 slug of the primary bottle, even when it is below the "found" threshold: every photo in
        # the organiser's test is a catalog wine, so an empty answer is a guaranteed miss. not_found + analogs is a
        # /recognize (website) concept only.
        m = result.bottles[result.primary].match
        top = m.slug or (m.neighbors[0].slug if m.neighbors else (m.top5[0].slug if m.top5 else ""))
        return PredictResponse(slug=top)
    except Exception:  # noqa: BLE001 - /predict must never fail the organiser's run
        logger.warning("/predict failed; returning {'slug': ''}", exc_info=True)
        return PredictResponse(slug="")
