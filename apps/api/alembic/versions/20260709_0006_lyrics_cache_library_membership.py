"""lyrics cache and online library membership

Revision ID: 20260709_0006
Revises: 20260708_0005
Create Date: 2026-07-09
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20260709_0006"
down_revision: str | None = "20260708_0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def timestamp_columns() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "lyrics_cache_entries",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(length=40), nullable=False),
        sa.Column("external_id", sa.String(length=255), nullable=False),
        sa.Column("song_id", sa.Integer(), nullable=True),
        sa.Column("cache_path", sa.String(length=2048), nullable=True),
        sa.Column("format", sa.String(length=20), nullable=True),
        sa.Column("provider", sa.String(length=80), nullable=True),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("error_code", sa.String(length=80), nullable=True),
        sa.Column("last_fetched_at", sa.DateTime(), nullable=True),
        sa.Column("last_accessed_at", sa.DateTime(), nullable=True),
        *timestamp_columns(),
        sa.ForeignKeyConstraint(["song_id"], ["songs.id"], name=op.f("fk_lyrics_cache_entries_song_id_songs"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_lyrics_cache_entries")),
        sa.UniqueConstraint("source", "external_id", name="uq_lyrics_cache_entries_source_external_id"),
    )
    op.create_index("ix_lyrics_cache_entries_last_accessed_at", "lyrics_cache_entries", ["last_accessed_at"])
    op.create_index("ix_lyrics_cache_entries_song_id", "lyrics_cache_entries", ["song_id"])
    op.create_index("ix_lyrics_cache_entries_status", "lyrics_cache_entries", ["status"])

    with op.batch_alter_table("favorites") as batch_op:
        batch_op.add_column(sa.Column("library_album_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("library_track_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            op.f("fk_favorites_library_album_id_library_albums"),
            "library_albums",
            ["library_album_id"],
            ["id"],
            ondelete="CASCADE",
        )
        batch_op.create_foreign_key(
            op.f("fk_favorites_library_track_id_library_tracks"),
            "library_tracks",
            ["library_track_id"],
            ["id"],
            ondelete="CASCADE",
        )
        batch_op.create_index("ix_favorites_library_album_id", ["library_album_id"])
        batch_op.create_index("ix_favorites_library_track_id", ["library_track_id"])

    with op.batch_alter_table("library_albums") as batch_op:
        batch_op.add_column(sa.Column("is_in_library", sa.Boolean(), nullable=False, server_default=sa.true()))
        batch_op.add_column(sa.Column("removed_at", sa.DateTime(), nullable=True))

    with op.batch_alter_table("library_tracks") as batch_op:
        batch_op.add_column(sa.Column("is_in_library", sa.Boolean(), nullable=False, server_default=sa.true()))
        batch_op.add_column(sa.Column("removed_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("library_tracks") as batch_op:
        batch_op.drop_column("removed_at")
        batch_op.drop_column("is_in_library")

    with op.batch_alter_table("library_albums") as batch_op:
        batch_op.drop_column("removed_at")
        batch_op.drop_column("is_in_library")

    with op.batch_alter_table("favorites") as batch_op:
        batch_op.drop_index("ix_favorites_library_track_id")
        batch_op.drop_index("ix_favorites_library_album_id")
        batch_op.drop_constraint(op.f("fk_favorites_library_track_id_library_tracks"), type_="foreignkey")
        batch_op.drop_constraint(op.f("fk_favorites_library_album_id_library_albums"), type_="foreignkey")
        batch_op.drop_column("library_track_id")
        batch_op.drop_column("library_album_id")

    op.drop_index("ix_lyrics_cache_entries_status", table_name="lyrics_cache_entries")
    op.drop_index("ix_lyrics_cache_entries_song_id", table_name="lyrics_cache_entries")
    op.drop_index("ix_lyrics_cache_entries_last_accessed_at", table_name="lyrics_cache_entries")
    op.drop_table("lyrics_cache_entries")
