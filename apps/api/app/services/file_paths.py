"""Strict helpers for root-relative managed paths."""

from pathlib import Path

from app.core.config import settings
from app.storage import storage_manager


def resolve_library_path(file_path: str | Path) -> Path:
    """Resolve a canonical ``music/...`` value without allowing traversal."""
    if settings.music_directory is not None:  # in-process backwards-compatibility hook
        value = str(file_path).replace("\\", "/").removeprefix("music/")
        return Path(settings.music_directory).resolve() / value
    return storage_manager.paths.music_file(file_path)


def library_storage_path(file_path: str | Path) -> str:
    """Return the canonical root-relative database value for a music file."""
    if settings.music_directory is not None:
        relative = Path(file_path).resolve().relative_to(Path(settings.music_directory).resolve())
        return f"music/{relative.as_posix()}"
    return storage_manager.paths.store_music(file_path)
