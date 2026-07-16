"""SQLAlchemy model exports.

Importing this module registers all models on Base.metadata for Alembic.
"""

from app.database.base import Base
from app.models.download import DownloadJob, QueueItem
from app.models.history import Favorite, History
from app.models.library import (
    AlbumDownloadItem,
    AlbumDownloadJob,
    LibraryAlbum,
    LibraryArtist,
    LibraryTrack,
    LyricsCacheEntry,
    PlaylistLibraryTrack,
    StreamCacheEntry,
)
from app.models.music import Album, Artist, Song
from app.models.playlist import Playlist, PlaylistSong
from app.models.settings import UserSettings

__all__ = [
    "Album",
    "AlbumDownloadItem",
    "AlbumDownloadJob",
    "Artist",
    "Base",
    "DownloadJob",
    "Favorite",
    "History",
    "LibraryAlbum",
    "LibraryArtist",
    "LibraryTrack",
    "LyricsCacheEntry",
    "Playlist",
    "PlaylistLibraryTrack",
    "PlaylistSong",
    "QueueItem",
    "Song",
    "StreamCacheEntry",
    "UserSettings",
]
