"""online library and stream cache

Revision ID: 20260708_0003
Revises: 20260704_0002
Create Date: 2026-07-08
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20260708_0003"
down_revision: str | None = "20260704_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def timestamp_columns() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "library_albums",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(length=40), nullable=False),
        sa.Column("external_id", sa.String(length=255), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("artist_name", sa.String(length=255), nullable=True),
        sa.Column("artist_external_id", sa.String(length=255), nullable=True),
        sa.Column("year", sa.Integer(), nullable=True),
        sa.Column("artwork_url", sa.String(length=2048), nullable=True),
        sa.Column("artwork_path", sa.String(length=1024), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("added_at", sa.DateTime(), nullable=False),
        *timestamp_columns(),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_library_albums")),
        sa.UniqueConstraint("source", "external_id", name="uq_library_albums_source_external_id"),
    )
    op.create_index("ix_library_albums_added_at", "library_albums", ["added_at"])
    op.create_index("ix_library_albums_artist_name", "library_albums", ["artist_name"])
    op.create_index("ix_library_albums_title", "library_albums", ["title"])

    op.create_table(
        "library_tracks",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("album_id", sa.Integer(), nullable=True),
        sa.Column("source", sa.String(length=40), nullable=False),
        sa.Column("external_id", sa.String(length=255), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("artist_name", sa.String(length=255), nullable=True),
        sa.Column("artist_external_id", sa.String(length=255), nullable=True),
        sa.Column("album_title", sa.String(length=255), nullable=True),
        sa.Column("duration_seconds", sa.Integer(), nullable=True),
        sa.Column("track_number", sa.Integer(), nullable=True),
        sa.Column("disc_number", sa.Integer(), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("source_url", sa.String(length=2048), nullable=True),
        sa.Column("artwork_url", sa.String(length=2048), nullable=True),
        sa.Column("artwork_path", sa.String(length=1024), nullable=True),
        sa.Column("explicit", sa.Boolean(), nullable=False),
        sa.Column("is_downloaded", sa.Boolean(), nullable=False),
        sa.Column("file_path", sa.String(length=2048), nullable=True),
        sa.Column("lyrics", sa.Text(), nullable=True),
        *timestamp_columns(),
        sa.ForeignKeyConstraint(["album_id"], ["library_albums.id"], name=op.f("fk_library_tracks_album_id_library_albums"), ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_library_tracks")),
        sa.UniqueConstraint("album_id", "position", name="uq_library_tracks_album_id_position"),
        sa.UniqueConstraint("source", "external_id", name="uq_library_tracks_source_external_id"),
    )
    op.create_index("ix_library_tracks_album_id", "library_tracks", ["album_id"])
    op.create_index("ix_library_tracks_artist_name", "library_tracks", ["artist_name"])
    op.create_index("ix_library_tracks_is_downloaded", "library_tracks", ["is_downloaded"])
    op.create_index("ix_library_tracks_title", "library_tracks", ["title"])

    op.create_table(
        "stream_cache_entries",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(length=40), nullable=False),
        sa.Column("external_id", sa.String(length=255), nullable=False),
        sa.Column("cache_path", sa.String(length=2048), nullable=False),
        sa.Column("content_type", sa.String(length=120), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("last_accessed_at", sa.DateTime(), nullable=False),
        *timestamp_columns(),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_stream_cache_entries")),
        sa.UniqueConstraint("source", "external_id", name="uq_stream_cache_entries_source_external_id"),
    )
    op.create_index("ix_stream_cache_entries_expires_at", "stream_cache_entries", ["expires_at"])
    op.create_index("ix_stream_cache_entries_last_accessed_at", "stream_cache_entries", ["last_accessed_at"])

    op.create_table(
        "album_download_jobs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("album_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("progress", sa.Integer(), nullable=False),
        sa.Column("total_tracks", sa.Integer(), nullable=False),
        sa.Column("completed_tracks", sa.Integer(), nullable=False),
        sa.Column("failed_tracks", sa.Integer(), nullable=False),
        sa.Column("max_parallel", sa.Integer(), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        *timestamp_columns(),
        sa.ForeignKeyConstraint(["album_id"], ["library_albums.id"], name=op.f("fk_album_download_jobs_album_id_library_albums"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_album_download_jobs")),
    )
    op.create_index("ix_album_download_jobs_album_id", "album_download_jobs", ["album_id"])
    op.create_index("ix_album_download_jobs_created_at", "album_download_jobs", ["created_at"])
    op.create_index("ix_album_download_jobs_status", "album_download_jobs", ["status"])

    op.create_table(
        "album_download_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("album_job_id", sa.Integer(), nullable=False),
        sa.Column("track_id", sa.Integer(), nullable=False),
        sa.Column("download_job_id", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("progress", sa.Integer(), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        *timestamp_columns(),
        sa.ForeignKeyConstraint(["album_job_id"], ["album_download_jobs.id"], name=op.f("fk_album_download_items_album_job_id_album_download_jobs"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["download_job_id"], ["download_jobs.id"], name=op.f("fk_album_download_items_download_job_id_download_jobs"), ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["track_id"], ["library_tracks.id"], name=op.f("fk_album_download_items_track_id_library_tracks"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_album_download_items")),
        sa.UniqueConstraint("album_job_id", "track_id", name="uq_album_download_items_album_job_id_track_id"),
    )
    op.create_index("ix_album_download_items_album_job_id", "album_download_items", ["album_job_id"])
    op.create_index("ix_album_download_items_status", "album_download_items", ["status"])
    op.create_index("ix_album_download_items_track_id", "album_download_items", ["track_id"])


def downgrade() -> None:
    op.drop_index("ix_album_download_items_track_id", table_name="album_download_items")
    op.drop_index("ix_album_download_items_status", table_name="album_download_items")
    op.drop_index("ix_album_download_items_album_job_id", table_name="album_download_items")
    op.drop_table("album_download_items")
    op.drop_index("ix_album_download_jobs_status", table_name="album_download_jobs")
    op.drop_index("ix_album_download_jobs_created_at", table_name="album_download_jobs")
    op.drop_index("ix_album_download_jobs_album_id", table_name="album_download_jobs")
    op.drop_table("album_download_jobs")
    op.drop_index("ix_stream_cache_entries_last_accessed_at", table_name="stream_cache_entries")
    op.drop_index("ix_stream_cache_entries_expires_at", table_name="stream_cache_entries")
    op.drop_table("stream_cache_entries")
    op.drop_index("ix_library_tracks_title", table_name="library_tracks")
    op.drop_index("ix_library_tracks_is_downloaded", table_name="library_tracks")
    op.drop_index("ix_library_tracks_artist_name", table_name="library_tracks")
    op.drop_index("ix_library_tracks_album_id", table_name="library_tracks")
    op.drop_table("library_tracks")
    op.drop_index("ix_library_albums_title", table_name="library_albums")
    op.drop_index("ix_library_albums_artist_name", table_name="library_albums")
    op.drop_index("ix_library_albums_added_at", table_name="library_albums")
    op.drop_table("library_albums")
