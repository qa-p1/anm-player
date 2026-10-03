"""Consistent database snapshots taken while ANM Player keeps running."""

import os
import sqlite3
import tempfile
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path


class BackupError(RuntimeError):
    pass


def create_database_snapshot(database: Path, *, directory: Path | None = None) -> Path:
    """Copy the live SQLite database through SQLite's online backup API.

    Unlike copying aura.db (and its WAL) by hand, the backup API produces a
    transactionally consistent single-file database even while the worker
    and API keep writing. The caller owns, and must delete, the returned file.
    """
    if not database.is_file():
        raise BackupError("The database file does not exist")
    descriptor, temporary_name = tempfile.mkstemp(prefix=".anm-player-backup-", suffix=".db", dir=directory)
    os.close(descriptor)
    snapshot = Path(temporary_name)
    try:
        with (
            closing(sqlite3.connect(f"{database.resolve().as_uri()}?mode=ro", uri=True)) as source,
            closing(sqlite3.connect(snapshot)) as target,
        ):
            source.backup(target)
            result = target.execute("PRAGMA quick_check").fetchone()
            if not result or str(result[0]).casefold() != "ok":
                raise BackupError(f"The database snapshot failed its integrity check: {result}")
    except BaseException:
        snapshot.unlink(missing_ok=True)
        raise
    return snapshot


def backup_filename(now: datetime | None = None) -> str:
    timestamp = (now or datetime.now(UTC)).strftime("%Y%m%d-%H%M%S")
    return f"anm-player-backup-{timestamp}.db"
