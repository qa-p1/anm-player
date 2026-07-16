"""unified album identity

Revision ID: 20260712_0010
Revises: 20260711_0009
Create Date: 2026-07-12
"""

from collections.abc import Sequence
from datetime import UTC, datetime
from uuid import uuid4

from alembic import op
import sqlalchemy as sa

revision: str = "20260712_0010"
down_revision: str | None = "20260711_0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("library_albums") as batch_op:
        batch_op.add_column(sa.Column("public_id", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("local_album_id", sa.Integer(), nullable=True))

    connection = op.get_bind()
    connection.execute(sa.text("UPDATE library_albums SET public_id = external_id WHERE public_id IS NULL"))

    represented_local_ids: set[int] = set()
    library_album_ids = [row[0] for row in connection.execute(sa.text("SELECT id FROM library_albums"))]
    for library_album_id in library_album_ids:
        local_ids = [
            row[0]
            for row in connection.execute(
                sa.text(
                    """
                    SELECT DISTINCT songs.album_id
                    FROM library_tracks
                    JOIN songs ON songs.id = library_tracks.song_id
                    WHERE library_tracks.album_id = :album_id AND songs.album_id IS NOT NULL
                    """
                ),
                {"album_id": library_album_id},
            )
        ]
        if len(local_ids) == 1 and local_ids[0] not in represented_local_ids:
            connection.execute(
                sa.text("UPDATE library_albums SET local_album_id = :local_id WHERE id = :album_id"),
                {"local_id": local_ids[0], "album_id": library_album_id},
            )
            represented_local_ids.add(local_ids[0])

    now = datetime.now(UTC).replace(tzinfo=None)
    local_albums = connection.execute(
        sa.text(
            """
            SELECT albums.id, albums.title, albums.artist_id, albums.year, albums.artwork_path,
                   artists.name AS artist_name
            FROM albums
            LEFT JOIN artists ON artists.id = albums.artist_id
            ORDER BY albums.id
            """
        )
    ).mappings()
    for album in local_albums:
        if album["id"] in represented_local_ids:
            continue
        public_id = f"local_{uuid4().hex}"
        result = connection.execute(
            sa.text(
                """
                INSERT INTO library_albums
                    (public_id, local_album_id, source, external_id, title, artist_name, year,
                     artwork_path, added_at, is_in_library, created_at, updated_at)
                VALUES
                    (:public_id, :local_album_id, 'local', :external_id, :title, :artist_name, :year,
                     :artwork_path, :now, 1, :now, :now)
                """
            ),
            {
                "public_id": public_id,
                "local_album_id": album["id"],
                "external_id": str(album["id"]),
                "title": album["title"],
                "artist_name": album["artist_name"],
                "year": album["year"],
                "artwork_path": album["artwork_path"],
                "now": now,
            },
        )
        canonical_id = result.lastrowid
        songs = connection.execute(
            sa.text(
                """
                SELECT songs.*, artists.name AS artist_name
                FROM songs
                LEFT JOIN artists ON artists.id = songs.artist_id
                WHERE songs.album_id = :album_id
                ORDER BY COALESCE(songs.disc_number, 1), COALESCE(songs.track_number, songs.id), songs.id
                """
            ),
            {"album_id": album["id"]},
        ).mappings()
        for position, song in enumerate(songs):
            connection.execute(
                sa.text(
                    """
                    INSERT INTO library_tracks
                        (album_id, song_id, source, external_id, title, artist_name, album_title,
                         duration_seconds, track_number, disc_number, position, source_url,
                         artwork_path, explicit, is_downloaded, file_path, is_in_library,
                         created_at, updated_at)
                    VALUES
                        (:album_id, :song_id, 'local', :external_id, :title, :artist_name, :album_title,
                         :duration, :track_number, :disc_number, :position, :source_url,
                         :artwork_path, 0, :is_downloaded, :file_path, 1, :created_at, :updated_at)
                    """
                ),
                {
                    "album_id": canonical_id,
                    "song_id": song["id"],
                    "external_id": f"local_song_{song['id']}",
                    "title": song["title"],
                    "artist_name": song["artist_name"],
                    "album_title": album["title"],
                    "duration": song["duration_seconds"],
                    "track_number": song["track_number"],
                    "disc_number": song["disc_number"],
                    "position": position,
                    "source_url": song["source_url"],
                    "artwork_path": song["artwork_path"],
                    "is_downloaded": song["is_downloaded"],
                    "file_path": song["file_path"],
                    "created_at": song["created_at"],
                    "updated_at": song["updated_at"],
                },
            )
        represented_local_ids.add(album["id"])

    favorites = connection.execute(
        sa.text("SELECT id, album_id FROM favorites WHERE album_id IS NOT NULL")
    ).mappings()
    for favorite in favorites:
        canonical_id = connection.execute(
            sa.text("SELECT id FROM library_albums WHERE local_album_id = :album_id"),
            {"album_id": favorite["album_id"]},
        ).scalar()
        if canonical_id is None:
            continue
        duplicate = connection.execute(
            sa.text("SELECT id FROM favorites WHERE library_album_id = :canonical_id LIMIT 1"),
            {"canonical_id": canonical_id},
        ).scalar()
        if duplicate:
            connection.execute(sa.text("DELETE FROM favorites WHERE id = :id"), {"id": favorite["id"]})
        else:
            connection.execute(
                sa.text("UPDATE favorites SET album_id = NULL, library_album_id = :canonical_id WHERE id = :id"),
                {"canonical_id": canonical_id, "id": favorite["id"]},
            )

    with op.batch_alter_table("library_albums") as batch_op:
        batch_op.alter_column("public_id", existing_type=sa.String(length=255), nullable=False)
        batch_op.create_unique_constraint("uq_library_albums_public_id", ["public_id"])
        batch_op.create_unique_constraint("uq_library_albums_local_album_id", ["local_album_id"])
        batch_op.create_index("ix_library_albums_public_id", ["public_id"])
        batch_op.create_index("ix_library_albums_local_album_id", ["local_album_id"])
        batch_op.create_foreign_key(
            "fk_library_albums_local_album_id_albums",
            "albums",
            ["local_album_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    with op.batch_alter_table("library_albums") as batch_op:
        batch_op.drop_constraint("fk_library_albums_local_album_id_albums", type_="foreignkey")
        batch_op.drop_index("ix_library_albums_local_album_id")
        batch_op.drop_index("ix_library_albums_public_id")
        batch_op.drop_constraint("uq_library_albums_local_album_id", type_="unique")
        batch_op.drop_constraint("uq_library_albums_public_id", type_="unique")
        batch_op.drop_column("local_album_id")
        batch_op.drop_column("public_id")
