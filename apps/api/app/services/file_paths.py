"""Strict helpers for root-relative managed paths."""

from pathlib import Path

from app.storage import storage_manager


def resolve_library_path(file_path: str | Path) -> Path:
    """Resolve a canonical ``music/...`` value without allowing traversal."""
    return storage_manager.paths.music_file(file_path)


def library_storage_path(file_path: str | Path) -> str:
    """Return the canonical root-relative database value for a music file."""
    return storage_manager.paths.store_music(file_path)


def download_available(is_downloaded: bool, file_path: str | Path | None) -> bool:
    if not is_downloaded or not file_path:
        return False
    try:
        path = resolve_library_path(file_path)
        return path.is_file() and path.stat().st_size > 0
    except (OSError, ValueError):
        return False
