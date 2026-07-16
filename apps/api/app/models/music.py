from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship, synonym

from app.database.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.history import History
    from app.models.playlist import PlaylistSong


class Artist(TimestampMixin, Base):
    __tablename__ = "artists"
    __table_args__ = (
        UniqueConstraint("name", name="uq_artists_name"),
        Index("ix_artists_name", "name"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    sort_name: Mapped[str | None] = mapped_column(String(255))
    artwork_path: Mapped[str | None] = mapped_column(String(1024))
    artwork_url: Mapped[str | None] = mapped_column(String(2048))

    albums: Mapped[list[Album]] = relationship(back_populates="artist", cascade="all, delete-orphan")
    songs: Mapped[list[Song]] = relationship(back_populates="artist")


class Album(TimestampMixin, Base):
    __tablename__ = "albums"
    __table_args__ = (
        UniqueConstraint("title", "artist_id", name="uq_albums_title_artist_id"),
        Index("ix_albums_title", "title"),
        Index("ix_albums_artist_id", "artist_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    artist_id: Mapped[int | None] = mapped_column(ForeignKey("artists.id", ondelete="SET NULL"))
    year: Mapped[int | None] = mapped_column(Integer)
    artwork_path: Mapped[str | None] = mapped_column(String(1024))
    artwork_url: Mapped[str | None] = mapped_column(String(2048))

    artist: Mapped[Artist | None] = relationship(back_populates="albums")
    songs: Mapped[list[Song]] = relationship(back_populates="album")


class Song(TimestampMixin, Base):
    __tablename__ = "songs"
    __table_args__ = (
        UniqueConstraint("relative_path", name="uq_songs_relative_path"),
        Index("ix_songs_title", "title"),
        Index("ix_songs_artist_id", "artist_id"),
        Index("ix_songs_album_id", "album_id"),
        Index("ix_songs_is_downloaded", "is_downloaded"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    artist_id: Mapped[int | None] = mapped_column(ForeignKey("artists.id", ondelete="SET NULL"))
    album_id: Mapped[int | None] = mapped_column(ForeignKey("albums.id", ondelete="SET NULL"))
    duration_seconds: Mapped[int | None] = mapped_column(Integer)
    track_number: Mapped[int | None] = mapped_column(Integer)
    disc_number: Mapped[int | None] = mapped_column(Integer)
    source_url: Mapped[str | None] = mapped_column(String(2048))
    relative_path: Mapped[str | None] = mapped_column(String(2048))
    file_path = synonym("relative_path")
    artwork_path: Mapped[str | None] = mapped_column(String(1024))
    artwork_url: Mapped[str | None] = mapped_column(String(2048))
    lyrics: Mapped[str | None] = mapped_column(Text)
    is_downloaded: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    artist: Mapped[Artist | None] = relationship(back_populates="songs")
    album: Mapped[Album | None] = relationship(back_populates="songs")
    playlist_links: Mapped[list[PlaylistSong]] = relationship(back_populates="song")
    history_entries: Mapped[list[History]] = relationship(back_populates="song")
