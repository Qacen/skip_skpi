"""Detector-agnostic post-processing for multi-bottle detection.

Pure functions operating on plain dicts (``{"bbox": [x1,y1,x2,y2], "score": float,
...}``); extra keys pass through untouched. No PIL/numpy/torch import at module
scope, so this module is unit-testable with synthetic boxes even when the
optional RF-DETR/torch dependencies are not installed. `compute_label_bbox`
only needs numpy when it is actually given a mask (the real-detector path),
so that import happens lazily inside `find_shoulder_row`.

Used by `app.detector_rfdetr.RFDETRDetector` to turn raw per-box model output
into the final ordered list of bottles the API contract describes, and
exercised directly (without any model) by `tests/test_postprocess.py`.
"""
from __future__ import annotations

import math
from typing import Any, Sequence

Box = Sequence[float]  # [x1, y1, x2, y2]


def box_area(box: Box) -> float:
    x1, y1, x2, y2 = box
    return max(0.0, x2 - x1) * max(0.0, y2 - y1)


def iou(a: Box, b: Box) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    union = box_area(a) + box_area(b) - inter
    return inter / union if union > 0 else 0.0


def contained_ratio(a: Box, b: Box) -> float:
    """Fraction of `a`'s area that lies inside `b`."""
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    area_a = box_area(a)
    return inter / area_a if area_a > 0 else 0.0


def dedup_detections(
    items: list[dict[str, Any]],
    iou_threshold: float = 0.6,
    containment_threshold: float = 0.9,
) -> list[dict[str, Any]]:
    """Greedy dedup: for two boxes that overlap enough, keep the higher score.

    Two boxes are considered duplicates when their IoU is > `iou_threshold`, or
    when either one has >= `containment_threshold` of its area contained
    within the other (handles a tight inner box nested in a looser outer box,
    which plain IoU can miss). `items` need "bbox" and "score" keys; any other
    keys pass through unchanged on the kept items.
    """
    order = sorted(range(len(items)), key=lambda i: items[i]["score"], reverse=True)
    kept_idx: list[int] = []
    for i in order:
        box_i = items[i]["bbox"]
        suppressed = False
        for j in kept_idx:
            box_j = items[j]["bbox"]
            if iou(box_i, box_j) > iou_threshold:
                suppressed = True
                break
            if (
                contained_ratio(box_i, box_j) >= containment_threshold
                or contained_ratio(box_j, box_i) >= containment_threshold
            ):
                suppressed = True
                break
        if not suppressed:
            kept_idx.append(i)
    return [items[i] for i in kept_idx]


def filter_by_area(
    items: list[dict[str, Any]],
    image_width: int,
    image_height: int,
    min_area_frac: float,
) -> list[dict[str, Any]]:
    image_area = float(image_width * image_height)
    if image_area <= 0:
        return list(items)
    return [it for it in items if box_area(it["bbox"]) / image_area >= min_area_frac]


def cap_largest(items: list[dict[str, Any]], max_items: int) -> list[dict[str, Any]]:
    if max_items <= 0 or len(items) <= max_items:
        return list(items)
    return sorted(items, key=lambda it: box_area(it["bbox"]), reverse=True)[:max_items]


