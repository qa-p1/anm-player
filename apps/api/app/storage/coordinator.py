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

from app.core.config import REPOSITORY_ROOT, settings
from app.core.logging import close_storage_log_handlers, reconfigure_storage_logging
from app.database.session import SessionLocal, engine_manager
from app.models import LibraryTrack, Song
from app.storage import storage_manager, storage_state_store

logger = logging.getLogger(__name__)

RESET_MANAGED_DIRECTORIES = ("music", "downloads", "cache", "config", "thumbnails", "logs")
RESET_MANAGED_FILES = ("aura.db", "aura.db-wal", "aura.db-shm", "aura.db-journal")


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
        state = storage_state_store.read()
        migration = state.get("migration")
        if not migration:
            last_operation = state.get("last_operation") or {}
            return {
                "active": False,
                "phase": "idle",
                "message": last_operation.get("message", "Storage is ready."),
                "operation_kind": last_operation.get("operation_kind", "migration"),
                "files_processed": 0,
                "files_total": 0,
                "bytes_processed": 0,
                "bytes_total": 0,
                "percent": 100,
                "error": last_operation.get("error"),
                "cleanup_warning": last_operation.get("cleanup_warning"),
            }
        # This status is returned by the global storage gate before route
        # authentication runs. Keep recovery-only fields such as physical
        # roots, manifests, and operation identifiers inside the state file.
        public_fields = {
            "operation_kind",
            "phase",
            "message",
            "files_processed",
            "files_total",
            "bytes_processed",
            "bytes_total",
            "error",
            "cleanup_warning",
        }
        result = {key: migration.get(key) for key in public_fields}
        total = int(result.get("bytes_total") or 0)
        processed = int(result.get("bytes_processed") or 0)
        result["active"] = result.get("phase") not in {"blocked", "failed"} and not result.get("cleanup_warning")
        if total:
            result["percent"] = min(100, round(processed * 100 / total, 1))
        elif result.get("operation_kind") == "reset":
            result["percent"] = {
                "prepared": 10,
                "initializing": 45,
                "verifying": 75,
                "switched": 90,
                "cleanup": 95,
            }.get(str(result.get("phase")), 0)
        else:
            result["percent"] = 0
        return result

    def _validate_empty_target(self, target: str | Path) -> tuple[Path, Path]:
        old = storage_manager.paths.root.resolve()
        if not old.is_dir():
            raise StorageMigrationError("The current data root is unavailable.")
        self._assert_no_symlinks(old)
        selected_path = Path(target).expanduser().absolute()
        if any(part.is_symlink() for part in (selected_path, *selected_path.parents) if part.exists()):
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
        return old, target_path

    def validate_target(self, target: str | Path) -> dict[str, Any]:
        old, target_path = self._validate_empty_target(target)

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
                "operation_kind": "migration",
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

    def start_reset(self, target: str | Path) -> str:
        if not self._migration_lock.acquire(blocking=False):
            raise StorageMigrationError("Another storage operation is already active.")
        try:
            if storage_state_store.read().get("migration"):
                raise StorageMigrationError("Storage recovery or another operation is already active.")
            old, target_path = self._validate_empty_target(target)
            self._assert_safe_reset_source(old, target_path)
            operation_id = uuid.uuid4().hex
            operation = {
                "operation_id": operation_id,
                "operation_kind": "reset",
                "phase": "prepared",
                "message": "Preparing a clean Aura data location…",
                "old_root": str(old),
                "target_root": str(target_path),
                "temporary_root": None,
                "copy_mode": "reset",
                "files_processed": 0,
                "files_total": 0,
                "bytes_processed": 0,
                "bytes_total": 0,
                "manifest": [],
                "error": None,
                "cleanup_warning": None,
                "started_at": time.time(),
            }
            storage_state_store.set_migration(operation)
            self._set_gate()
            self._thread = threading.Thread(
                target=self._run_guarded,
                args=(operation_id,),
                name=f"aura-storage-reset-{operation_id[:8]}",
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
            if migration.get("operation_kind") == "reset":
                self._run_reset(migration)
                return
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

    def _run_reset(self, operation: dict[str, Any]) -> None:
        old = Path(operation["old_root"]).absolute()
        target = Path(operation["target_root"]).absolute()
        self._assert_safe_reset_source(old, target)

        if operation.get("phase") in {"switched", "cleanup"}:
            self._resume_reset_cleanup(operation, old, target)
            return

        try:
            self._restore_reset_source(old)
            self._prepare_reset_target(operation, target)
            self._phase(operation, "initializing", "Creating a fresh database and storage layout…")
            engine_manager.checkpoint()
            engine_manager.dispose()
            close_storage_log_handlers()
            storage_state_store.switch_root(target, migration=operation)
            storage_manager.refresh().ensure()
            engine_manager.bind(target / "aura.db")
            self._upgrade_database()
            self._phase(operation, "verifying", "Verifying the clean database and writable storage…")
            self._verify_switched(target)
            operation["phase"] = "switched"
            operation["message"] = "Fresh storage verified. Removing the previous Aura data…"
            storage_state_store.switch_root(target, migration=operation)
            self._reset_marker(operation, target).unlink(missing_ok=True)
            reconfigure_storage_logging()
        except Exception:
            close_storage_log_handlers()
            engine_manager.dispose()
            self._restore_reset_source(old)
            raise

        self._remove_reset_source(operation, old, target)

    def _resume_reset_cleanup(self, operation: dict[str, Any], old: Path, target: Path) -> None:
        if not target.is_dir() or not (target / "aura.db").is_file():
            raise StorageMigrationError("The verified fresh data root is unavailable; automatic reset recovery is blocked.")
        storage_state_store.switch_root(target, migration=operation)
        storage_manager.refresh().ensure()
        engine_manager.bind(target / "aura.db")
        self._sqlite_quick_check(target / "aura.db")
        self._reset_marker(operation, target).unlink(missing_ok=True)
        reconfigure_storage_logging()
        self._remove_reset_source(operation, old, target)

    def _remove_reset_source(self, operation: dict[str, Any], old: Path, target: Path) -> None:
        self._assert_safe_reset_source(old, target)
        self._phase(operation, "cleanup", "Removing the previous Aura database, music, artwork, and caches…")
        try:
            if old.exists():
                self._assert_no_symlinks(old)
                self._delete_reset_managed_data(old)
        except OSError as exc:
            operation["cleanup_warning"] = (
                "Aura is fresh and using the new location, but the previous data folder could not be fully removed."
            )
            storage_state_store.set_migration(operation)
            logger.warning("could not remove obsolete reset source %s: %s", old, exc)
            self._unlock()
            return
        self._finish(operation)

    @staticmethod
    def _delete_reset_managed_data(root: Path) -> None:
        """Delete Aura-owned entries without ever erasing unrelated sibling data."""
        for name in RESET_MANAGED_DIRECTORIES:
            managed_directory = root / name
            if managed_directory.exists():
                if not managed_directory.is_dir():
                    raise OSError(f"Expected managed storage entry {name!r} to be a directory")
                shutil.rmtree(managed_directory)

        for name in RESET_MANAGED_FILES:
            managed_file = root / name
            if managed_file.exists() and not managed_file.is_file():
                raise OSError(f"Expected managed storage entry {name!r} to be a file")
            managed_file.unlink(missing_ok=True)

        # Remove the old root only when Aura owned everything in it. If the
        # operator selected a broad directory in an older configuration, any
        # unrelated entries are deliberately left untouched.
        try:
            root.rmdir()
        except OSError:
            if not any(root.iterdir()):
                raise

    def _prepare_reset_target(self, operation: dict[str, Any], target: Path) -> None:
        marker = self._reset_marker(operation, target)
        if target.exists() and any(target.iterdir()):
            if not marker.is_file() or marker.read_text(encoding="utf-8").strip() != operation["operation_id"]:
                raise StorageMigrationError("The reset destination is no longer empty; automatic recovery is blocked.")
            self._assert_reset_target_disposable(target, marker)
            shutil.rmtree(target)
        target.mkdir(parents=False, exist_ok=True)
        marker.write_text(str(operation["operation_id"]), encoding="utf-8")

    def _restore_reset_source(self, old: Path) -> None:
        if not old.is_dir() or not (old / "aura.db").is_file():
            raise StorageMigrationError("The previous Aura data root is unavailable; automatic reset recovery is blocked.")
        current = storage_manager.paths.root.resolve()
        if current != old:
            close_storage_log_handlers()
            engine_manager.dispose()
            storage_state_store.switch_root(old, migration=storage_state_store.read().get("migration"))
        storage_manager.refresh().ensure()
        engine_manager.bind(old / "aura.db")
        reconfigure_storage_logging()

    @staticmethod
    def _reset_marker(operation: dict[str, Any], target: Path) -> Path:
        return target / f".aura-reset-{operation['operation_id']}"

    @staticmethod
    def _upgrade_database() -> None:
        from alembic import command
        from alembic.config import Config

        api_root = Path(__file__).resolve().parents[2]
        config = Config()
        config.set_main_option("script_location", str(api_root / "alembic"))
        config.set_main_option("prepend_sys_path", str(api_root))
        command.upgrade(config, "head")

    @classmethod
    def _assert_safe_reset_source(cls, old: Path, target: Path) -> None:
        if old.is_symlink() or target.is_symlink():
            raise StorageMigrationError("Reset storage roots may not be symbolic links.")
        old = old.resolve()
        target = target.resolve()
        protected = {
            Path(old.anchor).resolve(),
            Path.home().resolve(),
            REPOSITORY_ROOT.resolve(),
        }
        if old in protected:
            raise StorageMigrationError("The current data root is too broad to delete safely.")
        for path in (REPOSITORY_ROOT.resolve(), settings.aura_state_file.resolve()):
            if cls._contains(old, path):
                raise StorageMigrationError("The current data root contains protected Aura application files.")
        if cls._contains(old, target) or cls._contains(target, old):
            raise StorageMigrationError("The new data root cannot overlap the current data root.")

    @staticmethod
    def _contains(root: Path, candidate: Path) -> bool:
        root_key = os.path.normcase(str(root.resolve()))
        candidate_key = os.path.normcase(str(candidate.resolve(strict=False)))
        try:
            return os.path.commonpath([root_key, candidate_key]) == root_key
        except ValueError:
            return False

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
            migration["cleanup_warning"] = (
                "Aura is using the new root, but the previous data folder could not be fully removed."
            )
            storage_state_store.set_migration(migration)
            logger.warning("could not remove obsolete storage source %s: %s", old, exc)
            self._unlock()
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
                migration["cleanup_warning"] = (
                    "Aura is using the new root, but the previous data folder could not be fully removed."
                )
                storage_state_store.set_migration(migration)
                logger.warning("could not resume obsolete storage cleanup for %s: %s", old, exc)
                self._unlock()
                return
        self._finish(migration)

    def _copy_tree(self, source: Path, target: Path, migration: dict[str, Any]) -> None:
        self._assert_no_symlinks(source)
        if target.exists():
            self._assert_no_symlinks(target)
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
        self._assert_no_symlinks(source)
        self._assert_no_symlinks(target)
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
        for value in values:
            path = storage_manager.paths.music_file(value)
            if not path.is_file():
                raise StorageMigrationError(f"Track verification failed for {value}.")

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
        storage_state_store.update(
            migration=None,
            last_operation={
                "operation_kind": migration.get("operation_kind", "migration"),
                "completed_at": time.time(),
                "message": "Storage is ready.",
                "error": None,
                "cleanup_warning": None,
            },
        )
        self._unlock()

    def _unlock(self) -> None:
        self.cancel_work.clear()
        self.stop_claiming.clear()
        self.gated.clear()
        with self._activity:
            self._activity.notify_all()

    def _record_failure(self, exc: Exception) -> None:
        state = storage_state_store.read()
        migration = state.get("migration") or {}
        internal_message = str(exc)
        is_reset = migration.get("operation_kind") == "reset"
        migration["error"] = (
            "Fresh start could not be completed. Aura kept the previous verified data location."
            if is_reset
            else "The storage move could not be completed. Aura kept the last verified data location."
        )
        migration["message"] = "The storage operation needs attention."
        migration["phase"] = (
            "blocked"
            if "blocked" in internal_message.casefold() or "neither" in internal_message.casefold()
            else "failed"
        )
        canonical = Path(state["data_root"])
        can_abandon_reset = False
        if (
            is_reset
            and (canonical / "aura.db").is_file()
            and canonical.resolve(strict=False) == Path(migration.get("old_root", "")).resolve(strict=False)
        ):
            try:
                storage_manager.refresh().ensure()
                engine_manager.bind(canonical / "aura.db")
                engine_manager.quick_check()
                reconfigure_storage_logging()
                can_abandon_reset = True
            except Exception:
                logger.exception("failed to restore the previous database after fresh-start failure")
        if can_abandon_reset:
            try:
                self._discard_reset_target(migration)
            except (OSError, UnicodeError, StorageMigrationError):
                logger.warning("could not remove partial fresh-start target", exc_info=True)
            storage_state_store.update(
                migration=None,
                last_operation={
                    "operation_kind": "reset",
                    "failed_at": time.time(),
                    "message": migration["message"],
                    "error": migration["error"],
                    "cleanup_warning": None,
                },
            )
            self._unlock()
            return
        storage_state_store.set_migration(migration)
        try:
            if (canonical / "aura.db").is_file():
                storage_manager.refresh()
                engine_manager.bind(canonical / "aura.db")
                reconfigure_storage_logging()
        except Exception:
            logger.exception("failed to restore canonical database after migration error")
        if migration["phase"] == "blocked":
            self._set_gate()
        else:
            self._unlock()

    def _discard_reset_target(self, operation: dict[str, Any]) -> None:
        target = Path(operation["target_root"])
        marker = self._reset_marker(operation, target)
        if not marker.is_file():
            return
        if marker.read_text(encoding="utf-8").strip() != operation["operation_id"]:
            return
        self._assert_reset_target_disposable(target, marker)
        shutil.rmtree(target)
        target.mkdir(parents=False)

    @classmethod
    def _assert_reset_target_disposable(cls, target: Path, marker: Path) -> None:
        """Only permit cleanup of the exact reset layout Aura created."""
        cls._assert_no_symlinks(target)
        managed_names = {*RESET_MANAGED_DIRECTORIES, *RESET_MANAGED_FILES}
        unexpected = sorted(
            entry.name
            for entry in target.iterdir()
            if entry != marker and entry.name not in managed_names
        )
        if unexpected:
            logger.warning(
                "refusing to clear reset target %s because it contains unrelated entries: %s",
                target,
                unexpected,
            )
            raise StorageMigrationError(
                "The fresh-start destination now contains files Aura did not create; automatic recovery is blocked."
            )

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
            now = time.monotonic()
            self._directory_grants = {
                key: grant
                for key, grant in self._directory_grants.items()
                if grant.expires_at >= now
            }
            if len(self._directory_grants) >= 4096:
                oldest = min(
                    self._directory_grants,
                    key=lambda key: self._directory_grants[key].expires_at,
                )
                self._directory_grants.pop(oldest, None)
            self._directory_grants[token] = DirectoryGrant(path.absolute(), now + 300)
        return token

    def resolve_directory(self, token: str) -> Path:
        with self._state_lock:
            grant = self._directory_grants.get(token)
            if not grant or grant.expires_at < time.monotonic():
                self._directory_grants.pop(token, None)
                raise StorageMigrationError("This directory selection expired. Browse to it again.")
            return grant.path

    def consume_directory(self, token: str) -> Path:
        path = self.resolve_directory(token)
        with self._state_lock:
            self._directory_grants.pop(token, None)
        return path

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
    def _assert_no_symlinks(root: Path) -> None:
        if root.is_symlink():
            raise StorageMigrationError("Managed storage may not be a symbolic link.")
        for path in root.rglob("*"):
            if path.is_symlink():
                raise StorageMigrationError("Managed storage may not contain symbolic links.")

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
