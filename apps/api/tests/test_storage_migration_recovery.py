from __future__ import annotations

import copy
import sqlite3
from pathlib import Path

import pytest

import app.storage.coordinator as coordinator_module
from app.storage.coordinator import StorageCoordinator, StorageMigrationError
from app.storage.paths import StoragePaths


class FakeStateStore:
    def __init__(self, root: Path, migration: dict | None = None) -> None:
        self.state = {
            "schema_version": 1,
            "data_root": str(root.resolve()),
            "migration": copy.deepcopy(migration),
        }

    def read(self) -> dict:
        return copy.deepcopy(self.state)

    def set_migration(self, migration: dict | None) -> dict:
        self.state["migration"] = copy.deepcopy(migration)
        return self.read()

    def switch_root(self, root: Path, *, migration: dict | None = None) -> dict:
        self.state["data_root"] = str(root.resolve())
        self.state["migration"] = copy.deepcopy(migration)
        return self.read()


class FakeStorageManager:
    def __init__(self, state_store: FakeStateStore) -> None:
        self.state_store = state_store

    @property
    def paths(self) -> StoragePaths:
        return StoragePaths(Path(self.state_store.read()["data_root"]))

    def refresh(self) -> StoragePaths:
        return self.paths


class FakeEngineManager:
    managed = True

    def __init__(self) -> None:
        self.bound: list[Path] = []

    def checkpoint(self) -> None:
        return None

    def dispose(self) -> None:
        return None

    def bind(self, database: Path) -> None:
        self.bound.append(Path(database))

    def quick_check(self) -> None:
        return None


