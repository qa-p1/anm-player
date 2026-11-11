import importlib.util
import json
import sqlite3
import stat
import zipfile
from pathlib import Path

import pytest

SPEC = importlib.util.spec_from_file_location("native_updates", Path(__file__).resolve().parents[3] / "scripts/native_updates.py")
assert SPEC and SPEC.loader
updates = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(updates)
OLD = "a" * 40
NEW = "b" * 40


def source(root):
    for name, content in {"VERSION": "1.0.0", "scripts/start_aura.py": "pass", "package-lock.json": "{}", "apps/api/requirements.txt": ""}.items():
        p = root / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content)
    updates.write_json(root / ".aura/install.json", {"commit": OLD})


def manager(tmp_path, restart=lambda *_: None):
    root = tmp_path / "app"
    source(root)
    home = tmp_path / "home"
    return updates.NativeUpdater(root, home, {}, restart)


@pytest.mark.parametrize("member", ["../escape", "repo/../../escape", "/etc/escape", "repo/dir\\escape", "repo/C:/escape"])
def test_update_archive_cannot_write_outside_stage(tmp_path, member):
    archive = tmp_path / "source.zip"
    with zipfile.ZipFile(archive, "w") as z:
        z.writestr(member, "bad")
    with pytest.raises(updates.UpdateError):
        updates.extract_source(archive, tmp_path / "stage")
    assert not (tmp_path / "escape").exists()


def test_update_archive_rejects_symbolic_links(tmp_path):
    archive = tmp_path / "source.zip"
    with zipfile.ZipFile(archive, "w") as z:
        entry = zipfile.ZipInfo("repo/link")
        entry.external_attr = (stat.S_IFLNK | 0o777) << 16
        z.writestr(entry, "../../escape")
    with pytest.raises(updates.UpdateError, match="Links"):
        updates.extract_source(archive, tmp_path / "stage")


def test_source_archive_is_validated_before_use(tmp_path):
    archive = tmp_path / "source.zip"
    with zipfile.ZipFile(archive, "w") as z:
        for name in ["VERSION", "scripts/start_aura.py", "package-lock.json", "apps/api/requirements.txt"]:
            z.writestr("repo/" + name, "test")
    updates.extract_source(archive, tmp_path / "stage")
    assert (tmp_path / "stage/VERSION").read_text() == "test"


def test_user_data_paths_remain_absolute_after_source_switch(tmp_path):
    result = updates.durable_environment(tmp_path, {"AURA_DATA_ROOT": "my music", "AURA_STATE_FILE": ".aura/state.json", "API_ACCESS_TOKEN": "kept"})
    assert result["AURA_DATA_ROOT"] == str(tmp_path / "my music")
    assert result["AURA_STATE_FILE"] == str(tmp_path / ".aura/state.json")
    assert result["API_ACCESS_TOKEN"] == "kept"


def test_failed_install_keeps_the_current_source_and_pointer(tmp_path, monkeypatch):
    m = manager(tmp_path)
    updates.write_json(m.home / "current.json", {"root": str(m.root)})
    def broken(*_):
        raise updates.UpdateError("Download interrupted")
    monkeypatch.setattr(updates, "download_source", broken)
    m._work(NEW)
    assert m.status()["state"] == "error"
    assert updates.read_json(m.home / "current.json")["root"] == str(m.root)
    assert (m.root / "VERSION").read_text() == "1.0.0"


def test_successful_update_switches_only_after_restart_ready(tmp_path, monkeypatch):
    events = []
    m = manager(tmp_path, lambda candidate, env: events.append((candidate, env)))
    monkeypatch.setattr(updates, "download_source", lambda commit, root: source(root))
    monkeypatch.setattr(m, "_run", lambda *_, **__: None)
    monkeypatch.setattr(updates.shutil, "which", lambda _: "/tool/npm")
    m._work(NEW)
    assert m.status()["state"] == "completed"
    pointer = updates.read_json(m.home / "current.json")
    assert pointer["root"] == str(m.home / "releases" / NEW)
    assert pointer["previous_root"] == str(m.root)
    assert events[0][1]["AURA_DATA_ROOT"] == str(m.root / "data")


