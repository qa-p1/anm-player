"""link library tracks to generated songs

Revision ID: 20260711_0008
Revises: 20260709_0007
Create Date: 2026-07-11
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20260711_0008"
down_revision: str | None = "20260709_0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("library_tracks") as batch_op:
        batch_op.add_column(sa.Column("song_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key("fk_library_tracks_song_id_songs", "songs", ["song_id"], ["id"], ondelete="SET NULL")
        batch_op.create_index("ix_library_tracks_song_id", ["song_id"])

    op.execute(
        """
        UPDATE library_tracks
        SET song_id = (
            SELECT songs.id
            FROM songs
            WHERE songs.source_url = library_tracks.source_url
              AND songs.file_path = library_tracks.file_path
            LIMIT 1
        )
        WHERE file_path IS NOT NULL
          AND source_url IS NOT NULL
        """
    )


def downgrade() -> None:
    with op.batch_alter_table("library_tracks") as batch_op:
        batch_op.drop_index("ix_library_tracks_song_id")
        batch_op.drop_constraint("fk_library_tracks_song_id_songs", type_="foreignkey")
        batch_op.drop_column("song_id")