def valid_database(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    try:
        connection.execute("CREATE TABLE IF NOT EXISTS marker (id INTEGER PRIMARY KEY)")
        connection.commit()
    finally:
        connection.close()


def migration_for(old: Path, target: Path, *, mode: str, phase: str) -> dict:
    files, size = StorageCoordinator._tree_totals(old)
    return {
        "operation_id": "test-operation",
        "phase": phase,
        "message": "testing",
        "old_root": str(old),
        "target_root": str(target),
        "temporary_root": None,
        "copy_mode": mode,
        "files_processed": 0,
        "files_total": files,
        "bytes_processed": 0,
        "bytes_total": size,
        "manifest": [],
        "error": None,
        "cleanup_warning": None,
        "started_at": 1.0,
    }


@pytest.fixture
def isolated_coordinator(monkeypatch):
    def build(root: Path, migration: dict | None = None):
        state = FakeStateStore(root, migration)
        manager = FakeStorageManager(state)
        engine = FakeEngineManager()
        monkeypatch.setattr(coordinator_module, "storage_state_store", state)
        monkeypatch.setattr(coordinator_module, "storage_manager", manager)
        monkeypatch.setattr(coordinator_module, "engine_manager", engine)
        monkeypatch.setattr(coordinator_module, "close_storage_log_handlers", lambda: None)
        monkeypatch.setattr(coordinator_module, "reconfigure_storage_logging", lambda: None)
        return StorageCoordinator(), state, manager, engine

    return build


def test_same_device_move_switches_only_after_database_verification(tmp_path, isolated_coordinator, monkeypatch) -> None:
    old = tmp_path / "old"
    target = tmp_path / "target"
    valid_database(old / "aura.db")
    (old / "music").mkdir()
    (old / "music" / "song.mp3").write_bytes(b"audio")
    target.mkdir()
    migration = migration_for(old, target, mode="rename", phase="prepared")
    coordinator, state, _, _ = isolated_coordinator(old, migration)
    monkeypatch.setattr(coordinator, "_verify_switched", lambda _root: None)

    coordinator._run_same_device(migration)

    assert not old.exists()
    assert (target / "music" / "song.mp3").read_bytes() == b"audio"
    assert Path(state.read()["data_root"]) == target.resolve()
    assert state.read()["migration"] is None


def test_same_device_restart_recovers_move_before_pointer_switch(tmp_path, isolated_coordinator, monkeypatch) -> None:
    old = tmp_path / "old"
    target = tmp_path / "target"
    valid_database(target / "aura.db")
    migration = migration_for(target, old, mode="rename", phase="prepared")
    migration["old_root"] = str(old)
    migration["target_root"] = str(target)
    coordinator, state, _, _ = isolated_coordinator(old, migration)
    monkeypatch.setattr(coordinator, "_verify_switched", lambda _root: None)

    coordinator._run_same_device(migration)

    assert Path(state.read()["data_root"]) == target.resolve()
    assert state.read()["migration"] is None


def test_cross_device_copy_is_fully_verified_before_source_cleanup(tmp_path, isolated_coordinator, monkeypatch) -> None:
    old = tmp_path / "old"
    target = tmp_path / "target"
    valid_database(old / "aura.db")
    (old / "music").mkdir()
    (old / "music" / "song.mp3").write_bytes(b"audio")
    migration = migration_for(old, target, mode="copy", phase="copying")
    coordinator, state, _, _ = isolated_coordinator(old, migration)
    monkeypatch.setattr(coordinator, "_verify_switched", lambda _root: None)
    verified = False
    original_verify = coordinator._verify_copy_manifest
    original_rmtree = coordinator_module.shutil.rmtree

    def verify(current: dict) -> None:
        nonlocal verified
        original_verify(current)
        verified = True

    def guarded_cleanup(path: Path) -> None:
        assert verified, "source cleanup ran before full manifest verification"
        original_rmtree(path)

    monkeypatch.setattr(coordinator, "_verify_copy_manifest", verify)
    monkeypatch.setattr(coordinator_module.shutil, "rmtree", guarded_cleanup)

    coordinator._run_cross_device(migration)

    assert not old.exists()
    assert (target / "music" / "song.mp3").read_bytes() == b"audio"
    assert Path(state.read()["data_root"]) == target.resolve()


def test_failed_copy_verification_retains_source(tmp_path, isolated_coordinator, monkeypatch) -> None:
    old = tmp_path / "old"
    target = tmp_path / "target"
    valid_database(old / "aura.db")
    (old / "music").mkdir()
    (old / "music" / "song.mp3").write_bytes(b"audio")
    migration = migration_for(old, target, mode="copy", phase="copying")
    coordinator, state, _, _ = isolated_coordinator(old, migration)
    monkeypatch.setattr(
        coordinator,
        "_verify_copy_manifest",
        lambda _migration: (_ for _ in ()).throw(StorageMigrationError("verification failed")),
    )

    with pytest.raises(StorageMigrationError, match="verification failed"):
        coordinator._run_cross_device(migration)

    assert (old / "music" / "song.mp3").is_file()
    assert Path(state.read()["data_root"]) == old.resolve()


def test_failed_cleanup_keeps_recovery_state_and_both_copies(tmp_path, isolated_coordinator, monkeypatch) -> None:
    old = tmp_path / "old"
    target = tmp_path / "target"
    valid_database(old / "aura.db")
    (old / "music").mkdir()
    (old / "music" / "song.mp3").write_bytes(b"audio")
    migration = migration_for(old, target, mode="copy", phase="copying")
    coordinator, state, _, _ = isolated_coordinator(old, migration)
    monkeypatch.setattr(coordinator, "_verify_switched", lambda _root: None)
    monkeypatch.setattr(
        coordinator_module.shutil,
        "rmtree",
        lambda _path: (_ for _ in ()).throw(OSError("locked")),
    )

    coordinator._run_cross_device(migration)

    persisted = state.read()
    assert Path(persisted["data_root"]) == target.resolve()
    assert persisted["migration"]["phase"] == "cleanup"
    assert "locked" in persisted["migration"]["cleanup_warning"]
    assert old.is_dir() and target.is_dir()


def test_manifest_verification_rejects_tampering_and_extra_files(tmp_path, isolated_coordinator) -> None:
    old = tmp_path / "old"
    target = tmp_path / "target"
    valid_database(old / "aura.db")
    (old / "music").mkdir()
    (old / "music" / "song.mp3").write_bytes(b"audio")
    migration = migration_for(old, target, mode="copy", phase="copying")
    coordinator, _, _, _ = isolated_coordinator(old, migration)
    coordinator._copy_tree(old, target, migration)
    coordinator._verify_copy_manifest(migration)

    (target / "music" / "song.mp3").write_bytes(b"tampered")
    with pytest.raises(StorageMigrationError, match="failed"):
        coordinator._verify_copy_manifest(migration)

    (target / "music" / "song.mp3").write_bytes(b"audio")
    (target / "extra").write_bytes(b"unexpected")
    with pytest.raises(StorageMigrationError, match="counts"):
        coordinator._verify_copy_manifest(migration)


def test_validation_rejects_nonempty_overlap_and_source_symlinks(tmp_path, isolated_coordinator) -> None:
    old = tmp_path / "old"
    valid_database(old / "aura.db")
    coordinator, _, _, _ = isolated_coordinator(old)

    nonempty = tmp_path / "nonempty"
    nonempty.mkdir()
    (nonempty / "file").write_text("x", encoding="utf-8")
    with pytest.raises(StorageMigrationError, match="empty"):
        coordinator.validate_target(nonempty)

    child = old / "child"
    child.mkdir()
    with pytest.raises(StorageMigrationError, match="parent/child"):
        coordinator.validate_target(child)

    child.rmdir()
    external = tmp_path / "external"
    external.write_text("x", encoding="utf-8")
    link = old / "linked"
    try:
        link.symlink_to(external)
    except OSError:
        pytest.skip("symbolic links are unavailable in this test environment")
    destination = tmp_path / "destination"
    destination.mkdir()
    with pytest.raises(StorageMigrationError, match="symbolic links"):
        coordinator.validate_target(destination)


def test_corrupt_sqlite_and_concurrent_migrations_are_rejected(tmp_path, isolated_coordinator) -> None:
    corrupt = tmp_path / "broken.db"
    corrupt.write_bytes(b"not sqlite")
    with pytest.raises((StorageMigrationError, sqlite3.DatabaseError)):
        StorageCoordinator._sqlite_quick_check(corrupt)

    old = tmp_path / "old"
    destination = tmp_path / "destination"
    valid_database(old / "aura.db")
    destination.mkdir()
    coordinator, _, _, _ = isolated_coordinator(old)
    coordinator._migration_lock.acquire()
    try:
        with pytest.raises(StorageMigrationError, match="already active"):
            coordinator.start_migration(destination)
    finally:
        coordinator._migration_lock.release()


def test_switched_verification_checks_every_referenced_track(tmp_path, isolated_coordinator, monkeypatch) -> None:
    old = tmp_path / "old"
    valid_database(old / "aura.db")
    paths = StoragePaths(old)
    paths.ensure()
    values = [f"track-{index}.mp3" for index in range(150)]
    for value in values[:-1]:
        (paths.music / value).write_bytes(b"audio")
    coordinator, _, _, engine = isolated_coordinator(old)

    class FakeSession:
        calls = 0

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def scalars(self, _query):
            self.calls += 1
            return values if self.calls == 1 else []

    session = FakeSession()
    monkeypatch.setattr(coordinator_module, "SessionLocal", lambda: session)

    with pytest.raises(StorageMigrationError, match="track-149"):
        coordinator._verify_switched(old)

    assert engine is not None


def test_activity_guards_stream_tracking_and_status(tmp_path, isolated_coordinator) -> None:
    root = tmp_path / "root"
    valid_database(root / "aura.db")
    coordinator, state, _, _ = isolated_coordinator(root)

    assert coordinator.migration_active is False
    assert coordinator.status()["phase"] == "idle"
    with coordinator.filesystem_read():
        assert coordinator._active_readers == 1
    with coordinator.filesystem_write():
        assert coordinator._active_writers == 1
    coordinator.stream_opened()
    assert coordinator._active_streams == 1
    coordinator.stream_closed()
    coordinator.stream_closed()
    assert coordinator._active_streams == 0

    migration = migration_for(root, tmp_path / "target", mode="copy", phase="copying")
    migration.update(bytes_processed=5, bytes_total=10)
    state.set_migration(migration)
    assert coordinator.migration_active is True
    status = coordinator.status()
    assert status["active"] is True
    assert status["percent"] == 50

    coordinator._set_gate()
    with pytest.raises(StorageMigrationError, match="in progress"):
        with coordinator.filesystem_read():
            pass
    with pytest.raises(StorageMigrationError, match="in progress"):
        with coordinator.filesystem_write():
            pass
    coordinator._unlock()


def test_successful_validation_and_migration_start_checkpoint(tmp_path, isolated_coordinator, monkeypatch) -> None:
    root = tmp_path / "root"
    destination = tmp_path / "destination"
    valid_database(root / "aura.db")
    (root / "music").mkdir()
    (root / "music" / "song.mp3").write_bytes(b"audio")
    destination.mkdir()
    coordinator, state, _, _ = isolated_coordinator(root)
    started: list[str] = []

    class FakeThread:
        def __init__(self, *, target, args, name: str, daemon: bool) -> None:
            assert target == coordinator._run_guarded and daemon is True
            self.args = args
            self.name = name

        def start(self) -> None:
            started.append(self.name)

    monkeypatch.setattr(coordinator_module.threading, "Thread", FakeThread)
    validation = coordinator.validate_target(destination)
    operation_id = coordinator.start_migration(destination)

    persisted = state.read()["migration"]
    assert validation["files_total"] == 2
    assert validation["bytes_total"] > 0
    assert operation_id == persisted["operation_id"]
    assert persisted["copy_mode"] == "rename"
    assert coordinator.gated.is_set()
    assert len(started) == 1
    coordinator._migration_lock.release()
    coordinator._unlock()


def test_recover_and_guarded_dispatch_use_persisted_mode(tmp_path, isolated_coordinator, monkeypatch) -> None:
    root = tmp_path / "root"
    target = tmp_path / "target"
    valid_database(root / "aura.db")
    migration = migration_for(root, target, mode="copy", phase="copying")
    coordinator, _, _, _ = isolated_coordinator(root, migration)
    started: list[tuple] = []

    class FakeThread:
        def __init__(self, *, target, args, name: str, daemon: bool) -> None:
            started.append((target, args, name, daemon))

        def start(self) -> None:
            return None

    monkeypatch.setattr(coordinator_module.threading, "Thread", FakeThread)
    coordinator.recover()
    assert started[0][1] == (None,)
    coordinator._migration_lock.release()

    calls: list[str] = []
    monkeypatch.setattr(coordinator, "_wait_for_quiescence", lambda: calls.append("wait"))
    monkeypatch.setattr(coordinator, "_revalidate_quiesced", lambda _migration: calls.append("validate"))
    monkeypatch.setattr(coordinator, "_run_cross_device", lambda _migration: calls.append("copy"))
    coordinator._migration_lock.acquire()
    coordinator._run_guarded("test-operation")
    assert calls == ["wait", "validate", "copy"]
    assert not coordinator._migration_lock.locked()


def test_resume_cleanup_and_failure_recording_retain_recovery_information(
    tmp_path, isolated_coordinator, monkeypatch
) -> None:
    old = tmp_path / "old"
    target = tmp_path / "target"
    valid_database(old / "aura.db")
    valid_database(target / "aura.db")
    migration = migration_for(old, target, mode="copy", phase="cleanup")
    coordinator, state, _, _ = isolated_coordinator(target, migration)
    monkeypatch.setattr(coordinator, "_verify_switched", lambda _root: None)
    coordinator._resume_cleanup(migration)
    assert not old.exists()
    assert state.read()["migration"] is None

    failed = migration_for(target, tmp_path / "another", mode="copy", phase="copying")
    state.set_migration(failed)
    coordinator._record_failure(RuntimeError("verification failed"))
    assert state.read()["migration"]["phase"] == "failed"
    assert not coordinator.gated.is_set()

    state.set_migration(failed)
    coordinator._record_failure(RuntimeError("automatic recovery is blocked"))
    assert state.read()["migration"]["phase"] == "blocked"
    assert coordinator.gated.is_set()
    coordinator._unlock()


def test_directory_grants_expire_and_filesystem_roots_are_real(tmp_path, isolated_coordinator, monkeypatch) -> None:
    root = tmp_path / "root"
    valid_database(root / "aura.db")
    selected = tmp_path / "selected"
    selected.mkdir()
    coordinator, _, _, _ = isolated_coordinator(root)

    token = coordinator.issue_directory(selected)
    assert coordinator.resolve_directory(token) == selected.absolute()
    monkeypatch.setattr(coordinator_module.time, "monotonic", lambda: float("inf"))
    with pytest.raises(StorageMigrationError, match="expired"):
        coordinator.resolve_directory(token)

    assert all(path.exists() for path in coordinator.filesystem_roots())
