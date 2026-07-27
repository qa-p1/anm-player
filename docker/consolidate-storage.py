"""Consolidate legacy Aura mounts into one fully verified managed data root."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sqlite3
import uuid
from pathlib import Path
from typing import Iterable


class ConsolidationError(RuntimeError):
    pass


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def assert_no_symlinks(root: Path) -> None:
    if root.is_symlink():
        raise ConsolidationError(f"Symbolic links are not supported: {root}")
    if root.is_dir():
        for path in root.rglob("*"):
            if path.is_symlink():
                raise ConsolidationError(f"Symbolic links are not supported: {path}")


def overlaps(first: Path, second: Path) -> bool:
    first_value = os.path.normcase(str(first.resolve()))
    second_value = os.path.normcase(str(second.resolve()))
    try:
        common = os.path.commonpath([first_value, second_value])
    except ValueError:
        return False
    return common in {first_value, second_value}


def copy_tree(source: Path, destination: Path) -> list[dict[str, object]]:
    entries: list[dict[str, object]] = []
    if not source.exists():
        return entries
    if not source.is_dir():
        raise ConsolidationError(f"Source is not a directory: {source}")
    assert_no_symlinks(source)
    for item in sorted(path for path in source.rglob("*") if path.is_file()):
        relative = item.relative_to(source)
        output = destination / relative
        output.parent.mkdir(parents=True, exist_ok=True)
        temporary = output.with_name(f".{output.name}.aura-copy")
        shutil.copy2(item, temporary)
        os.replace(temporary, output)
        checksum = digest(item)
        if item.stat().st_size != output.stat().st_size or checksum != digest(output):
            raise ConsolidationError(f"Verification failed while copying {relative.as_posix()}")
        entries.append(
            {
                "name": relative.as_posix(),
                "size": item.stat().st_size,
                "sha256": checksum,
            }
        )
    return entries


def backup_database(source: Path, destination: Path) -> dict[str, object]:
    if not source.is_file():
        raise ConsolidationError(f"Database does not exist: {source}")
    assert_no_symlinks(source)
    source_connection = sqlite3.connect(f"file:{source.as_posix()}?mode=ro", uri=True, timeout=1)
    destination_connection = sqlite3.connect(destination)
    try:
        source_check = source_connection.execute("PRAGMA quick_check").fetchone()
        if not source_check or str(source_check[0]).casefold() != "ok":
            raise ConsolidationError(f"Source SQLite quick_check failed: {source_check}")
        source_connection.backup(destination_connection)
        destination_connection.commit()
        copied_check = destination_connection.execute("PRAGMA quick_check").fetchone()
        if not copied_check or str(copied_check[0]).casefold() != "ok":
            raise ConsolidationError(f"Copied SQLite quick_check failed: {copied_check}")
    except sqlite3.DatabaseError as exc:
        raise ConsolidationError("SQLite backup or consistency verification failed.") from exc
    finally:
        destination_connection.close()
        source_connection.close()
    return {
        "name": "aura.db",
        "size": destination.stat().st_size,
        "sha256": digest(destination),
        "source_sha256": digest(source),
        "sqlite_backup": True,
    }


def verify_manifest(root: Path, entries: list[dict[str, object]]) -> None:
    expected = {str(entry["name"]): entry for entry in entries}
    actual = {
        path.relative_to(root).as_posix(): path
        for path in root.rglob("*")
        if path.is_file() and path.name != ".aura-consolidation.json"
    }
    if set(actual) != set(expected):
        raise ConsolidationError("Full manifest verification found missing or unexpected files.")
    for name, entry in expected.items():
        path = actual[name]
        if path.stat().st_size != int(entry["size"]) or digest(path) != str(entry["sha256"]):
            raise ConsolidationError(f"Full manifest verification failed for {name}")


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--confirm-app-stopped",
        action="store_true",
        help="Confirm that all Aura API, worker, launcher, and container processes are stopped",
    )
    parser.add_argument("--target", required=True, type=Path)
    parser.add_argument("--database", required=True, type=Path, help="Legacy aura.db file")
    for name in ("music", "downloads", "cache", "config", "thumbnails", "logs"):
        parser.add_argument(f"--{name}", type=Path)
    return parser.parse_args(argv)


def consolidate(args: argparse.Namespace) -> tuple[Path, int, int]:
    if not args.confirm_app_stopped:
        raise ConsolidationError("Stop Aura completely and pass --confirm-app-stopped to continue.")
    target = args.target.expanduser().absolute()
    if target.exists() and (not target.is_dir() or any(target.iterdir())):
        raise ConsolidationError(f"Target must be absent or an empty directory: {target}")
    if any(part.is_symlink() for part in (target, *target.parents) if part.exists()):
        raise ConsolidationError("The target and its existing parents may not be symbolic links.")

    database = args.database.expanduser().resolve()
    sources = {
        name: value.expanduser().resolve()
        for name in ("music", "downloads", "cache", "config", "thumbnails", "logs")
        if (value := getattr(args, name)) is not None
    }
    for source in (database, *sources.values()):
        if overlaps(target, source):
            raise ConsolidationError(f"Target overlaps a source: {source}")

    target.parent.mkdir(parents=True, exist_ok=True)
    staging = target.parent / f".{target.name}.aura-staging-{uuid.uuid4().hex}"
    staging.mkdir()
    manifest: list[dict[str, object]] = []
    try:
        manifest.append(backup_database(database, staging / "aura.db"))
        for name, source in sources.items():
            for entry in copy_tree(source, staging / name):
                entry["name"] = f"{name}/{entry['name']}"
                manifest.append(entry)
        verify_manifest(staging, manifest)
        total_bytes = sum(int(entry["size"]) for entry in manifest)
        recovery = {
            "verification": "full-sha256",
            "database": str(database),
            "sources": {name: str(path) for name, path in sources.items()},
            "target": str(target),
            "files": manifest,
            "total_bytes": total_bytes,
        }
        (staging / ".aura-consolidation.json").write_text(
            json.dumps(recovery, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        if target.exists():
            target.rmdir()
        os.replace(staging, target)
        return target, len(manifest), total_bytes
    except Exception as exc:
        raise ConsolidationError(
            f"Consolidation failed. Original sources were not modified; recovery staging remains at {staging}"
        ) from exc


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        target, total_files, total_bytes = consolidate(args)
    except ConsolidationError as exc:
        print(exc)
        return 1
    print(f"Fully verified {total_files} files ({total_bytes} bytes) in {target}")
    print("Legacy sources were not modified or deleted. Keep them until Aura starts successfully from the new root.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
