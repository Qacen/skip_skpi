"""Pydantic v2 response models for the /recognize, /predict and /health contract."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

DetectorName = Literal["rfdetr-seg-small", "stub"]
BottleSource = Literal["detector", "full_image"]
LabelSource = Literal["heuristic", "detector"]

API_VERSION = "1.1"


class ScoredSlug(BaseModel):
    slug: str
    score: float


class Neighbor(ScoredSlug):
    embed_score: float
    source: str  # "catalog" | "amwine" | "winedb_ru" (external wines appear only with ?scope=all)
    info: dict | None = Field(default=None, exclude_if=lambda v: v is None)  # external wine card (only for non-catalog neighbours)


class Confidence(BaseModel):
    top1: float
    margin: float
    top5: list[ScoredSlug]


class ReadResult(BaseModel):
    color: str | None = None
    sweetness: str | None = None
    vintage: str | None = None
    text: str | None = None
    kind: str | None = None        # bottles not found in the catalog: wine | sparkling | water | soda | beer | juice | spirits | other
    kind_p: float | None = None


class ImageSize(BaseModel):
    width: int
    height: int


class MaskRLE(BaseModel):
    """COCO run-length encoding: `size` is `[height, width]`; `counts` is a
    compressed base64-ish string (pycocotools-compatible) or, for a hand-rolled
    uncompressed fallback, a flat list of run lengths."""

    size: list[int] = Field(min_length=2, max_length=2)
    counts: str | list[int]


class MaskInfo(BaseModel):
    # `polygon`/`rle` are mutually exclusive with each other (selected by
    # `?masks=`); `area` is always present when `mask` itself is not null.
    polygon: list[list[int]] | None = None
    area: int
    rle: MaskRLE | None = None


class LabelInfo(BaseModel):
    bbox: list[int] = Field(min_length=4, max_length=4)
    polygon: list[list[int]] | None = None  # null until a real label detector exists
    score: float | None = None
    source: LabelSource = "heuristic"


class BottleMatch(BaseModel):
    status: Literal["found", "not_found"]
    slug: str | None
    confidence: Confidence
    neighbors: list[Neighbor]
    read: ReadResult


class Bottle(BaseModel):
    bbox: list[int] = Field(min_length=4, max_length=4)
    label_bbox: list[int] | None = Field(default=None, min_length=4, max_length=4)
    center: list[int] = Field(min_length=2, max_length=2)
    score: float
    source: BottleSource
    mask: MaskInfo | None = None
    label: LabelInfo | None = None
    match: BottleMatch


class Detection(BaseModel):
    image: ImageSize
    detector: DetectorName
    bottles: list[Bottle]


class TimingMs(BaseModel):
    decode: float
    detect: float
    embed: float
    search: float
    rerank: float
    read: float
    total: float


class ModelInfo(BaseModel):
    name: str
    version: str


class IndexInfo(BaseModel):
    size: int
    version: str


class RecognizeResponse(BaseModel):
    api_version: str = API_VERSION
    # Copies of the PRIMARY bottle's match, kept for backward compatibility
    # (/predict is built from these).
    status: Literal["found", "not_found"]
    slug: str | None
    confidence: Confidence
    read: ReadResult
    primary: int  # index into detection.bottles, always valid
    detection: Detection
    timing_ms: TimingMs
    model: ModelInfo
    demo: bool


class PredictResponse(BaseModel):
    """Flat response for the organiser's checker script: no extra keys."""

    slug: str


class HealthResponse(BaseModel):
    status: Literal["ok"]
    model: ModelInfo
    catalog_size: int
    detector: DetectorName
    detector_ready: bool
    index: IndexInfo


class ErrorResponse(BaseModel):
    detail: str
