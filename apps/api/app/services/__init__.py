"""Service compatibility exports without eagerly initializing other domains."""

from importlib import import_module

__all__ = [
    "CatalogService",
    "DownloadService",
    "HealthService",
    "LibraryAlbumService",
    "SettingsService",
]

_EXPORT_MODULES = {
    "CatalogService": "catalog",
    "DownloadService": "downloads",
    "HealthService": "health",
    "LibraryAlbumService": "library_albums",
    "SettingsService": "settings",
}


def __getattr__(name: str):
    module = _EXPORT_MODULES.get(name)
    if module is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    value = getattr(import_module(f"{__name__}.{module}"), name)
    globals()[name] = value
    return value
