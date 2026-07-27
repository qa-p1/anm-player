from __future__ import annotations

import importlib.util
import sqlite3
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parents[3] / "docker" / "consolidate-storage.py"
SPEC = importlib.util.spec_from_file_location("consolidate_storage", SCRIPT_PATH)
assert SPEC and SPEC.loader
script = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(script)


def create_database(path: Path) -> None:
    connection = sqlite3.connect(path)
    try:
        connection.execute("CREATE TABLE songs (id INTEGER PRIMARY KEY, title TEXT)")
        connection.execute("INSERT INTO songs (title) VALUES ('Track')")
        connection.commit()
    finally:
        connection.close()


def arguments(*values: str):
    return script.parse_args(values)


def test_confirmation_is_required_and_sources_are_unchanged(tmp_path) -> None:
    database = tmp_path / "legacy.db"
    create_database(database)
    target = tmp_path / "managed"

    result = script.main(["--database", str(database), "--target", str(target)])

    assert result == 1
    assert database.is_file()
    assert not target.exists()


def test_consolidation_uses_sqlite_backup_and_full_file_verification(tmp_path) -> None:
    database = tmp_path / "legacy.db"
    music = tmp_path / "legacy music"
    music.mkdir()
    (music / "song.mp3").write_bytes(b"audio")
    create_database(database)
    target = tmp_path / "managed root"

    result = script.main(
        [
            "--confirm-app-stopped",
            "--database",
            str(database),
            "--music",
            str(music),
            "--target",
            str(target),
        ]
    )

    assert result == 0
    assert database.is_file() and (music / "song.mp3").is_file()
    assert (target / "music" / "song.mp3").read_bytes() == b"audio"
    with sqlite3.connect(target / "aura.db") as connection:
        assert connection.execute("PRAGMA quick_check").fetchone() == ("ok",)
        assert connection.execute("SELECT title FROM songs").fetchone() == ("Track",)
    manifest = (target / ".aura-consolidation.json").read_text(encoding="utf-8")
    assert '"verification": "full-sha256"' in manifest


def test_target_source_overlap_is_rejected(tmp_path) -> None:
    database = tmp_path / "legacy.db"
    source = tmp_path / "music"
    source.mkdir()
    create_database(database)

    result = script.main(
        [
            "--confirm-app-stopped",
            "--database",
            str(database),
            "--music",
            str(source),
            "--target",
            str(source / "managed"),
        ]
    )

    assert result == 1
    assert database.is_file()
