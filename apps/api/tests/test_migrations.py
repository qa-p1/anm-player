import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest


API_ROOT = Path(__file__).resolve().parents[1]


def _alembic(root: Path, revision: str) -> None:
    environment = {
        **os.environ,
        "AURA_DATA_ROOT": str(root),
        "AURA_STATE_FILE": str(root / "bootstrap" / "state.json"),
        "API_ENV": "test",
    }
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", revision],
        cwd=API_ROOT,
        env=environment,
        check=True,
        capture_output=True,
        text=True,
    )


def test_integrity_migration_cleans_existing_duplicates(tmp_path) -> None:
    root = tmp_path / "data"
    _alembic(root, "20260715_0012")
    database = root / "aura.db"
    now = "2026-07-22 00:00:00"
    with sqlite3.connect(database) as connection:
        connection.execute(
            "INSERT INTO playlists (id, name, created_at, updated_at) VALUES (1, 'List', ?, ?)",
            (now, now),
        )
        connection.execute(
            "INSERT INTO library_tracks "
            "(id, source, external_id, title, position, explicit, is_downloaded, is_in_library, created_at, updated_at) "
            "VALUES (1, 'youtube', 'track', 'Track', 0, 0, 1, 1, ?, ?)",
            (now, now),
        )
        connection.executemany(
            "INSERT INTO favorites (playlist_id, created_at, updated_at) VALUES (?, ?, ?)",
            [(1, now, now), (1, now, now)],
        )
        connection.execute("INSERT INTO favorites (created_at, updated_at) VALUES (?, ?)", (now, now))
        connection.executemany(
            "INSERT INTO playlist_library_tracks (playlist_id, track_id, position, created_at, updated_at) "
            "VALUES (1, 1, ?, ?, ?)",
            [(0, now, now), (1, now, now)],
        )

    _alembic(root, "head")

    with sqlite3.connect(database) as connection:
        assert connection.execute("PRAGMA quick_check").fetchone() == ("ok",)
        assert connection.execute("SELECT COUNT(*) FROM favorites").fetchone() == (1,)
        assert connection.execute("SELECT COUNT(*) FROM playlist_library_tracks").fetchone() == (1,)
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute("INSERT INTO favorites (created_at, updated_at) VALUES (?, ?)", (now, now))
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                "INSERT INTO playlist_library_tracks (playlist_id, track_id, position, created_at, updated_at) "
                "VALUES (1, 1, 2, ?, ?)",
                (now, now),
            )