def order_left_to_right(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(items, key=lambda it: it["bbox"][0])


def compute_primary_index(boxes: list[Box], image_width: int, image_height: int) -> int:
    """argmax of area * (1 - 0.5 * dist(center, image centre) / half-diagonal)."""
    if not boxes:
        return 0
    if len(boxes) == 1:
        return 0
    cx0, cy0 = image_width / 2.0, image_height / 2.0
    half_diagonal = math.hypot(image_width / 2.0, image_height / 2.0) or 1.0
    best_idx = 0
    best_score = float("-inf")
    for idx, box in enumerate(boxes):
        x1, y1, x2, y2 = box
        cx, cy = (x1 + x2) / 2.0, (y1 + y2) / 2.0
        dist = math.hypot(cx - cx0, cy - cy0)
        score = box_area(box) * (1.0 - 0.5 * dist / half_diagonal)
        if score > best_score:
            best_score = score
            best_idx = idx
    return best_idx


def full_image_bottle(width: int, height: int) -> dict[str, Any]:
    """Pseudo bottle covering the whole image, used when nothing is detected."""
    return {
        "bbox": [0, 0, width, height],
        "label_bbox": None,
        "center": [round(width / 2), round(height / 2)],
        "score": 0.0,
        "source": "full_image",
    }


def spans_center_line(box: Box, image_width: int) -> bool:
    return box[0] <= image_width / 2.0 <= box[2]


def central_score(box: Box, score: float, image_width: int, image_height: int) -> float:
    """score * sqrt(relative area), x0.6 when the box touches the left/right frame edge (a cut-off neighbour)."""
    x1, y1, x2, y2 = box
    area = box_area(box) / float(image_width * image_height or 1)
    edge = (x1 < 0.01 * image_width) + (x2 > 0.99 * image_width)
    return score * math.sqrt(area) * (0.6 if edge else 1.0)


def pick_central_index(items: list[dict[str, Any]], image_width: int, image_height: int) -> int | None:
    """The bottle the user photographs is the central one: among boxes crossing the vertical centre line the best
    central_score; if none crosses it, the box whose centre is nearest to the line. None for an empty list.
    (real-photo 87: this rule + RF-DETR at 0.25 gives the 0.793 top-1 of wine_seg/PLAN.md)"""
    if not items:
        return None
    spanning = [i for i, it in enumerate(items) if spans_center_line(it["bbox"], image_width)]
    if spanning:
        return max(spanning, key=lambda i: central_score(items[i]["bbox"], items[i]["score"], image_width, image_height))
    return min(range(len(items)), key=lambda i: abs((items[i]["bbox"][0] + items[i]["bbox"][2]) / 2.0 - image_width / 2.0))


def center_crop_bottle(width: int, height: int) -> dict[str, Any]:
    """Pseudo bottle when nothing is detected: the central 60 % x 90 % of the frame (matching on it beats the
    whole frame: real-photo top-1 0.77 vs 0.71). Reported with source "full_image"."""
    bbox = [round(0.2 * width), round(0.05 * height), round(0.8 * width), round(0.95 * height)]
    return {"bbox": bbox, "label_bbox": None, "center": [round(width / 2), round(height / 2)], "score": 0.0, "source": "full_image"}


def find_shoulder_row(mask: Any, bbox: Box, ratio: float = 0.85) -> int | None:
    """First row (from the top, absolute coordinate in `mask`'s space) inside
    `bbox` where the mask's row width reaches `ratio` of the widest row in the
    bbox. `mask` is a 2D boolean array-like (e.g. numpy) sized to match
    `bbox`'s coordinate space. Returns None if it cannot be determined (no
    mask, empty crop, or an all-zero mask).
    """
    if mask is None:
        return None
    x1, y1, x2, y2 = (int(round(v)) for v in bbox)
    mask_h, mask_w = mask.shape[0], mask.shape[1]
    x1 = max(0, x1)
    y1 = max(0, y1)
    x2 = max(x1, min(x2, mask_w))
    y2 = max(y1, min(y2, mask_h))
    if x2 <= x1 or y2 <= y1:
        return None
    sub = mask[y1:y2, x1:x2]
    if sub.size == 0:
        return None
    row_widths = sub.sum(axis=1)
    max_width = row_widths.max()
    if max_width <= 0:
        return None
    threshold = ratio * max_width
    for offset, width in enumerate(row_widths.tolist()):
        if width >= threshold:
            return y1 + offset
    return None


def compute_label_bbox(bbox: Box, mask: Any = None) -> list[int] | None:
    """label_bbox = [x1+0.06w, shoulder+0.04h, x2-0.06w, y2-0.08h], clipped to
    the bbox. Falls back to the 45%..80% heuristic when no shoulder row can be
    found (no mask, or the mask never reaches the width threshold).
    """
    x1, y1, x2, y2 = bbox
    w = x2 - x1
    h = y2 - y1
    if w <= 0 or h <= 0:
        return None

    shoulder = find_shoulder_row(mask, bbox)
    if shoulder is not None:
        ly1 = shoulder + 0.04 * h
        ly2 = y2 - 0.08 * h
    else:
        ly1 = y1 + 0.45 * h
        ly2 = y1 + 0.80 * h

    lx1 = min(max(x1 + 0.06 * w, x1), x2)
    lx2 = min(max(x2 - 0.06 * w, x1), x2)
    ly1 = min(max(ly1, y1), y2)
    ly2 = min(max(ly2, y1), y2)
    if lx2 <= lx1 or ly2 <= ly1:
        return None
    return [round(lx1), round(ly1), round(lx2), round(ly2)]
