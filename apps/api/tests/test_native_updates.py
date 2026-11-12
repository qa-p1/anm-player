import importlib.util
import io
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
NEWER = "c" * 40


@pytest.fixture(autouse=True)
def offline_github(monkeypatch):
    """Tests never reach GitHub; ones that need it patch these back in."""
    def offline(*_args, **_kwargs):
        raise OSError("offline in tests")

    monkeypatch.setattr(updates, "github_head", offline)
    monkeypatch.setattr(updates.urllib.request, "urlopen", offline)


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
    monkeypatch.setattr(updates, "release_notes", lambda *_args: {"notes": [{"title": None, "text": "Faster"}], "more": 0})
    m._work(None)
    assert m.status()["state"] == "available"
    assert m.status()["notes"] == [{"title": None, "text": "Faster"}]
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
    cache = home / 'download-cache/npm/download'
    cache.parent.mkdir(parents=True)
    cache.write_bytes(b'cache')
    settings_file = home / '.env'
    settings_file.write_text('API_ACCESS_TOKEN=x')
    updates.cleanup_updates(home, active, previous)
    assert active.is_dir() and previous.is_dir()
    assert not obsolete.exists()
    assert user.read_bytes() == b'music'
    assert (unknown / 'keep.txt').is_file()
    assert len(list((home / 'backups').iterdir())) == 2
    assert not cache.exists()
    assert settings_file.is_file()


def test_cleanup_protects_custom_storage_inside_an_older_app_copy(tmp_path):
    home = tmp_path / 'home'
    old = home / 'releases' / OLD
    source(old)
    updates.write_json(old / '.aura/install.json', {'commit': OLD, 'managed': True})
    music = old / 'custom-music/song.mp3'
    music.parent.mkdir()
    music.write_bytes(b'my music')
    updates.cleanup_updates(home, home / 'current', user_paths=(music.parent,))
    assert music.read_bytes() == b'my music'


def test_native_start_checks_in_background_but_replacement_does_not_clobber_completion(tmp_path, monkeypatch):
    events = []
    root = tmp_path / 'app'
    source(root)
    monkeypatch.setattr(updates.NativeUpdater, 'start', lambda self, **kwargs: events.append(kwargs))
    updates.NativeUpdater(root, tmp_path / 'home', {}, lambda *_: None, check_on_start=True)
    assert events == [{'install': False}]
    events.clear()
    monkeypatch.setenv('ANM_UPDATE_RESTART', '1')
    updates.NativeUpdater(root, tmp_path / 'home', {}, lambda *_: None, check_on_start=True)
    assert events == []


def test_completion_is_published_only_after_cleanup_finishes(tmp_path, monkeypatch):
    m = manager(tmp_path)
    monkeypatch.setattr(updates, 'download_source', lambda commit, root: source(root))
    monkeypatch.setattr(m, '_run', lambda *_, **__: None)
    monkeypatch.setattr(updates.shutil, 'which', lambda _: '/tool/npm')
    events = []
    def clean(*_, **__):
        assert m.status()['state'] == 'cleaning'
        events.append('cleaned')
    def complete():
        assert m.status()['state'] == 'completed'
        assert events == ['cleaned']
        events.append('handover')
    m.on_complete = complete
    monkeypatch.setattr(updates, 'cleanup_updates', clean)
    m._work(NEW)
    assert events == ['cleaned', 'handover']


def test_release_notes_list_only_changelog_entries_this_install_lacks(tmp_path, monkeypatch):
    (tmp_path / "CHANGELOG.md").write_text("# Changelog\n\n## 1.0\n\n- Old entry\n", encoding="utf-8")
    remote = "# Changelog\n\n## Updates\n\n- **Faster search**: results\n  come back sooner.\n- Uses `bootstrap.py` now\n\n## 1.0\n\n- Old entry\n"

    class Response(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    monkeypatch.setattr(updates.urllib.request, "urlopen", lambda url, timeout: Response(remote.encode()))
    notes = updates.release_notes(tmp_path, NEW)
    assert notes == {"notes": [{"title": "Faster search", "text": "results come back sooner."}, {"title": None, "text": "Uses bootstrap.py now"}], "more": 0, "changes": 0}


def test_release_notes_are_optional_when_github_is_unreachable(tmp_path, monkeypatch):
    monkeypatch.setattr(updates.urllib.request, "urlopen", lambda url, timeout: (_ for _ in ()).throw(OSError("offline")))
    assert updates.release_notes(tmp_path, NEW, OLD) == {"notes": [], "more": 0, "changes": 0}


def test_release_notes_fall_back_to_every_commit_since_the_installed_one(tmp_path, monkeypatch):
    (tmp_path / "CHANGELOG.md").write_text("- Same\n", encoding="utf-8")
    compare = {"total_commits": 3, "commits": [{"commit": {"message": "fix: first\n\nbody"}}, {"commit": {"message": "Merge branch x"}}, {"commit": {"message": "feat: second"}}]}

    def respond(request, timeout):
        url = getattr(request, "full_url", request)
        body = json.dumps(compare).encode() if "/compare/" in url else b"- Same\n"
        response = io.BytesIO(body)
        response.__enter__ = lambda: response
        return type("R", (), {"__enter__": lambda self: response, "__exit__": lambda self, *a: False})()

    monkeypatch.setattr(updates.urllib.request, "urlopen", respond)
    notes = updates.release_notes(tmp_path, NEW, OLD)
    assert notes["notes"] == [{"title": None, "text": "feat: second"}, {"title": None, "text": "fix: first"}]
    assert notes["changes"] == 3


def test_install_takes_the_newest_version_not_the_one_seen_at_check_time(tmp_path, monkeypatch):
    m = manager(tmp_path)
    downloaded = []
    monkeypatch.setattr(updates, "github_head", lambda: {"commit": NEWER, "summary": "Even newer"})
    monkeypatch.setattr(updates, "download_source", lambda commit, root: (downloaded.append(commit), (_ for _ in ()).throw(updates.UpdateError("stop here")))[1])
    m._work(NEW)
    assert downloaded == [NEWER]
    assert m.status()["latest_commit"] == NEWER


def test_a_copy_newer_than_main_is_up_to_date(tmp_path, monkeypatch):
    m = manager(tmp_path)
    monkeypatch.setattr(updates, "github_head", lambda: {"commit": NEW, "summary": "Older main"})
    monkeypatch.setattr(updates, "compare_commits", lambda installed, latest: {"status": "behind", "commits": []})
    m._work(None)
    assert m.status()["state"] == "current"
