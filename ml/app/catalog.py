"""Loads catalog.json once and exposes lookup helpers."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any


class Catalog:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.items: list[dict[str, Any]] = self._load(path)
        self.slugs: list[str] = [item["slug"] for item in self.items]
        self._by_slug: dict[str, dict[str, Any]] = {item["slug"]: item for item in self.items}

    @staticmethod
    def _load(path: Path) -> list[dict[str, Any]]:
        if not path.exists():
            # Empty catalog keeps the service alive (health check, docs) even if the
            # data file was not mounted; /recognize will simply always report not_found.
            return []
        with path.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
        if not isinstance(data, list):
            raise ValueError(f"catalog.json must contain a list, got {type(data)}")
        return data

    def __len__(self) -> int:
        return len(self.items)

    def by_index(self, index: int) -> dict[str, Any]:
        return self.items[index % len(self.items)]

    def by_slug(self, slug: str) -> dict[str, Any] | None:
        return self._by_slug.get(slug)


@lru_cache(maxsize=1)
def get_catalog() -> Catalog:
    from app.config import settings

    return Catalog(settings.catalog_path)
