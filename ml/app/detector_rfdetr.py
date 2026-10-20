"""Real bottle detector: RF-DETR-Seg Small (instance segmentation), CPU/MPS.

Loaded once (see `app.main`'s lifespan / lazy singleton) and reused across
requests -- constructing `RFDETRSegSmall` loads a ~135MB checkpoint into torch,
which takes well over a second and must not happen per-request.

Pipeline for one image:
  1. Resize so the long side is <= `_MAX_LONG_SIDE` px (keeps CPU inference
     fast on large phone photos); remember the scale factor.
  2. `model.predict(...)` on the resized image -> `supervision.Detections`.
  3. Keep only COCO class 44 ("bottle").
  4. Per surviving box: compute `label_bbox` from the (small-scale) mask, then
     scale bbox + label_bbox back up to the original image's pixel space --
     cheaper than resizing the boolean mask array itself.
  5. Hand the candidate list to `app.detect_postprocess` for dedup / area
     filtering / capping / left-to-right ordering / primary-bottle choice, and
     fall back to a whole-image pseudo bottle if nothing survives.
"""
from __future__ import annotations

import logging
import math
import os
from typing import Any

from PIL import Image

from app.config import settings
from app.detect_postprocess import (
    cap_largest,
    compute_label_bbox,
    compute_primary_index,
    dedup_detections,
    filter_by_area,
    full_image_bottle,
    center_crop_bottle,
    pick_central_index,
    spans_center_line,
    order_left_to_right,
)
from app.mask_utils import RawMask
from app.pipeline import BottleDetection, DetectionResult

logger = logging.getLogger("app.detector_rfdetr")

COCO_BOTTLE_CLASS_ID = 44
_MAX_LONG_SIDE = 1280


def _resize_long_side(image: Image.Image, max_side: int) -> tuple[Image.Image, float, float]:
    """Returns (resized_image, scale_x, scale_y) where scale_* map a coordinate
    in the resized image back to the original: `orig = small * scale`.
    """
    width, height = image.size
    long_side = max(width, height)
    if long_side <= max_side:
        return image, 1.0, 1.0
    factor = max_side / long_side
    new_w = max(1, round(width * factor))
    new_h = max(1, round(height * factor))
    resized = image.resize((new_w, new_h), Image.BILINEAR)
    return resized, width / new_w, height / new_h


def _scale_box(box: list[float], scale_x: float, scale_y: float) -> list[float]:
    x1, y1, x2, y2 = box
    return [x1 * scale_x, y1 * scale_y, x2 * scale_x, y2 * scale_y]


def _crop_mask(
    mask_small: Any,
    bbox_small: list[float],
    small_size: tuple[int, int],
    scale_x: float,
    scale_y: float,
) -> RawMask | None:
    """Crops the (small-image-space) boolean mask to its bbox and wraps it as
    a `RawMask`, deferring the expensive polygon/RLE work (`app.mask_utils`)
    until a response actually needs it. `None` when there is no seg mask
    (checkpoint without a seg head) or the crop is empty.
    """
    if mask_small is None:
        return None
    small_width, small_height = small_size
    x1, y1, x2, y2 = bbox_small
    mx1 = max(0, int(math.floor(x1)))
    my1 = max(0, int(math.floor(y1)))
    mx2 = min(mask_small.shape[1], int(math.ceil(x2)))
    my2 = min(mask_small.shape[0], int(math.ceil(y2)))
    if mx2 <= mx1 or my2 <= my1:
        return None
    return RawMask(
        submask=mask_small[my1:my2, mx1:mx2],
        offset_x=mx1,
        offset_y=my1,
        small_width=small_width,
        small_height=small_height,
        scale_x=scale_x,
        scale_y=scale_y,
    )


def _load_model() -> Any:
    import torch
    import rfdetr

    # RFDETR_VARIANT=seg-nano: the smaller sibling (input 312 vs 384, same backbone), e.g. for the live AR detector
    variant = os.environ.get("RFDETR_VARIANT", "seg-small").strip().lower()
    RFDETRSegSmall = rfdetr.RFDETRSegNano if variant == "seg-nano" else rfdetr.RFDETRSegSmall
    settings.weights_dir.mkdir(parents=True, exist_ok=True)
    weights_path = str(settings.weights_dir / ("rf-detr-seg-nano.pt" if variant == "seg-nano" else "rf-detr-seg-small.pt"))

    device = settings.device
    if device == "mps" and not torch.backends.mps.is_available():
        logger.warning("DEVICE=mps requested but MPS is not available on this machine; using cpu")
        device = "cpu"
    if device == "cuda" and not torch.cuda.is_available():
        logger.warning("DEVICE=cuda requested but CUDA is not available; using cpu")
        device = "cpu"

    try:
        model = RFDETRSegSmall(pretrain_weights=weights_path, device=device)
    except Exception:
        if device == "cpu":
            raise
        logger.exception("Failed to load RF-DETR on device=%s; retrying on cpu", device)
        model = RFDETRSegSmall(pretrain_weights=weights_path, device="cpu")

    optimize = getattr(model, "optimize_for_inference", None)
    if callable(optimize):
        try:
            optimize()
        except Exception:
            logger.warning("model.optimize_for_inference() failed; continuing unoptimized", exc_info=True)

    return model


