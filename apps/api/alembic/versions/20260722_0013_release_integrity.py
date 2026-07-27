"""enforce favorite and mixed-playlist integrity

Revision ID: 20260722_0013
Revises: 20260715_0012
Create Date: 2026-07-22
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260722_0013"
down_revision: str | None = "20260715_0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

FAVORITE_TARGETS = (
    "song_id",
    "artist_id",
    "album_id",
    "playlist_id",
    "library_album_id",
    "library_track_id",
)


def upgrade() -> None:
    target_count = " + ".join(f"CASE WHEN {column} IS NOT NULL THEN 1 ELSE 0 END" for column in FAVORITE_TARGETS)
    op.execute(sa.text(f"DELETE FROM favorites WHERE ({target_count}) != 1"))
    for column in FAVORITE_TARGETS:
        op.execute(sa.text(
            f"DELETE FROM favorites WHERE {column} IS NOT NULL AND id NOT IN "
            f"(SELECT MIN(id) FROM favorites WHERE {column} IS NOT NULL GROUP BY {column})"
        ))

    op.execute(sa.text(
        "DELETE FROM playlist_library_tracks WHERE id NOT IN "
        "(SELECT MIN(id) FROM playlist_library_tracks GROUP BY playlist_id, track_id)"
    ))

    with op.batch_alter_table("favorites") as batch:
        batch.create_check_constraint("ck_favorites_exactly_one_target", f"({target_count}) = 1")
        for column in FAVORITE_TARGETS:
            batch.create_unique_constraint(f"uq_favorites_{column}", [column])
    with op.batch_alter_table("playlist_library_tracks") as batch:
        batch.create_unique_constraint(
            "uq_playlist_library_tracks_playlist_id_track_id",
            ["playlist_id", "track_id"],
        )


def downgrade() -> None:
    with op.batch_alter_table("playlist_library_tracks") as batch:
        batch.drop_constraint("uq_playlist_library_tracks_playlist_id_track_id", type_="unique")
    with op.batch_alter_table("favorites") as batch:
        for column in FAVORITE_TARGETS:
            batch.drop_constraint(f"uq_favorites_{column}", type_="unique")
        batch.drop_constraint("ck_favorites_exactly_one_target", type_="check")
