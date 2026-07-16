from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.music import Song


class Playlist(TimestampMixin, Base):
    __tablename__ = "playlists"
    __table_args__ = (
        UniqueConstraint("name", name="uq_playlists_name"),
        Index("ix_playlists_name", "name"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    artwork_path: Mapped[str | None] = mapped_column(String(1024))

    songs: Mapped[list[PlaylistSong]] = relationship(
        back_populates="playlist",
        cascade="all, delete-orphan",
        order_by="PlaylistSong.position",
    )


class PlaylistSong(TimestampMixin, Base):
    __tablename__ = "playlist_songs"
    __table_args__ = (
        UniqueConstraint("playlist_id", "song_id", name="uq_playlist_songs_playlist_id_song_id"),
        UniqueConstraint("playlist_id", "position", name="uq_playlist_songs_playlist_id_position"),
        Index("ix_playlist_songs_playlist_id", "playlist_id"),
        Index("ix_playlist_songs_song_id", "song_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    playlist_id: Mapped[int] = mapped_column(ForeignKey("playlists.id", ondelete="CASCADE"), nullable=False)
    song_id: Mapped[int] = mapped_column(ForeignKey("songs.id", ondelete="CASCADE"), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)

    playlist: Mapped[Playlist] = relationship(back_populates="songs")
    song: Mapped[Song] = relationship(back_populates="playlist_links")
