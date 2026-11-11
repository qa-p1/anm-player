import hashlib
import importlib.util
import io
import json
import os
import stat
import subprocess
import zipfile
from pathlib import Path

import pytest

BOOTSTRAP_PATH = Path(__file__).resolve().parents[3] / "scripts" / "bootstrap.py"
SPEC = importlib.util.spec_from_file_location("anm_bootstrap", BOOTSTRAP_PATH)
assert SPEC and SPEC.loader
bootstrap = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bootstrap)


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


def fake_source(tmp_path):
    source = tmp_path / "app"
    (source / "apps/web/public").mkdir(parents=True)
    (source / "apps/web/public/icon-512.png").write_bytes(b"png")
    (source / "apps/web/public/icon.ico").write_bytes(b"ico")
    return source


@pytest.mark.skipif(os.name == "nt", reason="Linux desktop entries")
def test_linux_shortcuts_go_to_the_app_launcher_without_a_terminal(tmp_path, monkeypatch):
    root = tmp_path / "Music's $player Ü"
    root.mkdir()
    desktop = tmp_path / "Desktop"
    desktop.mkdir()
    monkeypatch.setattr(bootstrap.sys, "platform", "linux")
    monkeypatch.setattr(bootstrap.Path, "home", lambda: tmp_path)
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "data-home"))
    monkeypatch.setattr(bootstrap.shutil, "which", lambda name: None)
    bootstrap.write_shortcuts(root, fake_source(tmp_path))

    launcher = root / "launch.sh"
    assert subprocess.run(["sh", "-n", str(launcher)], capture_output=True).returncode == 0
    assert os.access(launcher, os.X_OK)
    assert "uv" not in launcher.read_text() and "tools" not in launcher.read_text()
    entry = (tmp_path / "data-home/applications/anm-player.desktop").read_text()
    assert "Terminal=false" in entry
    assert "Icon=" + str(root / "anm-player.png") in entry
    assert (root / "anm-player.png").read_bytes() == b"png"
    # Exec escapes $ for the shell and doubles backslashes for the desktop file.
    assert 'Exec="' + str(launcher).replace("$", "\\\\$") + '"' in entry
    assert (desktop / "ANM Player.desktop").read_text() == entry


@pytest.mark.skipif(os.name == "nt", reason="Linux desktop entries")
def test_shortcuts_never_replace_someone_elses_file(tmp_path, monkeypatch):
    root = tmp_path / "anm"
    root.mkdir()
    applications = tmp_path / "data-home/applications"
    applications.mkdir(parents=True)
    foreign = applications / "anm-player.desktop"
    foreign.write_text("[Desktop Entry]\nName=Something else\n")
    monkeypatch.setattr(bootstrap.sys, "platform", "linux")
    monkeypatch.setattr(bootstrap.Path, "home", lambda: tmp_path)
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "data-home"))
    monkeypatch.setattr(bootstrap.shutil, "which", lambda name: None)
    bootstrap.write_shortcuts(root, fake_source(tmp_path))
    assert foreign.read_text() == "[Desktop Entry]\nName=Something else\n"


@pytest.mark.skipif(os.name == "nt", reason="POSIX launcher script")
def test_launch_script_runs_bootstrap_with_a_supported_system_python(tmp_path, monkeypatch):
    root = tmp_path / "anm root"
    root.mkdir()
    (root / "bootstrap.py").write_text("import sys, pathlib; pathlib.Path(sys.argv[2], 'ran').write_text(sys.version)")
    launcher = bootstrap.write_launch_script(root, root / "anm-player.png")
    if not bootstrap.system_python():
        pytest.skip("No Python 3.13/3.14 on PATH")
    result = subprocess.run(["sh", str(launcher)], capture_output=True, text=True, stdin=subprocess.DEVNULL)
    assert result.returncode == 0, result.stderr + (root / "launch.log").read_text()
    assert (root / "ran").read_text().startswith(("3.13", "3.14"))


