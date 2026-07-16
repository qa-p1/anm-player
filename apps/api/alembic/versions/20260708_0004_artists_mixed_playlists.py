"""online artists and mixed playlist tracks

Revision ID: 20260708_0004
Revises: 20260708_0003
Create Date: 2026-07-08
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20260708_0004"
down_revision: str | None = "20260708_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def timestamp_columns() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "library_artists",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(length=40), nullable=False),
        sa.Column("external_id", sa.String(length=255), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("thumbnail_url", sa.String(length=2048), nullable=True),
        sa.Column("added_at", sa.DateTime(), nullable=False),
        *timestamp_columns(),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_library_artists")),
        sa.UniqueConstraint("source", "external_id", name="uq_library_artists_source_external_id"),
    )
    op.create_index("ix_library_artists_added_at", "library_artists", ["added_at"])
    op.create_index("ix_library_artists_name", "library_artists", ["name"])

    op.create_table(
        "playlist_library_tracks",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("playlist_id", sa.Integer(), nullable=False),
        sa.Column("track_id", sa.Integer(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        *timestamp_columns(),
        sa.ForeignKeyConstraint(["playlist_id"], ["playlists.id"], name=op.f("fk_playlist_library_tracks_playlist_id_playlists"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["track_id"], ["library_tracks.id"], name=op.f("fk_playlist_library_tracks_track_id_library_tracks"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_playlist_library_tracks")),
        sa.UniqueConstraint("playlist_id", "position", name="uq_playlist_library_tracks_playlist_id_position"),
    )
    op.create_index("ix_playlist_library_tracks_playlist_id", "playlist_library_tracks", ["playlist_id"])
    op.create_index("ix_playlist_library_tracks_track_id", "playlist_library_tracks", ["track_id"])


def downgrade() -> None:
    op.drop_index("ix_playlist_library_tracks_track_id", table_name="playlist_library_tracks")
    op.drop_index("ix_playlist_library_tracks_playlist_id", table_name="playlist_library_tracks")
    op.drop_table("playlist_library_tracks")
    op.drop_index("ix_library_artists_name", table_name="library_artists")
    op.drop_index("ix_library_artists_added_at", table_name="library_artists")
    op.drop_table("library_artists")