def test_build_failure_does_not_restart_or_touch_the_database(tmp_path, monkeypatch):
    events = []
    m = manager(tmp_path, lambda *_: events.append("restart"))
    monkeypatch.setattr(updates, "download_source", lambda commit, root: source(root))
    def failed(*_, **__):
        raise updates.UpdateError("Build failed")
    monkeypatch.setattr(m, "_run", failed)
    m._work(NEW)
    assert m.status()["state"] == "error"
    assert not events
    assert not (m.home / "current.json").exists()


def test_update_cannot_delete_its_running_source(tmp_path, monkeypatch):
    m = manager(tmp_path)
    candidate = m.home / "releases" / NEW
    source(candidate)
    updates.write_json(m.home / "current.json", {"root": str(candidate)})
    m._work(NEW)
    assert m.status()["state"] == "error"
    assert (candidate / "VERSION").is_file()


def test_check_detects_commit_changes_without_new_release(tmp_path, monkeypatch):
    m = manager(tmp_path)
    monkeypatch.setattr(updates, "github_head", lambda: {"commit": NEW, "summary": "Improve library"})
    m._work(None)
    assert m.status()["state"] == "available"
    monkeypatch.setattr(updates, "github_head", lambda: {"commit": OLD, "summary": "Current"})
    m._work(None)
    assert m.status()["state"] == "current"


def test_install_requires_a_checked_revision_and_rejects_duplicate_work(tmp_path):
    m = manager(tmp_path)
    with pytest.raises(updates.UpdateError, match="Check"):
        m.start(install=True)
    m.running = True
    with pytest.raises(updates.UpdateError, match="already"):
        m.start(install=False)


def test_backup_restores_a_migrated_database(tmp_path):
    database, backup = tmp_path / "aura.db", tmp_path / "backup.db"
    with sqlite3.connect(database) as db:
        db.execute("create table playlist(name text)")
        db.execute("insert into playlist values('My music')")
    updates.snapshot_database(database, backup)
    with sqlite3.connect(database) as db:
        db.execute("drop table playlist")
    updates.restore_database(backup, database)
    with sqlite3.connect(database) as db:
        assert db.execute("select name from playlist").fetchone() == ("My music",)


def test_storage_move_blocks_database_upgrade(tmp_path):
    state = tmp_path / "state.json"
    state.write_text(json.dumps({"data_root": str(tmp_path), "migration": {"phase": "copying"}}))
    with pytest.raises(updates.UpdateError, match="storage move"):
        updates.database_path({"AURA_STATE_FILE": str(state), "AURA_DATA_ROOT": str(tmp_path)})


def test_interrupted_update_recovers_on_next_launch(tmp_path):
    m = manager(tmp_path)
    m.set_state("installing", "Installing")
    fresh = updates.NativeUpdater(m.root, m.home, {}, lambda *_: None)
    assert fresh.status()["state"] == "error"
    assert "interrupted" in fresh.status()["message"]


def test_cleanup_keeps_active_previous_and_all_user_data(tmp_path):
    home = tmp_path / 'home'
    active, previous, obsolete = (home / 'releases' / (letter * 40) for letter in 'abc')
    for root, letter in ((active, 'a'), (previous, 'b'), (obsolete, 'c')):
        source(root)
        updates.write_json(root / '.aura/install.json', {'commit': letter * 40, 'managed': True})
        (root / 'node_modules').mkdir()
    user = home / 'data/music/song.mp3'
    user.parent.mkdir(parents=True)
    user.write_bytes(b'music')
    unknown = home / 'releases/notes'
    unknown.mkdir()
    (unknown / 'keep.txt').write_text('personal')
    for number in range(4):
        path = home / f'backups/before-{number}.db'
        path.parent.mkdir(exist_ok=True)
        path.write_bytes(b'backup')
    cache = home / 'tools/cache/npm/download'
    cache.parent.mkdir(parents=True)
    cache.write_bytes(b'cache')
    runtime = home / 'tools/node/node'
    runtime.parent.mkdir(parents=True)
    runtime.write_bytes(b'node')
    updates.cleanup_updates(home, active, previous)
    assert active.is_dir() and previous.is_dir()
    assert not obsolete.exists()
    assert user.read_bytes() == b'music'
    assert (unknown / 'keep.txt').is_file()
    assert len(list((home / 'backups').iterdir())) == 2
    assert not cache.exists()
    assert runtime.is_file()