def test_tool_environment_puts_verified_system_tools_first_and_drops_private_settings(tmp_path, monkeypatch):
    monkeypatch.setenv("PATH", os.pathsep.join(["/old/node/bin", "/usr/bin"]))
    monkeypatch.setenv("UV_PYTHON_INSTALL_DIR", "/private/python")
    root = tmp_path / "ANM Player"
    env = bootstrap.tool_environment(root, {"node": Path("/usr/bin"), "ffmpeg": Path("/opt/ffmpeg/bin")})
    assert env["PATH"].split(os.pathsep)[:3] == ["/usr/bin", "/opt/ffmpeg/bin", "/old/node/bin"]
    assert env["ANM_INSTALL_ROOT"] == str(root)
    assert not any(key.startswith("UV_") for key in env)
    assert os.environ["UV_PYTHON_INSTALL_DIR"] == "/private/python"


def test_system_tools_are_used_without_installing_anything(tmp_path, monkeypatch):
    bin_directory = tmp_path / "bin"
    bin_directory.mkdir()
    for name in ("node", "npm", "ffmpeg", "ffprobe"):
        (bin_directory / name).write_text("")
    monkeypatch.setattr(bootstrap, "find_tool", lambda name, accept: bin_directory / name)
    monkeypatch.setattr(bootstrap, "runs", lambda path: True)
    monkeypatch.setattr(bootstrap, "install_system_tool", lambda tool: pytest.fail("Nothing should be installed"))
    monkeypatch.setattr(bootstrap.os, "name", "posix")
    assert bootstrap.ensure_system_tools() == {"node": bin_directory, "ffmpeg": bin_directory}


def test_missing_tool_is_installed_system_wide_then_rechecked(tmp_path, monkeypatch):
    installed = []
    found = {"node": None, "ffmpeg": tmp_path}
    (tmp_path / "npm").write_text("")

    def locate(name, accept):
        directory = found["node"] if name == "node" else found["ffmpeg"]
        return directory / name if directory else None

    def install(tool):
        installed.append(tool)
        found["node"] = tmp_path

    monkeypatch.setattr(bootstrap, "find_tool", locate)
    monkeypatch.setattr(bootstrap, "runs", lambda path: True)
    monkeypatch.setattr(bootstrap, "install_system_tool", install)
    monkeypatch.setattr(bootstrap.os, "name", "posix")
    assert bootstrap.ensure_system_tools() == {"node": tmp_path, "ffmpeg": tmp_path}
    assert installed == ["node"]


def test_unavailable_tool_explains_what_to_install(monkeypatch):
    monkeypatch.setattr(bootstrap, "find_tool", lambda name, accept: None)
    monkeypatch.setattr(bootstrap, "install_system_tool", lambda tool: None)
    with pytest.raises(bootstrap.SetupError, match="Node.js 24"):
        bootstrap.ensure_system_tools()


@pytest.mark.parametrize(("arch_node_major", "expected"), [(24, "nodejs"), (27, "nodejs-lts-krypton")])
def test_pacman_installs_a_supported_node_release(monkeypatch, arch_node_major, expected):
    commands = []
    monkeypatch.setattr(bootstrap, "package_manager", lambda: "pacman")
    monkeypatch.setattr(bootstrap, "privilege_prefix", lambda: ["sudo"])
    monkeypatch.setattr(bootstrap, "pacman_version_major", lambda package: arch_node_major)
    monkeypatch.setattr(bootstrap, "run_install", lambda command, label: commands.append(command) or True)
    bootstrap.install_system_tool("node")
    bootstrap.install_system_tool("ffmpeg")
    assert commands == [["sudo", "pacman", "-S", "--needed", "--noconfirm", expected, "npm"], ["sudo", "pacman", "-S", "--needed", "--noconfirm", "ffmpeg"]]


def test_windows_falls_back_to_chocolatey_when_winget_fails(monkeypatch):
    commands = []
    monkeypatch.setattr(bootstrap.os, "name", "nt")
    monkeypatch.setattr(bootstrap, "package_manager", lambda: "winget")
    monkeypatch.setattr(bootstrap.shutil, "which", lambda name: "choco" if name == "choco" else None)
    monkeypatch.setattr(bootstrap, "refresh_windows_path", lambda: None)
    monkeypatch.setattr(bootstrap, "run_install", lambda command, label: commands.append(command[0]) or command[0] == "choco")
    bootstrap.install_system_tool("ffmpeg")
    assert commands == ["winget", "choco"]


