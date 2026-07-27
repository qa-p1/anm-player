"""Strict helpers for root-relative managed paths."""

from pathlib import Path

from app.storage import storage_manager


def resolve_library_path(file_path: str | Path) -> Path:
    """Resolve a canonical ``music/...`` value without allowing traversal."""
    return storage_manager.paths.music_file(file_path)


def library_storage_path(file_path: str | Path) -> str:
    """Return the canonical root-relative database value for a music file."""
    return storage_manager.paths.store_music(file_path)
