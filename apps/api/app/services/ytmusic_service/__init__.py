"""Provider exports, loaded on demand so pure parsing does not start clients."""

from importlib import import_module

__all__ = [
    "SEARCH_FILTERS",
    "PlaybackData",
    "YouTubeMusicClient",
    "YouTubeMusicService",
    "ytmusic_service",
]

_EXPORT_MODULES = {
    "SEARCH_FILTERS": "transport",
    "PlaybackData": "models",
    "YouTubeMusicClient": "client",
    "YouTubeMusicService": "service",
    "ytmusic_service": "service",
}


def __getattr__(name: str):
    module = _EXPORT_MODULES.get(name)
    if module is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    value = getattr(import_module(f"{__name__}.{module}"), name)
    globals()[name] = value
    return value
