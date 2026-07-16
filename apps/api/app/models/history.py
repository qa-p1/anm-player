from datetime import UTC, datetime

from sqlalchemy import ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base, TimestampMixin


class History(TimestampMixin, Base):
    __tablename__ = "history"
    __table_args__ = (
        Index("ix_history_song_id", "song_id"),
        Index("ix_history_source_external_id", "source", "external_id"),
        Index("ix_history_played_at", "played_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    song_id: Mapped[int | None] = mapped_column(ForeignKey("songs.id", ondelete="SET NULL"))
    source: Mapped[str] = mapped_column(String(40), default="local", nullable=False)
    external_id: Mapped[str | None] = mapped_column(String(255))
    title: Mapped[str | None] = mapped_column(String(255))
    artist_name: Mapped[str | None] = mapped_column(String(255))
    album_title: Mapped[str | None] = mapped_column(String(255))
    artwork_url: Mapped[str | None] = mapped_column(String(2048))
    duration_seconds: Mapped[int | None] = mapped_column(Integer)
    source_url: Mapped[str | None] = mapped_column(String(2048))
    event_type: Mapped[str] = mapped_column(String(40), default="played", nullable=False)
    played_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(UTC), nullable=False)
    position_seconds: Mapped[int | None] = mapped_column(Integer)

    song: Mapped["Song | None"] = relationship(back_populates="history_entries")


class Favorite(TimestampMixin, Base):
    __tablename__ = "favorites"
    __table_args__ = (
        Index("ix_favorites_song_id", "song_id"),
        Index("ix_favorites_artist_id", "artist_id"),
        Index("ix_favorites_album_id", "album_id"),
        Index("ix_favorites_playlist_id", "playlist_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    song_id: Mapped[int | None] = mapped_column(ForeignKey("songs.id", ondelete="CASCADE"))
    artist_id: Mapped[int | None] = mapped_column(ForeignKey("artists.id", ondelete="CASCADE"))
    album_id: Mapped[int | None] = mapped_column(ForeignKey("albums.id", ondelete="CASCADE"))
    playlist_id: Mapped[int | None] = mapped_column(ForeignKey("playlists.id", ondelete="CASCADE"))
    library_album_id: Mapped[int | None] = mapped_column(ForeignKey("library_albums.id", ondelete="CASCADE"))
    library_track_id: Mapped[int | None] = mapped_column(ForeignKey("library_tracks.id", ondelete="CASCADE"))
