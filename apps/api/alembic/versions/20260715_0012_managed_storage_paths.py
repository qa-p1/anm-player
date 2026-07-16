"""normalize managed storage paths

Revision ID: 20260715_0012
Revises: 20260715_0011
Create Date: 2026-07-15
"""

from __future__ import annotations

import os
import re
from collections.abc import Sequence
from pathlib import Path, PurePosixPath

import sqlalchemy as sa
from alembic import op

revision: str = "20260715_0012"
down_revision: str | None = "20260715_0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _database_root() -> Path:
    database = op.get_bind().engine.url.database
    if not database:
        raise RuntimeError("Managed path migration requires a file-backed SQLite database")
    return Path(database).resolve().parent


def _is_absolute(value: str) -> bool:
    return bool(re.match(r"^[A-Za-z]:[/\\]", value)) or value.startswith(("/", "\\\\"))


def _inside(path: str, root: Path) -> str | None:
    normalized = os.path.normcase(os.path.abspath(path.replace("\\", os.sep)))
    root_value = os.path.normcase(os.path.abspath(root))
    try:
        if os.path.commonpath([normalized, root_value]) != root_value:
            return None
    except ValueError:
        return None
    return Path(normalized).relative_to(Path(root_value)).as_posix()


def _normalize(value: str, *, table: str, row_id: int, category: str, root: Path) -> str:
    raw = value.strip().replace("\\", "/")
    if _is_absolute(value):
        allowed = root / ("music" if category == "music" else f"cache/{category}")
        relative = _inside(value, allowed)
        if relative is None:
            raise RuntimeError(
                f"Cannot migrate {table} row {row_id}: path points outside the legacy managed {category} directory: {value}"
            )
        raw = f"music/{relative}" if category == "music" else f"cache/{category}/{relative}"
    else:
        raw = raw.removeprefix("./")
        raw = raw.removeprefix("data/")
        if category == "music":
            raw = raw.removeprefix("music/")
            raw = f"music/{raw}"
        else:
            if raw.startswith("cache/"):
                raw = raw.removeprefix("cache/")
            raw = raw.removeprefix(f"{category}/")
            raw = f"cache/{category}/{raw}"
    path = PurePosixPath(raw)
    if path.is_absolute() or ".." in path.parts:
        raise RuntimeError(f"Cannot migrate {table} row {row_id}: unsafe managed path: {value}")
    return path.as_posix()


def _normalize_column(table: str, old_column: str, category: str) -> None:
    bind = op.get_bind()
    root = _database_root()
    rows = bind.execute(sa.text(f"SELECT id, {old_column} FROM {table} WHERE {old_column} IS NOT NULL")).all()
    for row_id, value in rows:
        normalized = _normalize(str(value), table=table, row_id=row_id, category=category, root=root)
        bind.execute(
            sa.text(f"UPDATE {table} SET {old_column} = :value WHERE id = :row_id"),
            {"value": normalized, "row_id": row_id},
        )


def upgrade() -> None:
    _normalize_column("songs", "file_path", "music")
    _normalize_column("library_tracks", "file_path", "music")
    _normalize_column("stream_cache_entries", "cache_path", "streams")
    _normalize_column("lyrics_cache_entries", "cache_path", "lyrics")
    _normalize_column("download_jobs", "target_path", "music")

    with op.batch_alter_table("songs") as batch:
        batch.drop_constraint("uq_songs_file_path", type_="unique")
        batch.alter_column("file_path", new_column_name="relative_path", existing_type=sa.String(length=2048))
        batch.create_unique_constraint("uq_songs_relative_path", ["relative_path"])
    with op.batch_alter_table("library_tracks") as batch:
        batch.alter_column("file_path", new_column_name="relative_path", existing_type=sa.String(length=2048))
    with op.batch_alter_table("stream_cache_entries") as batch:
        batch.drop_constraint("uq_stream_cache_entries_source_external_id", type_="unique")
        batch.alter_column("cache_path", new_column_name="relative_path", existing_type=sa.String(length=2048))
        batch.add_column(sa.Column("quality", sa.String(length=20), nullable=False, server_default="high"))
        batch.create_unique_constraint(
            "uq_stream_cache_entries_source_external_id_quality",
            ["source", "external_id", "quality"],
        )
    with op.batch_alter_table("lyrics_cache_entries") as batch:
        batch.alter_column("cache_path", new_column_name="relative_path", existing_type=sa.String(length=2048))
    with op.batch_alter_table("download_jobs") as batch:
        batch.alter_column("target_path", new_column_name="output_relative_path", existing_type=sa.String(length=2048))
        batch.add_column(sa.Column("audio_format", sa.String(length=20), nullable=False, server_default="mp3"))


def downgrade() -> None:
    with op.batch_alter_table("download_jobs") as batch:
        batch.drop_column("audio_format")
        batch.alter_column("output_relative_path", new_column_name="target_path", existing_type=sa.String(length=2048))
    with op.batch_alter_table("lyrics_cache_entries") as batch:
        batch.alter_column("relative_path", new_column_name="cache_path", existing_type=sa.String(length=2048))
    with op.batch_alter_table("stream_cache_entries") as batch:
        batch.drop_constraint("uq_stream_cache_entries_source_external_id_quality", type_="unique")
        batch.drop_column("quality")
        batch.alter_column("relative_path", new_column_name="cache_path", existing_type=sa.String(length=2048))
        batch.create_unique_constraint("uq_stream_cache_entries_source_external_id", ["source", "external_id"])
    with op.batch_alter_table("library_tracks") as batch:
        batch.alter_column("relative_path", new_column_name="file_path", existing_type=sa.String(length=2048))
    with op.batch_alter_table("songs") as batch:
        batch.drop_constraint("uq_songs_relative_path", type_="unique")
        batch.alter_column("relative_path", new_column_name="file_path", existing_type=sa.String(length=2048))
        batch.create_unique_constraint("uq_songs_file_path", ["file_path"])
