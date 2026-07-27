from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship, synonym

from app.database.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.download import DownloadJob
    from app.models.music import Song


class LibraryAlbum(TimestampMixin, Base):
    __tablename__ = "library_albums"
    __table_args__ = (
        UniqueConstraint("source", "external_id", name="uq_library_albums_source_external_id"),
        UniqueConstraint("public_id", name="uq_library_albums_public_id"),
        UniqueConstraint("local_album_id", name="uq_library_albums_local_album_id"),
        Index("ix_library_albums_public_id", "public_id"),
        Index("ix_library_albums_local_album_id", "local_album_id"),
        Index("ix_library_albums_title", "title"),
        Index("ix_library_albums_artist_name", "artist_name"),
        Index("ix_library_albums_added_at", "added_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    public_id: Mapped[str] = mapped_column(String(255), nullable=False)
    local_album_id: Mapped[int | None] = mapped_column(ForeignKey("albums.id", ondelete="SET NULL"))
    source: Mapped[str] = mapped_column(String(40), default="youtube", nullable=False)
    external_id: Mapped[str] = mapped_column(String(255), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    artist_name: Mapped[str | None] = mapped_column(String(255))
    artist_external_id: Mapped[str | None] = mapped_column(String(255))
    year: Mapped[int | None] = mapped_column(Integer)
    artwork_url: Mapped[str | None] = mapped_column(String(2048))
    artwork_path: Mapped[str | None] = mapped_column(String(1024))
    description: Mapped[str | None] = mapped_column(Text)
    added_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC), nullable=False)
    is_in_library: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    removed_at: Mapped[datetime | None] = mapped_column(DateTime)

    tracks: Mapped[list[LibraryTrack]] = relationship(
        back_populates="album",
        cascade="all, delete-orphan",
        order_by="LibraryTrack.position",
    )


class LibraryArtist(TimestampMixin, Base):
    __tablename__ = "library_artists"
    __table_args__ = (
        UniqueConstraint("source", "external_id", name="uq_library_artists_source_external_id"),
        Index("ix_library_artists_name", "name"),
        Index("ix_library_artists_added_at", "added_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    source: Mapped[str] = mapped_column(String(40), default="youtube", nullable=False)
    external_id: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    thumbnail_url: Mapped[str | None] = mapped_column(String(2048))
    added_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC), nullable=False)


class LibraryTrack(TimestampMixin, Base):
    __tablename__ = "library_tracks"
    __table_args__ = (
        UniqueConstraint("album_id", "position", name="uq_library_tracks_album_id_position"),
        Index("ix_library_tracks_album_id", "album_id"),
        Index("ix_library_tracks_source_external_id", "source", "external_id"),
        Index("ix_library_tracks_title", "title"),
        Index("ix_library_tracks_artist_name", "artist_name"),
        Index("ix_library_tracks_is_downloaded", "is_downloaded"),
        Index("ix_library_tracks_song_id", "song_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    album_id: Mapped[int | None] = mapped_column(ForeignKey("library_albums.id", ondelete="SET NULL"))
    song_id: Mapped[int | None] = mapped_column(ForeignKey("songs.id", ondelete="SET NULL"))
    source: Mapped[str] = mapped_column(String(40), default="youtube", nullable=False)
    external_id: Mapped[str] = mapped_column(String(255), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    artist_name: Mapped[str | None] = mapped_column(String(255))
    artist_external_id: Mapped[str | None] = mapped_column(String(255))
    album_title: Mapped[str | None] = mapped_column(String(255))
    duration_seconds: Mapped[int | None] = mapped_column(Integer)
    track_number: Mapped[int | None] = mapped_column(Integer)
    disc_number: Mapped[int | None] = mapped_column(Integer)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    source_url: Mapped[str | None] = mapped_column(String(2048))
    artwork_url: Mapped[str | None] = mapped_column(String(2048))
    artwork_path: Mapped[str | None] = mapped_column(String(1024))
    explicit: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_downloaded: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    relative_path: Mapped[str | None] = mapped_column(String(2048))
    file_path = synonym("relative_path")
    lyrics: Mapped[str | None] = mapped_column(Text)
    is_in_library: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    removed_at: Mapped[datetime | None] = mapped_column(DateTime)

    album: Mapped[LibraryAlbum | None] = relationship(back_populates="tracks")
    song: Mapped[Song | None] = relationship()


class StreamCacheEntry(TimestampMixin, Base):
    __tablename__ = "stream_cache_entries"
    __table_args__ = (
        UniqueConstraint("source", "external_id", "quality", name="uq_stream_cache_entries_source_external_id_quality"),
        Index("ix_stream_cache_entries_expires_at", "expires_at"),
        Index("ix_stream_cache_entries_last_accessed_at", "last_accessed_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    source: Mapped[str] = mapped_column(String(40), default="youtube", nullable=False)
    external_id: Mapped[str] = mapped_column(String(255), nullable=False)
    relative_path: Mapped[str] = mapped_column(String(2048), nullable=False)
    cache_path = synonym("relative_path")
    quality: Mapped[str] = mapped_column(String(20), default="high", nullable=False)
    content_type: Mapped[str] = mapped_column(String(120), default="audio/webm", nullable=False)
    size_bytes: Mapped[int | None] = mapped_column(Integer)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    last_accessed_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC), nullable=False)


class LyricsCacheEntry(TimestampMixin, Base):
    __tablename__ = "lyrics_cache_entries"
    __table_args__ = (
        UniqueConstraint("source", "external_id", name="uq_lyrics_cache_entries_source_external_id"),
        Index("ix_lyrics_cache_entries_song_id", "song_id"),
        Index("ix_lyrics_cache_entries_last_accessed_at", "last_accessed_at"),
        Index("ix_lyrics_cache_entries_status", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    source: Mapped[str] = mapped_column(String(40), nullable=False)
    external_id: Mapped[str] = mapped_column(String(255), nullable=False)
    song_id: Mapped[int | None] = mapped_column(ForeignKey("songs.id", ondelete="CASCADE"))
    relative_path: Mapped[str | None] = mapped_column(String(2048))
    cache_path = synonym("relative_path")
    format: Mapped[str | None] = mapped_column(String(20))
    provider: Mapped[str | None] = mapped_column(String(80))
    status: Mapped[str] = mapped_column(String(40), default="cached", nullable=False)
    error_code: Mapped[str | None] = mapped_column(String(80))
    last_fetched_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_accessed_at: Mapped[datetime | None] = mapped_column(DateTime)


class AlbumDownloadJob(TimestampMixin, Base):
    __tablename__ = "album_download_jobs"
    __table_args__ = (
        Index("ix_album_download_jobs_album_id", "album_id"),
        Index("ix_album_download_jobs_status", "status"),
        Index("ix_album_download_jobs_created_at", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    album_id: Mapped[int] = mapped_column(ForeignKey("library_albums.id", ondelete="CASCADE"), nullable=False)
    status: Mapped[str] = mapped_column(String(40), default="queued", nullable=False)
    progress: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_tracks: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    completed_tracks: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    failed_tracks: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    max_parallel: Mapped[int] = mapped_column(Integer, default=5, nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)

    album: Mapped[LibraryAlbum] = relationship()
    items: Mapped[list[AlbumDownloadItem]] = relationship(back_populates="album_job", cascade="all, delete-orphan")


class AlbumDownloadItem(TimestampMixin, Base):
    __tablename__ = "album_download_items"
    __table_args__ = (
        UniqueConstraint("album_job_id", "track_id", name="uq_album_download_items_album_job_id_track_id"),
        Index("ix_album_download_items_album_job_id", "album_job_id"),
        Index("ix_album_download_items_track_id", "track_id"),
        Index("ix_album_download_items_status", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    album_job_id: Mapped[int] = mapped_column(ForeignKey("album_download_jobs.id", ondelete="CASCADE"), nullable=False)
    track_id: Mapped[int] = mapped_column(ForeignKey("library_tracks.id", ondelete="CASCADE"), nullable=False)
    download_job_id: Mapped[int | None] = mapped_column(ForeignKey("download_jobs.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(String(40), default="queued", nullable=False)
    progress: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text)

    album_job: Mapped[AlbumDownloadJob] = relationship(back_populates="items")
    track: Mapped[LibraryTrack] = relationship()
    download_job: Mapped[DownloadJob | None] = relationship()


class PlaylistLibraryTrack(TimestampMixin, Base):
    __tablename__ = "playlist_library_tracks"
    __table_args__ = (
        UniqueConstraint("playlist_id", "track_id", name="uq_playlist_library_tracks_playlist_id_track_id"),
        UniqueConstraint("playlist_id", "position", name="uq_playlist_library_tracks_playlist_id_position"),
        Index("ix_playlist_library_tracks_playlist_id", "playlist_id"),
        Index("ix_playlist_library_tracks_track_id", "track_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    playlist_id: Mapped[int] = mapped_column(ForeignKey("playlists.id", ondelete="CASCADE"), nullable=False)
    track_id: Mapped[int] = mapped_column(ForeignKey("library_tracks.id", ondelete="CASCADE"), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)

    track: Mapped[LibraryTrack] = relationship()
