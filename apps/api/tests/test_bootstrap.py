import hashlib
import importlib.util
import io
import json
import os
import stat
import subprocess
import tarfile
import zipfile
from pathlib import Path

import pytest

BOOTSTRAP_PATH = Path(__file__).resolve().parents[3] / "scripts" / "bootstrap.py"
SPEC = importlib.util.spec_from_file_location("anm_bootstrap", BOOTSTRAP_PATH)
assert SPEC and SPEC.loader
bootstrap = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bootstrap)


@pytest.mark.parametrize(("system", "machine", "expected"), [
    ("win32", "AMD64", ("win", "x64", "win32")),
    ("win32", "ARM64", ("win", "arm64", "win32")),
    ("darwin", "x86_64", ("darwin", "x64", "darwin")),
    ("darwin", "arm64", ("darwin", "arm64", "darwin_arm64")),
    ("linux", "x86_64", ("linux", "x64", "linux")),
    ("linux", "aarch64", ("linux", "arm64", "linux_arm64")),
])
def test_runtime_platform_selection(system, machine, expected):
    assert bootstrap.platform_names(system, machine) == expected


def test_unsupported_platform_fails_before_downloading():
    with pytest.raises(bootstrap.SetupError, match="64-bit"):
        bootstrap.platform_names("linux", "i686")


@pytest.mark.parametrize("name", ["../outside", "/absolute", "C:/Windows/file", "folder/../../outside", "folder\\outside"])
def test_source_archives_cannot_escape_install_folder(tmp_path, name):
    archive = tmp_path / "bad.zip"
    with zipfile.ZipFile(archive, "w") as z:
        z.writestr(name, "unexpected")
    with pytest.raises(bootstrap.SetupError, match="unsafe"):
        bootstrap.extract_zip(archive, tmp_path / "unpacked")
    assert not (tmp_path / "outside").exists()


def test_zip_symlinks_and_zip_bombs_are_rejected(tmp_path):
    archive = tmp_path / "bad.zip"
    with zipfile.ZipFile(archive, "w") as z:
        info = zipfile.ZipInfo("link")
        info.external_attr = (stat.S_IFLNK | 0o777) << 16
        z.writestr(info, "../outside")
    with pytest.raises(bootstrap.SetupError, match="special"):
        bootstrap.extract_zip(archive, tmp_path / "unpacked")
    with zipfile.ZipFile(archive, "w") as z:
        z.writestr("large.txt", "x" * 100)
    with pytest.raises(bootstrap.SetupError, match="too large"):
        bootstrap.extract_zip(archive, tmp_path / "unpacked", max_size=10)


@pytest.mark.skipif(os.name == "nt", reason="POSIX Node package symlink")
def test_node_tar_keeps_internal_npm_link_but_rejects_escape(tmp_path):
    archive = tmp_path / "node.tar.gz"
    with tarfile.open(archive, "w:gz") as tar:
        info = tarfile.TarInfo("node/lib/npm.js")
        info.size = 3
        tar.addfile(info, io.BytesIO(b"npm"))
        link = tarfile.TarInfo("node/bin/npm")
        link.type = tarfile.SYMTYPE
        link.linkname = "../lib/npm.js"
        tar.addfile(link)
    destination = tmp_path / "unpacked"
    bootstrap.extract_tar(archive, destination)
    assert (destination / "node/bin/npm").read_bytes() == b"npm"
    with tarfile.open(archive, "w:gz") as tar:
        link = tarfile.TarInfo("node/bin/npm")
        link.type = tarfile.SYMTYPE
        link.linkname = "../../../outside"
        tar.addfile(link)
    with pytest.raises(bootstrap.SetupError, match="unsafe link"):
        bootstrap.extract_tar(archive, tmp_path / "other")


def test_bad_download_does_not_replace_existing_runtime(tmp_path, monkeypatch):
    target = tmp_path / "node.zip"
    target.write_bytes(b"known-good")
    monkeypatch.setattr(bootstrap.urllib.request, "urlopen", lambda *args, **kwargs: io.BytesIO(b"bad download"))
    with pytest.raises(bootstrap.SetupError, match="integrity"):
        bootstrap.download("https://nodejs.org/example", target, sha256="0" * 64)
    assert target.read_bytes() == b"known-good"
    assert not target.with_name("node.zip.partial").exists()


def test_successful_download_verifies_sha256_before_replace(tmp_path, monkeypatch):
    content = b"verified archive"
    monkeypatch.setattr(bootstrap.urllib.request, "urlopen", lambda *args, **kwargs: io.BytesIO(content))
    target = tmp_path / "archive.zip"
    bootstrap.download("https://nodejs.org/example", target, sha256=hashlib.sha256(content).hexdigest())
    assert target.read_bytes() == content


def test_first_source_download_is_pinned_and_rerun_is_offline(tmp_path, monkeypatch):
    commit = "a" * 40
    monkeypatch.setattr(bootstrap, "remote_text", lambda url: json.dumps({"sha": commit}))
    downloads = []

    def fetch(url, target, **kwargs):
        downloads.append(url)
        with zipfile.ZipFile(target, "w") as z:
            z.writestr("anm-player-source/scripts/start_aura.py", "# launcher")
            z.writestr("anm-player-source/.env.example", "API_ACCESS_TOKEN=\n")

    monkeypatch.setattr(bootstrap, "download", fetch)
    source = bootstrap.source_directory(tmp_path)
    assert downloads == [f"https://codeload.github.com/qa-p1/anm-player/zip/{commit}"]
    assert json.loads((source / ".aura/install.json").read_text()) == {"commit": commit, "managed": True}
    monkeypatch.setattr(bootstrap, "remote_text", lambda url: pytest.fail("Existing installation must open offline"))
    assert bootstrap.source_directory(tmp_path) == source


