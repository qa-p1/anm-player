"""initial backend foundation schema

Revision ID: 20260704_0001
Revises:
Create Date: 2026-07-04
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20260704_0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def timestamp_columns() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "artists",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("sort_name", sa.String(length=255), nullable=True),
        sa.Column("artwork_path", sa.String(length=1024), nullable=True),
        *timestamp_columns(),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_artists")),
        sa.UniqueConstraint("name", name="uq_artists_name"),
    )
    op.create_index("ix_artists_name", "artists", ["name"])

    op.create_table(
        "download_jobs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("source_url", sa.String(length=2048), nullable=True),
        sa.Column("title", sa.String(length=255), nullable=True),
        sa.Column("progress", sa.Integer(), nullable=False),
        sa.Column("target_path", sa.String(length=2048), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        *timestamp_columns(),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_download_jobs")),
    )
    op.create_index("ix_download_jobs_created_at", "download_jobs", ["created_at"])
    op.create_index("ix_download_jobs_status", "download_jobs", ["status"])

    op.create_table(
        "playlists",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("artwork_path", sa.String(length=1024), nullable=True),
        *timestamp_columns(),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_playlists")),
        sa.UniqueConstraint("name", name="uq_playlists_name"),
    )
    op.create_index("ix_playlists_name", "playlists", ["name"])

    op.create_table(
        "user_settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("key", sa.String(length=120), nullable=False),
        sa.Column("value_json", sa.Text(), nullable=False),
        *timestamp_columns(),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_user_settings")),
        sa.UniqueConstraint("key", name="uq_user_settings_key"),
    )
    op.create_index("ix_user_settings_key", "user_settings", ["key"])

    op.create_table(
        "albums",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("artist_id", sa.Integer(), nullable=True),
        sa.Column("year", sa.Integer(), nullable=True),
        sa.Column("artwork_path", sa.String(length=1024), nullable=True),
        *timestamp_columns(),
        sa.ForeignKeyConstraint(["artist_id"], ["artists.id"], name=op.f("fk_albums_artist_id_artists"), ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_albums")),
        sa.UniqueConstraint("title", "artist_id", name="uq_albums_title_artist_id"),
    )
    op.create_index("ix_albums_artist_id", "albums", ["artist_id"])
    op.create_index("ix_albums_title", "albums", ["title"])

    op.create_table(
        "queue_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("download_job_id", sa.Integer(), nullable=True),
        sa.Column("item_type", sa.String(length=40), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False),
        sa.Column("scheduled_at", sa.DateTime(), nullable=True),
        *timestamp_columns(),
        sa.ForeignKeyConstraint(
            ["download_job_id"],
            ["download_jobs.id"],
            name=op.f("fk_queue_items_download_job_id_download_jobs"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_queue_items")),
    )
    op.create_index("ix_queue_items_scheduled_at", "queue_items", ["scheduled_at"])
    op.create_index("ix_queue_items_status_priority", "queue_items", ["status", "priority"])

    op.create_table(
        "songs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("artist_id", sa.Integer(), nullable=True),
        sa.Column("album_id", sa.Integer(), nullable=True),
        sa.Column("duration_seconds", sa.Integer(), nullable=True),
        sa.Column("track_number", sa.Integer(), nullable=True),
        sa.Column("disc_number", sa.Integer(), nullable=True),
        sa.Column("source_url", sa.String(length=2048), nullable=True),
        sa.Column("file_path", sa.String(length=2048), nullable=True),
        sa.Column("artwork_path", sa.String(length=1024), nullable=True),
        sa.Column("lyrics", sa.Text(), nullable=True),
        sa.Column("is_downloaded", sa.Boolean(), nullable=False),
        *timestamp_columns(),
        sa.ForeignKeyConstraint(["album_id"], ["albums.id"], name=op.f("fk_songs_album_id_albums"), ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["artist_id"], ["artists.id"], name=op.f("fk_songs_artist_id_artists"), ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_songs")),
        sa.UniqueConstraint("file_path", name="uq_songs_file_path"),
    )
    op.create_index("ix_songs_album_id", "songs", ["album_id"])
    op.create_index("ix_songs_artist_id", "songs", ["artist_id"])
    op.create_index("ix_songs_is_downloaded", "songs", ["is_downloaded"])
    op.create_index("ix_songs_title", "songs", ["title"])

    op.create_table(
        "favorites",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("song_id", sa.Integer(), nullable=True),
        sa.Column("artist_id", sa.Integer(), nullable=True),
        sa.Column("album_id", sa.Integer(), nullable=True),
        sa.Column("playlist_id", sa.Integer(), nullable=True),
        *timestamp_columns(),
        sa.ForeignKeyConstraint(["album_id"], ["albums.id"], name=op.f("fk_favorites_album_id_albums"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["artist_id"], ["artists.id"], name=op.f("fk_favorites_artist_id_artists"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["playlist_id"], ["playlists.id"], name=op.f("fk_favorites_playlist_id_playlists"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["song_id"], ["songs.id"], name=op.f("fk_favorites_song_id_songs"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_favorites")),
    )
    op.create_index("ix_favorites_album_id", "favorites", ["album_id"])
    op.create_index("ix_favorites_artist_id", "favorites", ["artist_id"])
    op.create_index("ix_favorites_playlist_id", "favorites", ["playlist_id"])
    op.create_index("ix_favorites_song_id", "favorites", ["song_id"])

    op.create_table(
        "history",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("song_id", sa.Integer(), nullable=True),
        sa.Column("event_type", sa.String(length=40), nullable=False),
        sa.Column("played_at", sa.DateTime(), nullable=False),
        sa.Column("position_seconds", sa.Integer(), nullable=True),
        *timestamp_columns(),
        sa.ForeignKeyConstraint(["song_id"], ["songs.id"], name=op.f("fk_history_song_id_songs"), ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_history")),
    )
    op.create_index("ix_history_played_at", "history", ["played_at"])
    op.create_index("ix_history_song_id", "history", ["song_id"])

    op.create_table(
        "playlist_songs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("playlist_id", sa.Integer(), nullable=False),
        sa.Column("song_id", sa.Integer(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        *timestamp_columns(),
        sa.ForeignKeyConstraint(["playlist_id"], ["playlists.id"], name=op.f("fk_playlist_songs_playlist_id_playlists"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["song_id"], ["songs.id"], name=op.f("fk_playlist_songs_song_id_songs"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_playlist_songs")),
        sa.UniqueConstraint("playlist_id", "position", name="uq_playlist_songs_playlist_id_position"),
        sa.UniqueConstraint("playlist_id", "song_id", name="uq_playlist_songs_playlist_id_song_id"),
    )
    op.create_index("ix_playlist_songs_playlist_id", "playlist_songs", ["playlist_id"])
    op.create_index("ix_playlist_songs_song_id", "playlist_songs", ["song_id"])


def downgrade() -> None:
    op.drop_index("ix_playlist_songs_song_id", table_name="playlist_songs")
    op.drop_index("ix_playlist_songs_playlist_id", table_name="playlist_songs")
    op.drop_table("playlist_songs")
    op.drop_index("ix_history_song_id", table_name="history")
    op.drop_index("ix_history_played_at", table_name="history")
    op.drop_table("history")
    op.drop_index("ix_favorites_song_id", table_name="favorites")
    op.drop_index("ix_favorites_playlist_id", table_name="favorites")
    op.drop_index("ix_favorites_artist_id", table_name="favorites")
    op.drop_index("ix_favorites_album_id", table_name="favorites")
    op.drop_table("favorites")
    op.drop_index("ix_songs_title", table_name="songs")
    op.drop_index("ix_songs_is_downloaded", table_name="songs")
    op.drop_index("ix_songs_artist_id", table_name="songs")
    op.drop_index("ix_songs_album_id", table_name="songs")
    op.drop_table("songs")
    op.drop_index("ix_queue_items_status_priority", table_name="queue_items")
    op.drop_index("ix_queue_items_scheduled_at", table_name="queue_items")
    op.drop_table("queue_items")
    op.drop_index("ix_albums_title", table_name="albums")
    op.drop_index("ix_albums_artist_id", table_name="albums")
    op.drop_table("albums")
    op.drop_index("ix_user_settings_key", table_name="user_settings")
    op.drop_table("user_settings")
    op.drop_index("ix_playlists_name", table_name="playlists")
    op.drop_table("playlists")
    op.drop_index("ix_download_jobs_status", table_name="download_jobs")
    op.drop_index("ix_download_jobs_created_at", table_name="download_jobs")
    op.drop_table("download_jobs")
    op.drop_index("ix_artists_name", table_name="artists")
    op.drop_table("artists")
