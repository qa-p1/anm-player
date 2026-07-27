from __future__ import annotations

import os
import threading
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from app.storage.state import StorageStateStore, storage_state_store


class InvalidStoragePath(ValueError):
    pass


def normalize_relative(value: str | Path) -> str:
    raw = str(value).replace("\\", "/")
    path = PurePosixPath(raw)
    if not raw or path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise InvalidStoragePath(f"Storage path must be a normalized root-relative path: {value}")
    if len(path.parts) and path.parts[0].endswith(":"):
        raise InvalidStoragePath(f"Absolute storage paths are not allowed: {value}")
    return path.as_posix()


def _contained(root: Path, candidate: Path) -> bool:
    root_value = os.path.normcase(str(root.resolve()))
    candidate_value = os.path.normcase(str(candidate.resolve(strict=False)))
    try:
        return os.path.commonpath([root_value, candidate_value]) == root_value
    except ValueError:
        return False


@dataclass(frozen=True)
class StoragePaths:
    root: Path

    @property
    def database(self) -> Path:
        return self.root / "aura.db"

    @property
    def music(self) -> Path:
        return self.root / "music"

    @property
    def download_jobs(self) -> Path:
        return self.root / "downloads" / "jobs"

    @property
    def artwork_cache(self) -> Path:
        return self.root / "cache" / "artwork"

    @property
    def lyrics_cache(self) -> Path:
        return self.root / "cache" / "lyrics"

    @property
    def stream_cache(self) -> Path:
        return self.root / "cache" / "streams"

    @property
    def config(self) -> Path:
        return self.root / "config"

    @property
    def download_thumbnails(self) -> Path:
        return self.root / "thumbnails" / "downloads"

    @property
    def logs(self) -> Path:
        return self.root / "logs"

    def ensure(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        for directory in (
            self.music,
            self.download_jobs,
            self.artwork_cache,
            self.lyrics_cache,
            self.stream_cache,
            self.config,
            self.download_thumbnails,
            self.logs,
        ):
            directory.mkdir(parents=True, exist_ok=True)

    def resolve(self, value: str | Path, *, prefix: str | None = None) -> Path:
        normalized = normalize_relative(value)
        if prefix and not (normalized == prefix or normalized.startswith(f"{prefix}/")):
            raise InvalidStoragePath(f"Expected a path below {prefix}/: {value}")
        candidate = self.root.joinpath(*PurePosixPath(normalized).parts)
        if not _contained(self.root, candidate):
            raise InvalidStoragePath(f"Storage path escapes data root: {value}")
        return candidate

    def music_file(self, value: str | Path) -> Path:
        normalized = normalize_relative(value)
        if not normalized.startswith("music/"):
            normalized = f"music/{normalized}"  # read compatibility for pre-normalization rows
        return self.resolve(normalized, prefix="music")

    def stream_file(self, value: str | Path) -> Path:
        return self._cache_file(value, "streams")

    def lyrics_file(self, value: str | Path) -> Path:
        return self._cache_file(value, "lyrics")

    def store(self, path: str | Path, *, prefix: str) -> str:
        absolute = Path(path).expanduser().resolve(strict=False)
        if not _contained(self.root, absolute):
            raise InvalidStoragePath(f"Path is outside data root: {path}")
        relative = absolute.relative_to(self.root.resolve()).as_posix()
        normalized = normalize_relative(relative)
        if not (normalized == prefix or normalized.startswith(f"{prefix}/")):
            raise InvalidStoragePath(f"Expected a path below {prefix}/: {path}")
        return normalized

    def store_music(self, path: str | Path) -> str:
        return self.store(path, prefix="music")

    def store_stream(self, path: str | Path) -> str:
        return self.store(path, prefix="cache/streams")

    def store_lyrics(self, path: str | Path) -> str:
        return self.store(path, prefix="cache/lyrics")

    def _cache_file(self, value: str | Path, category: str) -> Path:
        normalized = normalize_relative(value)
        prefix = f"cache/{category}"
        if normalized.startswith("data/"):
            normalized = normalized.removeprefix("data/")
        if not normalized.startswith(f"{prefix}/"):
            normalized = f"{prefix}/{PurePosixPath(normalized).name}"
        return self.resolve(normalized, prefix=prefix)


class StorageManager:
    def __init__(self, state_store: StorageStateStore | None = None) -> None:
        self.state_store = state_store or storage_state_store
        self._lock = threading.RLock()
        self._paths: StoragePaths | None = None

    @property
    def paths(self) -> StoragePaths:
        with self._lock:
            root = Path(self.state_store.read()["data_root"]).resolve()
            if self._paths is None or self._paths.root != root:
                self._paths = StoragePaths(root)
            return self._paths

    def initialize(self) -> StoragePaths:
        paths = self.paths
        paths.ensure()
        return paths

    def refresh(self) -> StoragePaths:
        with self._lock:
            self._paths = None
            return self.paths


storage_manager = StorageManager()
