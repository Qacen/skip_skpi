"""Mask -> polygon / RLE conversion for the `/recognize` `mask` field.

Only used when a real segmentation mask exists (RF-DETR-Seg; the stub
detector and the `full_image` pseudo-bottle never produce one). Kept
dependency-free at *import* time -- numpy/PIL/supervision are only imported
inside the functions that actually need them -- so this module loads fine
even in a `DETECTOR=stub`-only install that never calls into it.

Coordinate spaces
------------------
RF-DETR runs on the image resized so its long side is <= 1280px (see
`app.detector_rfdetr._resize_long_side`). Resizing the *mask* array itself
back up to the original photo's resolution for every request would be
wasteful, so:

- `RawMask.submask` is the boolean mask cropped to the bottle's bbox *in that
  small, resized image's pixel space* (cheap: a numpy view/slice).
- The outer-contour polygon is traced and simplified in that small space
  (fewer pixels to walk), then its points are scaled back to the original,
  EXIF-transposed input image's pixel space -- a handful of points, so the
  scaling multiply is essentially free.
- `area` is the small-space foreground pixel count scaled by `scale_x *
  scale_y`, which approximates the true original-resolution mask area
  without ever materializing a full-resolution boolean array.
- RLE (`masks=rle`, opt-in and comparatively rare) is the one path that does
  need a full-resolution bitmap: the small-space submask is pasted onto a
  small-resolution canvas, then that canvas (not the whole original photo)
  is nearest-neighbour-resized up to the original image size before COCO-RLE
  encoding.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

MasksMode = Literal["polygon", "rle", "none"]


@dataclass
class RawMask:
    """A real detector's per-bottle mask, still in small/resized-image space."""

    submask: Any  # 2D bool ndarray, cropped to the bottle's small-space bbox
    offset_x: int  # crop origin in small-space pixels, add back before scaling
    offset_y: int
    small_width: int  # full small (resized-for-detection) image size
    small_height: int
    scale_x: float  # small -> original-image pixel scale (orig = small * scale)
    scale_y: float


@dataclass
class MaskField:
    polygon: list[list[int]] | None
    area: int
    rle: dict[str, Any] | None


def build_mask_field(
    raw: RawMask | None,
    mode: MasksMode,
    orig_width: int,
    orig_height: int,
    max_points: int = 96,
    epsilon_ratio: float = 0.004,
) -> MaskField | None:
    """Builds the `mask` response field for one bottle, or `None`.

    `None` when there is no mask to report (stub detector, `full_image`
    pseudo-bottle, or an empty mask) or when `mode == "none"`.
    """
    if raw is None or mode == "none":
        return None

    import numpy as np

    submask = np.asarray(raw.submask, dtype=bool)
    if submask.size == 0 or not submask.any():
        return None

    pixel_count = int(submask.sum())
    area = int(round(pixel_count * raw.scale_x * raw.scale_y))

    polygon: list[list[int]] | None = None
    rle: dict[str, Any] | None = None

    if mode == "polygon":
        polygon = _polygon_from_submask(
            submask, raw, orig_width, orig_height, max_points, epsilon_ratio
        )
        if polygon is None:
            return None
    elif mode == "rle":
        rle = _rle_from_raw_mask(submask, raw, orig_width, orig_height)

    return MaskField(polygon=polygon, area=area, rle=rle)


# --------------------------------------------------------------------------- #
# polygon
# --------------------------------------------------------------------------- #


def _shoelace_area(points: Any) -> float:
    import numpy as np

    x = points[:, 0].astype(float)
    y = points[:, 1].astype(float)
    return abs(float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))) / 2.0


def _perimeter(points: Any) -> float:
    import numpy as np

    shifted = np.roll(points, -1, axis=0)
    diffs = points.astype(float) - shifted.astype(float)
    return float(np.sum(np.hypot(diffs[:, 0], diffs[:, 1])))


def _approx_poly_dp(points: Any, epsilon: float):
    import numpy as np
    from supervision import _cv2 as sv_cv2

    contour = points.reshape(-1, 1, 2).astype(np.int32)
    approx = sv_cv2.approxPolyDP(contour, float(epsilon), closed=True)
    return approx.reshape(-1, 2)