def test_debian_adds_the_nodesource_repository_only_for_old_node(monkeypatch):
    commands = []
    monkeypatch.setattr(bootstrap, "package_manager", lambda: "apt-get")
    monkeypatch.setattr(bootstrap, "privilege_prefix", lambda: ["sudo"])
    monkeypatch.setattr(bootstrap, "apt_candidate_major", lambda package: 18)
    monkeypatch.setattr(bootstrap, "download", lambda url, target, **kwargs: target.write_text("echo repo"))
    monkeypatch.setattr(bootstrap, "run_install", lambda command, label: commands.append(command) or True)
    bootstrap.install_system_tool("node")
    apt = ["sudo", "env", "DEBIAN_FRONTEND=noninteractive", "apt-get"]
    assert commands[0] == [*apt, "update"]
    assert commands[1][:2] == ["sudo", "bash"]
    assert commands[2] == [*apt, "install", "-y", "nodejs"]


def test_retiring_private_tools_keeps_library_and_rebuilds_only_private_environments(tmp_path, monkeypatch):
    root = tmp_path / "anm"
    private_python = root / "tools/python/cpython-3.13/bin"
    private_python.mkdir(parents=True)
    old = root / "app"
    (old / "apps/api/.venv").mkdir(parents=True)
    (old / "apps/api/.venv/pyvenv.cfg").write_text(f"home = {private_python}\n")
    (old / ".aura").mkdir()
    (old / ".aura/launcher-dependencies.json").write_text("{}")
    system = root / "releases" / ("c" * 40)
    (system / "apps/api/.venv").mkdir(parents=True)
    (system / "apps/api/.venv/pyvenv.cfg").write_text("home = /usr/bin\n")
    music = root / "data/music/song.mp3"
    music.parent.mkdir(parents=True)
    music.write_bytes(b"music")
    (root / "Start ANM Player.sh").write_text("old")
    stopped = []
    monkeypatch.setattr(bootstrap.subprocess, "run", lambda *args, **kwargs: stopped.append(args[0]))
    (old / "scripts").mkdir()
    (old / "scripts/start_aura.py").write_text("")
    bootstrap.retire_private_tools(root)
    assert not (root / "tools").exists()
    assert not (old / "apps/api/.venv").exists()
    assert not (old / ".aura/launcher-dependencies.json").exists()
    assert (system / "apps/api/.venv/pyvenv.cfg").is_file()
    assert music.read_bytes() == b"music"
    assert not (root / "Start ANM Player.sh").exists()
    assert stopped and stopped[0][-1] == "--stop"


def test_older_app_copies_fall_back_to_the_svg_icon(tmp_path):
    root = tmp_path / "anm"
    root.mkdir()
    source = tmp_path / "app"
    (source / "apps/web/public").mkdir(parents=True)
    (source / "apps/web/public/favicon.svg").write_text("<svg/>")
    assert bootstrap.install_icon(root, source) == root / "anm-player.svg"
    assert (root / "anm-player.svg").read_text() == "<svg/>"


def test_desktop_exec_argument_follows_the_desktop_entry_spec():
    assert bootstrap.desktop_exec_argument('/a b/"x"/$y/50%') == '"/a b/\\\\"x\\\\"/\\\\$y/50%%"'


def test_setup_lock_is_exclusive_and_reusable_after_failure(tmp_path):
    with pytest.raises(RuntimeError, match="interrupted"):
        with bootstrap.setup_lock(tmp_path):
            with pytest.raises(bootstrap.SetupError, match="already running"):
                with bootstrap.setup_lock(tmp_path):
                    pytest.fail("Concurrent setup acquired the lock")
            raise RuntimeError("interrupted")
    with bootstrap.setup_lock(tmp_path):
        pass
