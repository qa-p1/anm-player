"""retain remote artwork source URLs

Revision ID: 20260715_0011
Revises: 20260712_0010
Create Date: 2026-07-15
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20260715_0011"
down_revision: str | None = "20260712_0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    for table in ("artists", "albums", "songs"):
        with op.batch_alter_table(table) as batch_op:
            batch_op.add_column(sa.Column("artwork_url", sa.String(length=2048), nullable=True))

    connection = op.get_bind()
    for table in ("artists", "albums", "songs"):
        connection.execute(sa.text(
            f"UPDATE {table} SET artwork_url = artwork_path, artwork_path = NULL "
            "WHERE artwork_path LIKE 'http://%' OR artwork_path LIKE 'https://%'"
        ))

    connection.execute(sa.text("""
        UPDATE songs
        SET artwork_url = (
            SELECT library_tracks.artwork_url FROM library_tracks
            WHERE library_tracks.song_id = songs.id AND library_tracks.artwork_url IS NOT NULL
            LIMIT 1
        )
        WHERE artwork_url IS NULL
    """))
    connection.execute(sa.text("""
        UPDATE albums
        SET artwork_url = (
            SELECT library_albums.artwork_url FROM library_albums
            WHERE library_albums.local_album_id = albums.id AND library_albums.artwork_url IS NOT NULL
            LIMIT 1
        )
        WHERE artwork_url IS NULL
    """))
    connection.execute(sa.text("""
        UPDATE artists
        SET artwork_url = (
            SELECT COALESCE(albums.artwork_url, songs.artwork_url)
            FROM albums LEFT JOIN songs ON songs.album_id = albums.id
            WHERE albums.artist_id = artists.id
              AND COALESCE(albums.artwork_url, songs.artwork_url) IS NOT NULL
            LIMIT 1
        )
        WHERE artwork_url IS NULL
    """))


def downgrade() -> None:
    for table in ("songs", "albums", "artists"):
        with op.batch_alter_table(table) as batch_op:
            batch_op.drop_column("artwork_url")