def _polygon_from_submask(
    submask: Any,
    raw: RawMask,
    orig_width: int,
    orig_height: int,
    max_points: int,
    epsilon_ratio: float,
) -> list[list[int]] | None:
    import numpy as np
    import supervision as sv

    contours = sv.mask_to_polygons(submask)
    if not contours:
        return None

    areas = [_shoelace_area(c) for c in contours]
    outer = contours[int(np.argmax(areas))]
    if len(outer) < 3:
        return None

    perimeter = _perimeter(outer)
    epsilon = max(epsilon_ratio * perimeter, 1e-3)
    simplified = _approx_poly_dp(outer, epsilon)

    tries = 0
    while len(simplified) > max_points and tries < 30:
        epsilon *= 1.4
        simplified = _approx_poly_dp(outer, epsilon)
        tries += 1
    if len(simplified) > max_points:
        idx = np.linspace(0, len(simplified) - 1, max_points).round().astype(int)
        simplified = simplified[idx]

    if len(simplified) < 3:
        # Degenerate (near-collinear) mask: fall back to a uniform sample of
        # the un-simplified outer contour rather than dropping the polygon.
        n = max(3, min(max_points, len(outer)))
        idx = np.linspace(0, len(outer) - 1, n).round().astype(int)
        simplified = outer[idx]
    if len(simplified) < 3:
        return None

    pts = simplified.astype(np.float64)
    pts[:, 0] = (pts[:, 0] + raw.offset_x) * raw.scale_x
    pts[:, 1] = (pts[:, 1] + raw.offset_y) * raw.scale_y
    pts[:, 0] = np.clip(np.round(pts[:, 0]), 0, orig_width)
    pts[:, 1] = np.clip(np.round(pts[:, 1]), 0, orig_height)
    pts_int = pts.astype(int)

    # Drop consecutive duplicate points (rounding can coalesce two of them),
    # but never below the 3-point minimum a valid polygon needs.
    deduped: list[list[int]] = []
    for x, y in pts_int.tolist():
        if not deduped or deduped[-1] != [x, y]:
            deduped.append([x, y])
    if len(deduped) >= 2 and deduped[0] == deduped[-1]:
        deduped.pop()
    if len(deduped) < 3:
        return [[int(x), int(y)] for x, y in pts_int.tolist()]
    return deduped


# --------------------------------------------------------------------------- #
# RLE
# --------------------------------------------------------------------------- #


def _place_on_small_canvas(submask: Any, raw: RawMask):
    import numpy as np

    canvas = np.zeros((raw.small_height, raw.small_width), dtype=bool)
    h, w = submask.shape
    y0, x0 = raw.offset_y, raw.offset_x
    canvas[y0 : y0 + h, x0 : x0 + w] = submask
    return canvas


def _rle_from_raw_mask(submask: Any, raw: RawMask, orig_width: int, orig_height: int) -> dict[str, Any]:
    import numpy as np
    from PIL import Image

    small_canvas = _place_on_small_canvas(submask, raw)
    if (raw.small_width, raw.small_height) == (orig_width, orig_height):
        full = small_canvas
    else:
        img = Image.fromarray((small_canvas.astype(np.uint8)) * 255)
        img = img.resize((orig_width, orig_height), Image.NEAREST)
        full = np.asarray(img, dtype=bool)

    try:
        import pycocotools.mask as mask_util  # type: ignore[import-not-found]

        encoded = mask_util.encode(np.asfortranarray(full.astype(np.uint8)))
        counts = encoded["counts"]
        if isinstance(counts, bytes):
            counts = counts.decode("ascii")
        return {"size": [orig_height, orig_width], "counts": counts}
    except ImportError:
        # No pycocotools installed: `supervision.mask_to_rle(..., compressed=True)`
        # implements the same COCO compressed-RLE format (column-major run
        # lengths, base48/LEB128-style varint encoding) and is documented as
        # `pycocotools.mask.decode`-compatible, so we get a real compressed
        # RLE without the extra dependency. See ML_SERVICE.md section 2/8.
        import supervision as sv

        counts = sv.mask_to_rle(full, compressed=True)
        return {"size": [orig_height, orig_width], "counts": counts}
