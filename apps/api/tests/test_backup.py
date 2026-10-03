import sqlite3
import tempfile
from contextlib import closing
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.backup import BackupError, create_database_snapshot
from app.storage import storage_manager


def _write_rows(database: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(database)
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("CREATE TABLE songs (id INTEGER PRIMARY KEY, title TEXT)")
    connection.executemany("INSERT INTO songs (title) VALUES (?)", [("First",), ("Second",)])
    connection.commit()
    return connection


def test_snapshot_includes_committed_wal_data_while_the_database_is_open(tmp_path) -> None:
    database = tmp_path / "aura.db"
    writer = _write_rows(database)
    try:
        # The rows still live in the WAL; copying aura.db alone would miss them.
        assert (tmp_path / "aura.db-wal").stat().st_size > 0
        snapshot = create_database_snapshot(database, directory=tmp_path)
    finally:
        writer.close()

    with closing(sqlite3.connect(snapshot)) as copy:
        assert copy.execute("SELECT title FROM songs ORDER BY id").fetchall() == [("First",), ("Second",)]
    assert not Path(f"{snapshot}-wal").exists()


def test_snapshot_rejects_a_missing_database(tmp_path) -> None:
    with pytest.raises(BackupError):
        create_database_snapshot(tmp_path / "missing.db")


def test_backup_route_streams_a_snapshot_and_removes_the_temporary_file(music_directory) -> None:
    database = storage_manager.paths.database
    with closing(_write_rows(database)):
        before = set(Path(tempfile.gettempdir()).glob(".anm-player-backup-*"))
        response = TestClient(app, base_url="http://localhost").get("/api/v1/settings/backup")
        after = set(Path(tempfile.gettempdir()).glob(".anm-player-backup-*"))

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/vnd.sqlite3"
    assert response.headers["content-disposition"].startswith('attachment; filename="anm-player-backup-')
    assert response.headers["cache-control"] == "no-store"
    assert response.content.startswith(b"SQLite format 3\x00")
    assert after == before