class RFDETRDetector:
    """`Detector` implementation backed by RF-DETR-Seg Small."""

    name = "rfdetr-seg-small"

    def __init__(self) -> None:
        self._model = _load_model()

    def detect(self, image: Image.Image) -> DetectionResult:
        width, height = image.size
        small, scale_x, scale_y = _resize_long_side(image, _MAX_LONG_SIDE)

        low = min(settings.rescue_threshold, settings.detect_threshold, settings.shelf_detect_threshold)
        detections = self._model.predict(small, threshold=low)

        masks = detections.mask  # (N, h, w) bool, or None if the checkpoint has no seg head
        candidates: list[dict[str, Any]] = []
        for i in range(len(detections.xyxy)):
            if int(detections.class_id[i]) != COCO_BOTTLE_CLASS_ID:
                continue

            bbox_small = [float(v) for v in detections.xyxy[i]]
            mask_small = masks[i] if masks is not None else None
            label_bbox_small = compute_label_bbox(bbox_small, mask_small)

            bbox = _scale_box(bbox_small, scale_x, scale_y)
            label_bbox = _scale_box(label_bbox_small, scale_x, scale_y) if label_bbox_small is not None else None

            candidates.append(
                {
                    "bbox": bbox,
                    "label_bbox": label_bbox,
                    "score": float(detections.confidence[i]),
                    "source": "detector",
                    "mask_raw": _crop_mask(mask_small, bbox_small, small.size, scale_x, scale_y),
                }
            )

        low_all = filter_by_area(dedup_detections(candidates), width, height, settings.min_bottle_area)
        candidates = [c for c in low_all if c["score"] >= settings.detect_threshold]
        if len(candidates) >= settings.shelf_min_bottles:   # shelf: also keep the weaker boxes
            candidates = [c for c in low_all if c["score"] >= min(settings.shelf_detect_threshold, settings.detect_threshold)]
        candidates = cap_largest(candidates, settings.max_bottles)
        # Central-bottle rescue: the photographed wine is almost always the central one. If no confident box that is
        # tall enough crosses the vertical centre line, add the best such box found at the lower threshold; if there
        # is none either, add a centre-crop pseudo bottle (it becomes the primary one).
        def is_central(c: dict[str, Any]) -> bool:
            x1, y1, x2, y2 = c["bbox"]
            return spans_center_line(c["bbox"], width) and (y2 - y1) >= settings.central_min_height * height

        shelf = len(candidates) >= settings.shelf_min_bottles
        if not shelf and not any(is_central(c) for c in candidates):
            central = [c for c in low_all if is_central(c) and all(c is not k for k in candidates)]
            j = pick_central_index(central, width, height)
            candidates = dedup_detections(candidates + [central[j]]) if j is not None else candidates + [center_crop_bottle(width, height)]
        candidates = order_left_to_right(candidates)

        if not candidates:
            candidates = [center_crop_bottle(width, height)]

        bottles: list[BottleDetection] = []
        for c in candidates:
            bx1, by1, bx2, by2 = c["bbox"]
            bbox_int = [round(bx1), round(by1), round(bx2), round(by2)]

            label_bbox_int: list[int] | None = None
            if c.get("label_bbox") is not None:
                lx1, ly1, lx2, ly2 = c["label_bbox"]
                label_bbox_int = [round(lx1), round(ly1), round(lx2), round(ly2)]

            center = c.get("center")
            if center is None:
                center = [round((bbox_int[0] + bbox_int[2]) / 2), round((bbox_int[1] + bbox_int[3]) / 2)]

            bottles.append(
                BottleDetection(
                    bbox=bbox_int,
                    label_bbox=label_bbox_int,
                    center=center,
                    score=round(float(c["score"]), 4),
                    source=c["source"],
                    mask_raw=c.get("mask_raw"),
                )
            )

        if shelf:   # shelf photo: every bottle is equally small -> the most central one is the primary
            j = pick_central_index([{"bbox": b.bbox, "score": b.score or 0.01} for b in bottles], width, height)
            primary = j if j is not None else 0
        elif settings.primary_rule == "center_line":
            tall = [i for i, b in enumerate(bottles) if (b.bbox[3] - b.bbox[1]) >= settings.central_min_height * height]
            pool = tall or list(range(len(bottles)))
            j = pick_central_index([{"bbox": bottles[i].bbox, "score": bottles[i].score or 0.01} for i in pool], width, height)
            primary = pool[j] if j is not None else 0
        else:
            primary = compute_primary_index([b.bbox for b in bottles], width, height)
        return DetectionResult(width=width, height=height, detector=self.name, bottles=bottles, primary=primary, shelf=shelf)
