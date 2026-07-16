from __future__ import annotations

import contextlib
import hashlib
import logging
import os
import shutil
import sqlite3
import threading
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator

from sqlalchemy import select

from app.core.logging import close_storage_log_handlers, reconfigure_storage_logging
from app.database.session import SessionLocal, engine_manager
from app.models import LibraryTrack, Song
from app.storage import storage_manager, storage_state_store

logger = logging.getLogger(__name__)


class StorageMigrationError(RuntimeError):
    pass


@dataclass
class DirectoryGrant:
    path: Path
    expires_at: float


class StorageCoordinator:
    """Serializes storage changes and exposes checkpoints to all file users."""

    def __init__(self) -> None:
        self._migration_lock = threading.Lock()
        self._state_lock = threading.RLock()
        self._activity = threading.Condition(self._state_lock)
        self._active_readers = 0
        self._active_writers = 0
        self._active_streams = 0
        self.gated = threading.Event()
        self.stop_claiming = threading.Event()
        self.cancel_work = threading.Event()
        self._directory_grants: dict[str, DirectoryGrant] = {}
        self._thread: threading.Thread | None = None
        migration = storage_state_store.read().get("migration")
        if migration:
            self.gated.set()
            self.stop_claiming.set()
            self.cancel_work.set()

    @property
    def migration_active(self) -> bool:
        return storage_state_store.read().get("migration") is not None

    @contextlib.contextmanager
    def filesystem_read(self) -> Iterator[None]:
        with self._activity:
            if self.gated.is_set():
                raise StorageMigrationError("Storage migration is in progress")
            self._active_readers += 1
        try:
            yield
        finally:
            with self._activity:
                self._active_readers -= 1
                self._activity.notify_all()

    @contextlib.contextmanager
    def filesystem_write(self) -> Iterator[None]:
        with self._activity:
            if self.gated.is_set():
                raise StorageMigrationError("Storage migration is in progress")
            self._active_writers += 1
        try:
            yield
        finally:
            with self._activity:
                self._active_writers -= 1
                self._activity.notify_all()

    def stream_opened(self) -> None:
        with self._activity:
            self._active_streams += 1

    def stream_closed(self) -> None:
        with self._activity:
            self._active_streams = max(0, self._active_streams - 1)
            self._activity.notify_all()

    def status(self) -> dict[str, Any]:
        migration = storage_state_store.read().get("migration")
        if not migration:
            return {
                "active": False,
                "phase": "idle",
                "message": "Storage is ready.",
                "files_processed": 0,
                "files_total": 0,
                "bytes_processed": 0,
                "bytes_total": 0,
                "percent": 100,
                "error": None,
                "cleanup_warning": None,
            }
        result = dict(migration)
        total = int(result.get("bytes_total") or 0)
        processed = int(result.get("bytes_processed") or 0)
        result["active"] = result.get("phase") not in {"blocked", "failed"} and not result.get("cleanup_warning")
        result["percent"] = min(100, round(processed * 100 / total, 1)) if total else 0
        return result

    def validate_target(self, target: str | Path) -> dict[str, Any]:
        old = storage_manager.paths.root.resolve()
        selected_path = Path(target).expanduser().absolute()
        if selected_path.is_symlink():
            raise StorageMigrationError("The selected destination may not be a symbolic link.")
        target_path = selected_path.resolve()
        if not target_path.exists() or not target_path.is_dir():
            raise StorageMigrationError("The selected destination must be an existing directory.")
        if any(target_path.iterdir()):
            raise StorageMigrationError("Only an empty destination directory can be selected.")
        old_key = os.path.normcase(str(old))
        target_key = os.path.normcase(str(target_path))
        try:
            common = os.path.commonpath([old_key, target_key])
        except ValueError:
            common = ""
        if old_key == target_key or common in {old_key, target_key}:
            raise StorageMigrationError("The destination cannot be the current data root or its parent/child.")

        probe = target_path / f".aura-write-probe-{uuid.uuid4().hex}"
        try:
            with probe.open("xb") as handle:
                handle.write(b"aura")
                handle.flush()
                os.fsync(handle.fileno())
            probe.unlink()
        except OSError as exc:
            probe.unlink(missing_ok=True)
            raise StorageMigrationError(f"The destination is not writable: {exc}") from exc

        source_files, source_bytes = self._tree_totals(old)
        free = shutil.disk_usage(target_path).free
        if free < source_bytes:
            raise StorageMigrationError(
                f"The destination needs at least {source_bytes} free bytes; only {free} are available."
            )
        same_device = old.stat().st_dev == target_path.stat().st_dev
        return {
            "target": str(target_path),
            "old_root": str(old),
            "files_total": source_files,
            "bytes_total": source_bytes,
            "same_device": same_device,
        }

    def start_migration(self, target: str | Path) -> str:
        if not engine_manager.managed:
            raise StorageMigrationError("Storage migration is unsupported for a non-SQLite DATABASE_URL.")
        if not self._migration_lock.acquire(blocking=False):
            raise StorageMigrationError("Another storage migration is already active.")
        try:
            if storage_state_store.read().get("migration"):
                raise StorageMigrationError("Storage recovery or migration is already active.")
            validation = self.validate_target(target)
            operation_id = uuid.uuid4().hex
            phase = "prepared" if validation["same_device"] else "copying"
            migration = {
                "operation_id": operation_id,
                "phase": phase,
                "message": "Preparing storage move…" if validation["same_device"] else "Copying managed data…",
                "old_root": validation["old_root"],
                "target_root": validation["target"],
                "temporary_root": None,
                "copy_mode": "rename" if validation["same_device"] else "copy",
                "files_processed": 0,
                "files_total": validation["files_total"],
                "bytes_processed": 0,
                "bytes_total": validation["bytes_total"],
                "manifest": [],
                "error": None,
                "cleanup_warning": None,
                "started_at": time.time(),
            }
            storage_state_store.set_migration(migration)
            self._set_gate()
            self._thread = threading.Thread(
                target=self._run_guarded,
                args=(operation_id,),
                name=f"aura-storage-migration-{operation_id[:8]}",
                daemon=True,
            )
            self._thread.start()
            return operation_id
        except Exception:
            self._migration_lock.release()
            raise

    def recover(self) -> None:
        if not storage_state_store.read().get("migration"):
            return
        if not self._migration_lock.acquire(blocking=False):
            return
        self._set_gate()
        self._thread = threading.Thread(
            target=self._run_guarded,
            args=(None,),
            name="aura-storage-recovery",
            daemon=True,
        )
        self._thread.start()

    def _run_guarded(self, operation_id: str | None) -> None:
        try:
            migration = storage_state_store.read().get("migration")
            if not migration:
                return
            if operation_id and migration.get("operation_id") != operation_id:
                raise StorageMigrationError("The persisted migration operation changed unexpectedly.")
            self._wait_for_quiescence()
            self._revalidate_quiesced(migration)
            if migration.get("copy_mode") == "rename":
                self._run_same_device(migration)
            else:
                self._run_cross_device(migration)
        except Exception as exc:
            logger.exception("storage migration/recovery failed")
            self._record_failure(exc)
        finally:
            if self._migration_lock.locked():
                self._migration_lock.release()

    def _run_same_device(self, migration: dict[str, Any]) -> None:
        old = Path(migration["old_root"])
        target = Path(migration["target_root"])
        pointer = Path(storage_state_store.read()["data_root"])

        # A crash can leave the directory moved while the pointer is still old.
        if not old.exists() and target.exists() and pointer.resolve(strict=False) == old.resolve(strict=False):
            self._sqlite_quick_check(target / "aura.db")
            migration["phase"] = "switched"
            storage_state_store.switch_root(target, migration=migration)
        elif old.exists() and not target.exists():
            # target was removed immediately before rename
            pass
        elif old.exists() and target.exists():
            if any(target.iterdir()):
                raise StorageMigrationError("Both old and target roots contain data; automatic recovery is blocked.")
            target.rmdir()
        elif not target.exists():
            raise StorageMigrationError("Neither the old nor target storage root exists; automatic recovery is blocked.")

        if old.exists():
            self._phase(migration, "prepared", "Checkpointing SQLite and closing storage handles…")
            engine_manager.checkpoint()
            engine_manager.dispose()
            close_storage_log_handlers()
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists():
                target.rmdir()
            old.rename(target)
            migration["root_moved"] = True
            storage_state_store.set_migration(migration)
            try:
                self._sqlite_quick_check(target / "aura.db")
                self._phase(migration, "switched", "Binding Aura to the new data location…", root=target)
            except Exception:
                if target.exists() and not old.exists():
                    target.rename(old)
                storage_state_store.switch_root(old, migration=migration)
                storage_manager.refresh()
                engine_manager.bind(old / "aura.db")
                reconfigure_storage_logging()
                raise

        try:
            storage_manager.refresh().ensure()
            engine_manager.bind(target / "aura.db")
            reconfigure_storage_logging()
            self._verify_switched(target)
        except Exception:
            engine_manager.dispose()
            close_storage_log_handlers()
            if target.exists() and not old.exists():
                target.rename(old)
            storage_state_store.switch_root(old, migration=migration)
            storage_manager.refresh().ensure()
            engine_manager.bind(old / "aura.db")
            reconfigure_storage_logging()
            raise
        self._finish(migration)

    def _run_cross_device(self, migration: dict[str, Any]) -> None:
        old = Path(migration["old_root"])
        target = Path(migration["target_root"])
        phase = migration.get("phase")
        if phase in {"switched", "cleanup"}:
            self._resume_cleanup(migration)
            return
        engine_manager.checkpoint()
        engine_manager.dispose()
        close_storage_log_handlers()
        files_total, bytes_total = self._tree_totals(old)
        migration["files_total"] = files_total
        migration["bytes_total"] = bytes_total
        storage_state_store.set_migration(migration)
        if phase == "copy_verified":
            self._verify_copy_manifest(migration)
        else:
            self._phase(migration, "copying", "Copying and hashing managed data…")
            self._copy_tree(old, target, migration)
            self._verify_copy_manifest(migration)
            self._sqlite_quick_check(target / "aura.db")
            self._phase(migration, "copy_verified", "Copy verified. Switching data location…")

        try:
            self._phase(migration, "switched", "Binding Aura to the verified copy…", root=target)
            storage_manager.refresh().ensure()
            engine_manager.bind(target / "aura.db")
            reconfigure_storage_logging()
            self._verify_switched(target)
        except Exception:
            storage_state_store.switch_root(old, migration=migration)
            storage_manager.refresh()
            engine_manager.bind(old / "aura.db")
            reconfigure_storage_logging()
            raise

        self._phase(migration, "cleanup", "Removing the verified obsolete source…")
        try:
            shutil.rmtree(old)
        except OSError as exc:
            migration["cleanup_warning"] = f"Aura is using the new root, but the old copy could not be removed: {exc}"
            storage_state_store.set_migration(migration)
            logger.warning(migration["cleanup_warning"])
            self._unlock(keep_migration=True)
            return
        self._finish(migration)

    def _resume_cleanup(self, migration: dict[str, Any]) -> None:
        target = Path(migration["target_root"])
        old = Path(migration["old_root"])
        storage_state_store.switch_root(target, migration=migration)
        storage_manager.refresh().ensure()
        engine_manager.bind(target / "aura.db")
        reconfigure_storage_logging()
        self._verify_switched(target)
        if old.exists():
            try:
                shutil.rmtree(old)
            except OSError as exc:
                migration["phase"] = "cleanup"
                migration["cleanup_warning"] = str(exc)
                storage_state_store.set_migration(migration)
                self._unlock(keep_migration=True)
                return
        self._finish(migration)

    def _copy_tree(self, source: Path, target: Path, migration: dict[str, Any]) -> None:
        target.mkdir(parents=True, exist_ok=True)
        for partial in target.rglob(".*.aura-copy"):
            partial.unlink(missing_ok=True)
        manifest: list[dict[str, Any]] = []
        files = sorted(path for path in source.rglob("*") if path.is_file())
        processed_bytes = 0
        for index, source_file in enumerate(files, start=1):
            relative = source_file.relative_to(source).as_posix()
            destination = target.joinpath(*relative.split("/"))
            destination.parent.mkdir(parents=True, exist_ok=True)
            source_hash = self._sha256(source_file)
            if not destination.is_file() or destination.stat().st_size != source_file.stat().st_size or self._sha256(destination) != source_hash:
                temp = destination.with_name(f".{destination.name}.aura-copy")
                shutil.copy2(source_file, temp)
                os.replace(temp, destination)
            size = source_file.stat().st_size
            manifest.append({"name": relative, "size": size, "sha256": source_hash})
            processed_bytes += size
            migration["files_processed"] = index
            migration["bytes_processed"] = processed_bytes
            migration["manifest"] = manifest
            if index % 10 == 0 or index == len(files):
                storage_state_store.set_migration(migration)

    def _verify_copy_manifest(self, migration: dict[str, Any]) -> None:
        source = Path(migration["old_root"])
        target = Path(migration["target_root"])
        manifest = migration.get("manifest") or []
        if len(manifest) != int(migration.get("files_total") or -1):
            raise StorageMigrationError("Copy manifest file count does not match the source.")
        source_files = [path for path in source.rglob("*") if path.is_file()]
        target_files = [path for path in target.rglob("*") if path.is_file()]
        if len(source_files) != len(manifest) or len(target_files) != len(manifest):
            raise StorageMigrationError("Copy verification file counts do not match.")
        source_total = target_total = 0
        for entry in manifest:
            relative = entry["name"]
            source_file = source.joinpath(*relative.split("/"))
            target_file = target.joinpath(*relative.split("/"))
            if not source_file.is_file() or not target_file.is_file():
                raise StorageMigrationError(f"Copy verification is missing {relative}.")
            expected = entry["sha256"]
            if self._sha256(source_file) != expected or self._sha256(target_file) != expected:
                raise StorageMigrationError(f"Copy verification failed for {relative}.")
            source_total += source_file.stat().st_size
            target_total += target_file.stat().st_size
        if source_total != target_total or source_total != int(migration.get("bytes_total") or -1):
            raise StorageMigrationError("Copy verification byte totals do not match.")

    def _verify_switched(self, root: Path) -> None:
        engine_manager.quick_check()
        for directory in (
            storage_manager.paths.music,
            storage_manager.paths.download_jobs,
            storage_manager.paths.artwork_cache,
            storage_manager.paths.lyrics_cache,
            storage_manager.paths.stream_cache,
            storage_manager.paths.logs,
        ):
            directory.mkdir(parents=True, exist_ok=True)
            probe = directory / f".aura-verify-{uuid.uuid4().hex}"
            probe.write_bytes(b"ok")
            probe.unlink()
        with SessionLocal() as session:
            values = list(session.scalars(select(Song.relative_path).where(Song.relative_path.is_not(None)).order_by(Song.id)))
            values += list(session.scalars(select(LibraryTrack.relative_path).where(LibraryTrack.relative_path.is_not(None)).order_by(LibraryTrack.id)))
        if values:
            sample_indices = {0, len(values) - 1}
            if len(values) > 2:
                for index in range(min(100, len(values))):
                    sample_indices.add(round(index * (len(values) - 1) / max(1, min(100, len(values)) - 1)))
            for index in sorted(sample_indices):
                path = storage_manager.paths.music_file(values[index])
                if not path.is_file():
                    raise StorageMigrationError(f"Track verification failed for {values[index]}.")

    def _phase(self, migration: dict[str, Any], phase: str, message: str, *, root: Path | None = None) -> None:
        migration["phase"] = phase
        migration["message"] = message
        migration["error"] = None
        if root is None:
            storage_state_store.set_migration(migration)
        else:
            storage_state_store.switch_root(root, migration=migration)
        logger.info("storage migration %s phase=%s", migration.get("operation_id"), phase)

    def _finish(self, migration: dict[str, Any]) -> None:
        logger.info("storage migration %s completed", migration.get("operation_id"))
        storage_state_store.set_migration(None)
        self._unlock()

    def _unlock(self, *, keep_migration: bool = False) -> None:
        self.cancel_work.clear()
        self.stop_claiming.clear()
        self.gated.clear()
        with self._activity:
            self._activity.notify_all()

    def _record_failure(self, exc: Exception) -> None:
        state = storage_state_store.read()
        migration = state.get("migration") or {}
        message = str(exc)
        migration["error"] = message
        migration["message"] = "Storage migration needs attention."
        migration["phase"] = "blocked" if "blocked" in message.casefold() or "neither" in message.casefold() else "failed"
        storage_state_store.set_migration(migration)
        try:
            canonical = Path(state["data_root"])
            if (canonical / "aura.db").is_file():
                storage_manager.refresh()
                engine_manager.bind(canonical / "aura.db")
                reconfigure_storage_logging()
        except Exception:
            logger.exception("failed to restore canonical database after migration error")
        if migration["phase"] == "blocked":
            self._set_gate()
        else:
            self._unlock(keep_migration=True)

    def _set_gate(self) -> None:
        self.gated.set()
        self.stop_claiming.set()
        self.cancel_work.set()

    def _wait_for_quiescence(self) -> None:
        with self._activity:
            while self._active_readers or self._active_writers or self._active_streams:
                self._activity.wait(timeout=0.5)

    def _revalidate_quiesced(self, migration: dict[str, Any]) -> None:
        old = Path(migration["old_root"])
        target = Path(migration["target_root"])
        if migration.get("copy_mode") == "rename" and not old.exists() and target.exists():
            return
        if migration.get("copy_mode") == "rename" and old.exists() and not target.exists():
            target.mkdir(parents=False)
        if migration.get("phase") in {"copy_verified", "switched", "cleanup"} and target.exists():
            return
        if migration.get("copy_mode") == "copy" and migration.get("phase") in {"copying", "failed"} and target.exists():
            return
        validation = self.validate_target(target)
        if validation["bytes_total"] != migration["bytes_total"] or validation["files_total"] != migration["files_total"]:
            migration.update(bytes_total=validation["bytes_total"], files_total=validation["files_total"])
            storage_state_store.set_migration(migration)
        if not old.exists():
            raise StorageMigrationError("The source root disappeared before migration started.")

    def issue_directory(self, path: Path) -> str:
        token = uuid.uuid4().hex
        with self._state_lock:
            self._directory_grants[token] = DirectoryGrant(path.absolute(), time.monotonic() + 300)
        return token

    def resolve_directory(self, token: str) -> Path:
        with self._state_lock:
            grant = self._directory_grants.get(token)
            if not grant or grant.expires_at < time.monotonic():
                self._directory_grants.pop(token, None)
                raise StorageMigrationError("This directory selection expired. Browse to it again.")
            return grant.path

    @staticmethod
    def filesystem_roots() -> list[Path]:
        if os.name == "nt":
            roots = [Path(f"{letter}:\\") for letter in "ABCDEFGHIJKLMNOPQRSTUVWXYZ"]
            return [root for root in roots if root.exists()]
        return [Path("/")]

    @staticmethod
    def _tree_totals(root: Path) -> tuple[int, int]:
        files = 0
        size = 0
        for directory, _subdirs, names in os.walk(root):
            for name in names:
                try:
                    size += (Path(directory) / name).stat().st_size
                    files += 1
                except OSError:
                    continue
        return files, size

    @staticmethod
    def _sha256(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    @staticmethod
    def _sqlite_quick_check(database: Path) -> None:
        if not database.is_file():
            raise StorageMigrationError(f"Aura database is missing: {database}")
        with sqlite3.connect(f"file:{database.as_posix()}?mode=ro", uri=True) as connection:
            result = connection.execute("PRAGMA quick_check").fetchone()
        if not result or str(result[0]).casefold() != "ok":
            raise StorageMigrationError(f"SQLite quick_check failed for {database}: {result}")


storage_coordinator = StorageCoordinator()
