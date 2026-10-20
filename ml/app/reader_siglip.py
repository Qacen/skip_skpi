"""Label reader on SigLIP2 zero-shot with precomputed text embeddings (no text tower at serving time).

- vintage: label zone (rows 25-95 % of the bottle crop +10 %) vs "a wine label with the vintage year {y}", 1995-2026.
  real-photo 87: 0.89 accuracy where the year is printed; with P(max) >= 0.5 it answers 30/47 (28 correct)
  and gives a year on 1/40 photos without a readable year -> otherwise `vintage = None`.
- color: bottle crop vs Russian prompts ("вино красное", "красное вино", "этикетка: вино красное"): 0.84 on real-photo.
- sweetness: SigLIP does not read it (accuracy below the majority class) -> None; needs OCR / VLM.
- text: None (no OCR yet).

Text embeddings come from `READER_TEXT_PATH` (npz, built by wine_seg/kernels/ml_export).
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from app.matcher_siglip import EmbeddingCache, SiglipEmbedder, crop_box, label_zone


def _softmax(x: np.ndarray) -> np.ndarray:
    x = x - x.max()
    e = np.exp(x)
    return e / e.sum()


class SiglipLabelReader:
    """`LabelReader` implementation; reuses the crop / label-zone embeddings the matcher computed for the request."""

    def __init__(
        self,
        embedder: SiglipEmbedder,
        text_path: Path,
        read_cls: Any,
        cache: EmbeddingCache,
        crop_pad: float = 0.10,
        vintage_min_p: float = 0.5,
        color_min_p: float = 0.4,
        own_embedder: bool = False,
        read_bottles: str = "primary",
        crop_max_side: int = 0,
        kind_text_path: Path | None = None,
    ) -> None:
        z = np.load(text_path, allow_pickle=False)
        self.scale = float(z["logit_scale"])
        norm = lambda v: v / (np.linalg.norm(v, axis=-1, keepdims=True) + 1e-9)
        years = [str(y) for y in z["years"]]
        tpl = [str(t) for t in z["year_templates"]]
        self.years = years
        self.t_year = norm(z["year"][:, tpl.index("a wine label with the vintage year {y}")].astype(np.float32))
        ctpl = [str(t) for t in z["color_templates"]]
        ru = [i for i, t in enumerate(ctpl) if "{r}" in t]
        self.colors = [str(c) for c in z["colors"]]
        self.t_color = norm(norm(z["color"][:, ru].astype(np.float32)).mean(1))
        self.embedder, self.read_cls, self.cache = embedder, read_cls, cache
        self.crop_pad, self.vintage_min_p, self.color_min_p = crop_pad, vintage_min_p, color_min_p
        # own_embedder: the matcher runs a fine-tuned tower, so its vectors are not aligned with the text embeddings;
        # the reader then embeds crop + label zone with its own (base) tower, for the primary bottle only by default.
        self.own_embedder, self.read_bottles, self.crop_max_side = own_embedder, read_bottles, crop_max_side
        self.own_cache = EmbeddingCache()
        self.kind_names: list[str] = []
        if kind_text_path is not None and Path(kind_text_path).exists():
            kz = np.load(kind_text_path, allow_pickle=False)
            self.kind_names = [str(k) for k in kz["kinds"]]
            self.t_kind = norm(kz["text"].astype(np.float32))
            self.kind_scale = float(kz["logit_scale"])

    def _vec(self, image: Image.Image, bbox: list[int], kind: str, compute: bool = True) -> np.ndarray | None:
        v = self.cache.get(image, (kind, tuple(bbox)))
        if v is None and compute:
            crop = crop_box(image, bbox, self.crop_pad)
            v = self.embedder.embed([label_zone(crop) if kind == "label" else crop])[0]
            self.cache.put(image, (kind, tuple(bbox)), v)
        return v

    def read_vintage(self, label_vec: np.ndarray) -> tuple[str | None, float]:
        p = _softmax(self.t_year @ label_vec * self.scale)
        j = int(p.argmax())
        return (self.years[j] if p[j] >= self.vintage_min_p else None), float(p[j])

    def read_color(self, crop_vec: np.ndarray) -> tuple[str | None, float]:
        p = _softmax(self.t_color @ crop_vec * self.scale)
        j = int(p.argmax())
        return (self.colors[j] if p[j] >= self.color_min_p else None), float(p[j])

    def _read_own(self, image: Image.Image, bottle: Any) -> Any:
        primary = self.cache.get(image, ("primary",))
        is_primary = primary is None or tuple(int(v) for v in primary) == tuple(bottle.bbox)
        if self.read_bottles != "all" and not is_primary:
            return self.read_cls(color=None, sweetness=None, vintage=None, text=None)
        key = tuple(bottle.bbox)
        crop_v, lab_v = self.own_cache.get(image, ("crop", key)), self.own_cache.get(image, ("label", key))
        if crop_v is None or lab_v is None:
            crop = crop_box(image, bottle.bbox, self.crop_pad, self.crop_max_side)
            crop_v, lab_v = self.embedder.embed([crop, label_zone(crop)])
            self.own_cache.put(image, ("crop", key), crop_v)
            self.own_cache.put(image, ("label", key), lab_v)
        return self.read_cls(color=self.read_color(crop_v)[0], sweetness=None, vintage=self.read_vintage(lab_v)[0], text=None)

    def read(self, image: Image.Image, bottle: Any, match: Any = None, catalog: Any = None) -> Any:
        if self.own_embedder:
            return self._read_own(image, bottle)
        # The label zone is embedded by the matcher only for the bottles it was asked to (READ_BOTTLES=primary|all);
        # for the others vintage stays None instead of paying for another model pass here.
        lab = self._vec(image, bottle.bbox, "label", compute=False)
        vintage = self.read_vintage(lab)[0] if lab is not None else None
        color, _ = self.read_color(self._vec(image, bottle.bbox, "crop"))
        return self.read_cls(color=color, sweetness=None, vintage=vintage, text=None)

    def kinds(self, image: Image.Image, bboxes: list[list[int]], patches: int = 256) -> list[tuple[str | None, float | None]]:
        """Drink kind of each bottle crop (zero-shot vs the kind prompts, BASE tower; 256 patches are enough for
        «glass wine bottle vs plastic water bottle»). Empty list of kinds (no kind_text.npz) -> (None, None)."""
        if not self.kind_names or not bboxes:
            return [(None, None)] * len(bboxes)
        crops = [crop_box(image, b, self.crop_pad, self.crop_max_side) for b in bboxes]
        vec = self.embedder.embed(crops, patches)
        out = []
        for v in vec:
            p = _softmax(self.t_kind @ v * self.kind_scale)
            j = int(p.argmax())
            out.append((self.kind_names[j], round(float(p[j]), 3)))
        return out