def test_existing_incomplete_source_is_kept(tmp_path):
    source = tmp_path / "app"
    source.mkdir()
    personal = source / "personal.txt"
    personal.write_text("keep")
    with pytest.raises(bootstrap.SetupError, match="already exists"):
        bootstrap.source_directory(tmp_path)
    assert personal.read_text() == "keep"


def test_source_selection_honors_update_pointer_and_rejects_outside_path(tmp_path):
    candidate = tmp_path / "releases" / ("b" * 40)
    (candidate / "scripts").mkdir(parents=True)
    (candidate / "scripts/start_aura.py").write_text("# launcher")
    pointer = tmp_path / "current.json"
    pointer.write_text(json.dumps({"root": str(candidate)}))
    assert bootstrap.source_directory(tmp_path) == candidate
    pointer.write_text(json.dumps({"root": str(tmp_path.parent)}))
    with pytest.raises(bootstrap.SetupError, match="pointer"):
        bootstrap.source_directory(tmp_path)


def test_settings_token_and_library_stay_stable_across_source_replacement(tmp_path):
    for name in ("app", "next"):
        source = tmp_path / name
        source.mkdir()
        (source / ".env.example").write_text("API_ACCESS_TOKEN=\nAURA_DATA_ROOT=./data\nAURA_STATE_FILE=./.aura/state.json\n")
    bootstrap.prepare_environment(tmp_path, tmp_path / "app")
    original = (tmp_path / ".env").read_text()
    bootstrap.prepare_environment(tmp_path, tmp_path / "next")
    assert (tmp_path / ".env").read_text() == original
    assert (tmp_path / "next/.env").read_text() == original
    assert "AURA_DATA_ROOT=" + json.dumps(str(tmp_path / "data")) in original
    assert "AURA_STATE_FILE=" + json.dumps(str(tmp_path / "storage-state.json")) in original
    assert "API_ACCESS_TOKEN=\n" not in original


def test_existing_settings_are_preserved_and_relative_storage_resolves_from_install_root(tmp_path):
    source = tmp_path / "release"
    source.mkdir()
    original = "# custom\nAPI_ACCESS_TOKEN=" + "x" * 48 + "\nAURA_DATA_ROOT=music data\nAURA_STATE_FILE=state.json\nWEB_PORT=5180\n"
    (tmp_path / ".env").write_text(original)
    bootstrap.prepare_environment(tmp_path, source)
    assert (tmp_path / ".env").read_text() == original
    local = (source / ".env").read_text()
    assert "AURA_DATA_ROOT=" + json.dumps(str(tmp_path / "music data")) in local
    assert "AURA_STATE_FILE=" + json.dumps(str(tmp_path / "state.json")) in local
    assert "WEB_PORT=5180" in local


def test_storage_paths_quote_hash_quotes_unicode_and_backslashes(tmp_path):
    root = tmp_path / 'Player #1 "É" \\ data'
    source = root / "app"
    source.mkdir(parents=True)
    (source / ".env.example").write_text("API_ACCESS_TOKEN=\nAURA_DATA_ROOT=./data\nAURA_STATE_FILE=./.aura/state.json\n")
    bootstrap.prepare_environment(root, source)
    for settings in (root / ".env", source / ".env"):
        values = dict(line.split("=", 1) for line in settings.read_text().splitlines())
        assert Path(json.loads(values["AURA_DATA_ROOT"])) == root / "data"
        assert Path(json.loads(values["AURA_STATE_FILE"])) == root / "storage-state.json"


@pytest.mark.skipif(os.name == "nt", reason="POSIX shell syntax check")
def test_shortcut_quotes_spaces_unicode_and_shell_characters(tmp_path, monkeypatch):
    root = tmp_path / "Music's $player Ü"
    root.mkdir()
    monkeypatch.setattr(bootstrap.sys, "platform", "linux")
    monkeypatch.setattr(bootstrap.Path, "home", lambda: tmp_path)
    bootstrap.write_shortcuts(root)
    shortcut = root / "Start ANM Player.sh"
    result = subprocess.run(["sh", "-n", str(shortcut)], capture_output=True)
    assert result.returncode == 0, result.stderr
    assert os.access(shortcut, os.X_OK)
    assert "--managed-python" in shortcut.read_text()


def test_scoped_runtime_environment_does_not_change_parent_path(tmp_path, monkeypatch):
    monkeypatch.setenv("PATH", "original-path")
    root = tmp_path / "ANM Player"
    env = bootstrap.runtime_environment(root, root / "tools/node/bin", root / "tools/bin")
    assert os.environ["PATH"] == "original-path"
    assert env["PATH"].endswith(os.pathsep + "original-path")
    assert env["ANM_INSTALL_ROOT"] == str(root)
    assert env["UV_NO_MODIFY_PATH"] == "1"
    assert str(tmp_path) in env["UV_PYTHON_INSTALL_DIR"]


def test_setup_lock_is_exclusive_and_reusable_after_failure(tmp_path):
    with pytest.raises(RuntimeError, match="interrupted"):
        with bootstrap.setup_lock(tmp_path):
            with pytest.raises(bootstrap.SetupError, match="already running"):
                with bootstrap.setup_lock(tmp_path):
                    pytest.fail("Concurrent setup acquired the lock")
            raise RuntimeError("interrupted")
    with bootstrap.setup_lock(tmp_path):
        pass
