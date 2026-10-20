"""Runtime settings, sourced from environment variables."""
from __future__ import annotations

import os
from pathlib import Path

# Default catalog path: <repo>/web/data/catalog.json, resolved relative to this file
# (this file lives at <repo>/ml/app/config.py, so parents[2] is <repo>).
_DEFAULT_CATALOG_PATH = Path(__file__).resolve().parents[2] / "web" / "data" / "catalog.json"


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    return int(raw)


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    return float(raw)


class Settings:
    """Process-wide configuration, read once at import time."""

    def __init__(self) -> None:
        self.catalog_path: Path = Path(os.environ.get("CATALOG_PATH", str(_DEFAULT_CATALOG_PATH)))
        # 0 disables the not_found branch entirely (every request is "found").
        self.stub_not_found_every: int = _env_int("STUB_NOT_FOUND_EVERY", 6)
        self.max_upload_mb: int = _env_int("MAX_UPLOAD_MB", 15)
        # When true, ?force=found|not_found on /recognize overrides the stub result (UI testing). Off by default (secure).
        self.allow_force: bool = _env_bool("ALLOW_FORCE", False)
        origins = os.environ.get("CORS_ORIGINS", "")
        self.cors_origins: list[str] = [o.strip() for o in origins.split(",") if o.strip()]

        # --- Real detector (RF-DETR-Seg Small) ---------------------------- #
        # "auto": use RF-DETR if it is importable and loads, else fall back to
        # the stub (with a warning log). "rfdetr": require it (raise if it
        # fails to load). "stub": always use the stub detector (tests).
        detector_mode = os.environ.get("DETECTOR", "auto").strip().lower() or "auto"
        self.detector_mode: str = detector_mode if detector_mode in ("auto", "rfdetr", "stub") else "auto"

        # Minimum detection score to keep a box (before dedup/area filtering).
        self.detect_threshold: float = _env_float("DETECT_THRESHOLD", 0.45)
        # Lower threshold used only to rescue the CENTRAL bottle when no box above DETECT_THRESHOLD crosses the
        # vertical centre line (JPEG re-compression easily moves a 0.50 box below 0.45).
        self.rescue_threshold: float = _env_float("RESCUE_THRESHOLD", 0.25)
        # A box counts as "the central bottle" only if it crosses the centre line AND is at least this tall
        # (fraction of the frame height); otherwise a neck / price tag would be rescued.
        self.central_min_height: float = _env_float("CENTRAL_MIN_HEIGHT", 0.35)
        # Primary bottle: "center_line" (box crossing the vertical centre line, best score*sqrt(area)) or
        # "area_center" (argmax area * (1 - 0.5 * dist / half-diagonal), ML_SERVICE.md §3).
        primary_rule = os.environ.get("PRIMARY_RULE", "center_line").strip().lower() or "center_line"
        self.primary_rule: str = primary_rule if primary_rule in ("center_line", "area_center") else "center_line"
        # Drop boxes smaller than this fraction of the image area.
        self.min_bottle_area: float = _env_float("MIN_BOTTLE_AREA", 0.012)
        # Keep at most this many bottles (the largest ones) per image (a shelf photo holds 20+).
        self.max_bottles: int = _env_int("MAX_BOTTLES", 32)
        # Shelf photo: at least this many confident bottles -> no central-bottle rescue / centre-crop pseudo bottle,
        # the primary is simply the most central detected bottle, and the crops are embedded at SHELF_EMBED_PATCHES.
        self.shelf_min_bottles: int = _env_int("SHELF_MIN_BOTTLES", 4)
        # Query patches for shelf crops: on 648 held-out photos a 576-patch query against the 1024-patch index is within
        # -0.2 pp top-1 of 1024/1024 (wine_seg/runs/patch_eval) and ~1.7x faster -> 20 bottles fit the SLA.
        self.shelf_embed_patches: int = _env_int("SHELF_EMBED_PATCHES", 576)
        # Shelf photos: lower "found" threshold (cosine of the top-1 catalog card) — on a shelf every wine is a deliberate
        # catalog-style product and the user wants as many identified as possible; single photos keep FOUND_MIN_COS.
        self.shelf_found_min_cos: float = _env_float("SHELF_FOUND_MIN_COS", 0.55)
        # Shelf photos: lower detector threshold -> more (smaller / partly hidden) bottles.
        self.shelf_detect_threshold: float = _env_float("SHELF_DETECT_THRESHOLD", 0.30)

        # Default length of match.neighbors (top-K catalog matches) when the
        # request omits ?k=. The request value (and this default) are always
        # clamped to [1, 50] -- see `app.main._clamp_k`.
        self.neighbors_k: int = _env_int("NEIGHBORS_K", 10)

        # Where the RF-DETR checkpoint is downloaded to / loaded from.
        _default_weights_dir = Path(__file__).resolve().parents[1] / "weights"
        self.weights_dir: Path = Path(os.environ.get("WEIGHTS_DIR", str(_default_weights_dir)))

        # "cpu", "mps" or "cuda"; falls back to "cpu" if the requested device is unavailable.
        device = os.environ.get("DEVICE", "cpu").strip().lower() or "cpu"
        self.device: str = device if device in ("cpu", "mps", "cuda") else "cpu"

        # --- Real matcher / label reader (SigLIP2 so400m naflex) ----------- #
        # "stub" (default, tests) or "siglip" (app/matcher_siglip.py, app/reader_siglip.py).
        matcher_mode = os.environ.get("MATCHER", "stub").strip().lower() or "stub"
        self.matcher_mode: str = matcher_mode if matcher_mode in ("stub", "siglip") else "stub"
        reader_mode = os.environ.get("READER", "stub").strip().lower() or "stub"
        self.reader_mode: str = reader_mode if reader_mode in ("stub", "siglip") else "stub"
        _ml = Path(__file__).resolve().parents[1]
        # HF id or a local folder with the vision tower weights (shared by the matcher and the reader).
        self.embedder_path: str = os.environ.get("EMBEDDER_PATH", "google/siglip2-so400m-patch16-naflex")
        self.index_path: Path = Path(os.environ.get("INDEX_PATH", str(_ml / "index" / "index_naflex1024.npz")))
        self.reader_text_path: Path = Path(os.environ.get("READER_TEXT_PATH", str(_ml / "index" / "reader_text.npz")))
        # drink-kind prompts (wine / water / soda / beer / ...), text embeddings of the BASE tower; missing file = no kind
        self.kind_text_path: Path = Path(os.environ.get("KIND_TEXT_PATH", str(_ml / "index" / "kind_text.npz")))
        # top-1 cosine >= this -> "found" (calibrated on real-photo, ML_SERVICE.md §7)
        self.found_min_cos: float = _env_float("FOUND_MIN_COS", 0.76)
        self.crop_pad: float = _env_float("CROP_PAD", 0.10)       # bbox padding on every side before embedding
        self.embed_patches: int = _env_int("EMBED_PATCHES", 1024)  # naflex max_num_patches
        # Vision tower for the label READER (zero-shot year/colour against precomputed text embeddings). It must stay
        # aligned with the text tower, so with a fine-tuned matcher point it at the BASE vision tower; then the reader
        # embeds the primary bottle's crop + label zone itself (+1 model pass). Default: same tower as the matcher.
        self.reader_embedder_path: str = os.environ.get("READER_EMBEDDER_PATH", "") or self.embedder_path
        # Downscale the padded bottle crop to this long side before the processor (the fine-tuned model was trained with
        # thumbnail 1152). 0 = off (base model numbers in ML_SERVICE.md were measured without it).
        self.crop_max_side: int = _env_int("CROP_MAX_SIDE", 0)
        # Extended gallery (international + other Russian wines). Absent file -> scope=all behaves like catalog.
        self.ext_index_path: Path = Path(os.environ.get("EXT_INDEX_PATH", str(_ml / "index" / "index_ext_tuned.npz")))
        self.ext_meta_path: Path = Path(os.environ.get("EXT_META_PATH", str(_ml / "index" / "ext_meta.json")))
        ds = os.environ.get("DEFAULT_SCOPE", "catalog").strip().lower()
        self.default_scope: str = ds if ds in ("catalog", "all") else "catalog"
        # Which bottles get the label-zone embedding (vintage reading): "primary" (1 extra image per photo) or "all".
        read_bottles = os.environ.get("READ_BOTTLES", "primary").strip().lower() or "primary"
        self.read_bottles: str = read_bottles if read_bottles in ("primary", "all") else "primary"

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024


settings = Settings()
