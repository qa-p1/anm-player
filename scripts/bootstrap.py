#!/usr/bin/env python3
"""Prepare ANM Player in the current user's folder, then open it.

The download-and-run wrappers supply Python through an isolated uv installation.
Nothing is added to shell profiles, the registry PATH, or system Python/Node.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import hashlib
import json
import os
import platform
import re
import secrets
import shlex
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath
from collections.abc import Iterator

REPOSITORY = "qa-p1/anm-player"
NODE_MAJOR = 24
FFMPEG_COMMIT = "df95abcb0ce6efff710dda5ef28a2f6f1dc21493"
FFMPEG_ARCHIVES = {
    "win32": "92662c2241e93fe71b3f3a01e94a0b0dc8cfad726019f96b83bc109ce44c5d0b",
    "darwin": "70fd5b21cb37b6ea97c8b584cf76b3cc6a90179831c9c269811b9716c28605fb",
    "darwin_arm64": "b2da44a8169c4d09a97db996250690c3346f72e4795521d23d3dbb1e72421207",
    "linux": "ca75b05e887c7a97676632f673031875847be83daa9794298fed9cef8cac14ad",
    "linux_arm64": "e03efe471c03b999f10988d5db62ae3bd94837463291b3c7755528b100e97d6f",
}


class SetupError(RuntimeError):
    """A recoverable setup problem shown to the user without a traceback."""


def install_root() -> Path:
    override = os.environ.get("ANM_INSTALL_ROOT")
    if override:
        return Path(override).expanduser().resolve()
    if sys.platform == "win32":
        local = os.environ.get("LOCALAPPDATA")
        if not local:
            raise SetupError("Windows did not provide a local application folder.")
        return Path(local) / "ANMPlayer"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "ANM Player"
    return Path.home() / ".local" / "share" / "anm-player"


def platform_names(system: str | None = None, machine: str | None = None) -> tuple[str, str, str]:
    system = system or sys.platform
    machine = (machine or platform.machine()).lower()
    arch = {"amd64": "x64", "x86_64": "x64", "arm64": "arm64", "aarch64": "arm64"}.get(machine)
    if not arch or system not in {"win32", "darwin", "linux"}:
        raise SetupError("Automatic setup supports 64-bit Windows, macOS, and Linux on Intel/AMD or ARM.")
    node_os = {"win32": "win", "darwin": "darwin", "linux": "linux"}[system]
    ffmpeg = system + ("_arm64" if arch == "arm64" and system != "win32" else "")
    return node_os, arch, ffmpeg


def download(url: str, target: Path, *, sha256: str | None = None, max_bytes: int = 350 * 1024 * 1024) -> None:
    if not url.startswith("https://"):
        raise SetupError("Setup downloads must use HTTPS.")
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(target.name + ".partial")
    digest = hashlib.sha256()
    total = 0
    request = urllib.request.Request(url, headers={"User-Agent": "ANM-Player-Setup/1", "Accept": "application/octet-stream"})
    try:
        with urllib.request.urlopen(request, timeout=90) as response, temporary.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                total += len(chunk)
                if total > max_bytes:
                    raise SetupError("The setup download exceeded its expected size.")
                digest.update(chunk)
                output.write(chunk)
        if not total:
            raise SetupError("A setup download was empty. Please try again.")
        if sha256 and digest.hexdigest() != sha256:
            raise SetupError("A downloaded file failed its integrity check. Please run setup again.")
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)


def remote_text(url: str, *, limit: int = 1024 * 1024) -> str:
    headers = {"User-Agent": "ANM-Player-Setup/1", "Accept": "application/vnd.github+json"}
    # Shared CI runner IPs exhaust GitHub's anonymous limit. The job token is
    # process-scoped and is never written into the app's configuration.
    if url.startswith("https://api.github.com/") and os.environ.get("GITHUB_ACTIONS") == "true" and os.environ.get("GH_TOKEN"):
        headers["Authorization"] = "Bearer " + os.environ["GH_TOKEN"]
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=30) as response:
        content = response.read(limit + 1)
    if len(content) > limit:
        raise SetupError("The update server returned too much metadata.")
    return content.decode("utf-8")


def member_path(destination: Path, name: str) -> Path:
    if "\\" in name or "\0" in name or ":" in name:
        raise SetupError("An archive contains an unsafe filename.")
    item = PurePosixPath(name)
    if item.is_absolute() or ".." in item.parts:
        raise SetupError("An archive contains an unsafe path.")
    target = destination.joinpath(*item.parts)
    if not target.resolve().is_relative_to(destination.resolve()):
        raise SetupError("An archive would write outside its setup folder.")
    return target


def extract_zip(archive: Path, destination: Path, *, max_size: int = 1024 * 1024 * 1024) -> None:
    with zipfile.ZipFile(archive) as source:
        if sum(item.file_size for item in source.infolist()) > max_size:
            raise SetupError("The extracted archive would be too large.")
        for item in source.infolist():
            target = member_path(destination, item.filename)
            mode = item.external_attr >> 16
            if stat.S_ISLNK(mode) or (stat.S_IFMT(mode) not in {0, stat.S_IFREG, stat.S_IFDIR}):
                raise SetupError("An archive contains an unsupported special file.")
            if item.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with source.open(item) as incoming, target.open("wb") as output:
                    shutil.copyfileobj(incoming, output)
                if mode & 0o111:
                    target.chmod(0o755)


def extract_tar(archive: Path, destination: Path) -> None:
    with tarfile.open(archive, "r:gz") as source:
        members = source.getmembers()
        if sum(item.size for item in members) > 1024 * 1024 * 1024:
            raise SetupError("The extracted runtime would be too large.")
        for item in members:
            member_path(destination, item.name)
            if item.issym() or item.islnk():
                # Node's npm/npx links stay inside the one extracted package.
                link = PurePosixPath(item.linkname)
                parent = PurePosixPath(item.name).parent if item.issym() else PurePosixPath()
                if link.is_absolute() or "\\" in item.linkname or ":" in item.linkname:
                    raise SetupError("A runtime archive contains an unsafe link.")
                target = destination.joinpath(*parent.parts, *link.parts)
                if not target.resolve().is_relative_to(destination.resolve()):
                    raise SetupError("A runtime archive contains an unsafe link.")
            elif not item.isdir() and not item.isfile():
                raise SetupError("A runtime archive contains an unsupported special file.")
        source.extractall(destination, filter="data")


def checked(arguments: list[str], *, environment: dict[str, str] | None = None, cwd: Path | None = None) -> None:
    result = subprocess.run(arguments, env=environment, cwd=cwd, check=False)
    if result.returncode:
        raise SetupError(f"Setup could not complete ({Path(arguments[0]).name}, exit {result.returncode}). Run setup again to retry.")


@contextmanager
def setup_lock(root: Path) -> Iterator[None]:
    """A kernel-owned lock is released automatically even if setup crashes."""
    with (root / "setup.lock").open("a+b") as handle:
        if handle.tell() == 0:
            handle.write(b"\0")
            handle.flush()
        handle.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            raise SetupError("ANM Player setup is already running. Wait for its window to finish.") from exc
        try:
            yield
        finally:
            handle.seek(0)
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def executable_ok(path: Path, *arguments: str) -> bool:
    if not path.is_file():
        return False
    try:
        result = subprocess.run([str(path), *arguments], capture_output=True, timeout=15, check=False)
        return result.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def install_node(root: Path) -> Path:
    node_os, arch, _ = platform_names()
    node_directory = root / "tools" / "node"
    binary_directory = node_directory if node_os == "win" else node_directory / "bin"
    binary = binary_directory / ("node.exe" if node_os == "win" else "node")
    if executable_ok(binary, "--version"):
        return binary_directory
    print("[setup] Downloading Node.js 24…", flush=True)
    manifest = remote_text(f"https://nodejs.org/dist/latest-v{NODE_MAJOR}.x/SHASUMS256.txt")
    suffix = ".zip" if node_os == "win" else ".tar.gz"
    pattern = re.compile(rf"^([0-9a-f]{{64}})\s+(node-v{NODE_MAJOR}\.\d+\.\d+-{node_os}-{arch}{re.escape(suffix)})$", re.MULTILINE)
    match = pattern.search(manifest)
    if not match:
        raise SetupError("Node.js does not provide a matching runtime for this computer.")
    checksum, filename = match.groups()
    version = filename.split("-")[1]
    with tempfile.TemporaryDirectory(prefix="node-", dir=root / "tools") as temporary:
        stage = Path(temporary)
        archive = stage / filename
        download(f"https://nodejs.org/dist/{version}/{filename}", archive, sha256=checksum)
        unpacked = stage / "unpacked"
        unpacked.mkdir()
        if suffix == ".zip":
            extract_zip(archive, unpacked)
        else:
            extract_tar(archive, unpacked)
        children = list(unpacked.iterdir())
        if len(children) != 1 or not children[0].is_dir():
            raise SetupError("The Node.js archive has an unexpected layout.")
        if node_directory.exists():
            shutil.rmtree(node_directory)
        children[0].rename(node_directory)
    if not executable_ok(binary, "--version"):
        raise SetupError("The downloaded Node.js runtime could not run on this computer.")
    return binary_directory


def install_ffmpeg(root: Path) -> Path:
    _, _, key = platform_names()
    directory = root / "tools" / "bin"
    extension = ".exe" if sys.platform == "win32" else ""
    if all(executable_ok(directory / (name + extension), "-version") for name in ("ffmpeg", "ffprobe")):
        return directory
    print("[setup] Downloading FFmpeg and FFprobe…", flush=True)
    with tempfile.TemporaryDirectory(prefix="ffmpeg-", dir=root / "tools") as temporary:
        stage = Path(temporary)
        archive = stage / "ffmpeg.zip"
        download(f"https://media.githubusercontent.com/media/zackees/ffmpeg_bins/{FFMPEG_COMMIT}/v8.0/{key}.zip", archive, sha256=FFMPEG_ARCHIVES[key])
        unpacked = stage / "unpacked"
        extract_zip(archive, unpacked)
        directory.mkdir(parents=True, exist_ok=True)
        for name in ("ffmpeg", "ffprobe"):
            matches = [path for path in unpacked.rglob(name + extension) if path.is_file()]
            if len(matches) != 1:
                raise SetupError("The FFmpeg archive has an unexpected layout.")
            target = directory / (name + extension)
            shutil.copyfile(matches[0], target)
            target.chmod(0o755)
    if not all(executable_ok(directory / (name + extension), "-version") for name in ("ffmpeg", "ffprobe")):
        raise SetupError("FFmpeg could not run on this computer. Check that this is a supported 64-bit operating system.")
    return directory


def source_directory(root: Path) -> Path:
    pointer = root / "current.json"
    if pointer.exists():
        try:
            value = json.loads(pointer.read_text(encoding="utf-8"))["root"]
            active = Path(value)
            if not active.is_absolute() or not active.resolve().is_relative_to(root.resolve()):
                raise ValueError("invalid source location")
            if not (active / "scripts" / "start_aura.py").is_file():
                raise ValueError("missing launcher")
            return active.resolve()
        except (OSError, ValueError, TypeError, KeyError) as exc:
            raise SetupError("The installed app's update pointer is invalid. Your library is safe; restore current.json or contact support.") from exc
    source = root / "app"
    marker = source / ".aura" / "install.json"
    if source.exists():
        if not marker.is_file() or not (source / "scripts" / "start_aura.py").is_file():
            raise SetupError(f"{source} already exists but is not a complete ANM Player installation. Keep it safe and choose another setup folder.")
        return source
    print("[setup] Downloading ANM Player…", flush=True)
    metadata = json.loads(remote_text(f"https://api.github.com/repos/{REPOSITORY}/commits/main"))
    commit = metadata.get("sha", "") if isinstance(metadata, dict) else ""
    if not isinstance(commit, str) or not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise SetupError("GitHub did not return a valid app version.")
    with tempfile.TemporaryDirectory(prefix="app-", dir=root) as temporary:
        stage = Path(temporary)
        archive = stage / "app.zip"
        download(f"https://codeload.github.com/{REPOSITORY}/zip/{commit}", archive, max_bytes=30 * 1024 * 1024)
        unpacked = stage / "unpacked"
        extract_zip(archive, unpacked, max_size=150 * 1024 * 1024)
        children = list(unpacked.iterdir())
        if len(children) != 1 or not (children[0] / "scripts" / "start_aura.py").is_file():
            raise SetupError("The app download is incomplete. Run setup again.")
        installed_marker = children[0] / ".aura" / "install.json"
        installed_marker.parent.mkdir(parents=True, exist_ok=True)
        installed_marker.write_text(json.dumps({"commit": commit, "managed": True}) + "\n", encoding="utf-8")
        children[0].rename(source)
    return source


def prepare_environment(root: Path, source: Path) -> None:
    stable = root / ".env"
    if not stable.exists():
        lines = (source / ".env.example").read_text(encoding="utf-8").splitlines()
        defaults = {
            "API_ACCESS_TOKEN": secrets.token_urlsafe(48),
            "AURA_DATA_ROOT": json.dumps(str(root / "data"), ensure_ascii=False),
            "AURA_STATE_FILE": json.dumps(str(root / "storage-state.json"), ensure_ascii=False),
        }
        replaced = set()
        for index, line in enumerate(lines):
            key = line.partition("=")[0]
            if key in defaults:
                lines[index] = key + "=" + defaults[key]
                replaced.add(key)
        lines.extend(key + "=" + value for key, value in defaults.items() if key not in replaced)
        stable.write_text("\n".join(lines) + "\n", encoding="utf-8")
        if os.name != "nt":
            stable.chmod(0o600)
    # Keep the user's settings byte-for-byte in the stable file. Resolve relative
    # storage entries only in the source-local copy, so release moves cannot move data.
    content = stable.read_text(encoding="utf-8")
    lines = content.splitlines()
    for index, line in enumerate(lines):
        key, separator, value = line.partition("=")
        if separator and key.strip() in {"AURA_DATA_ROOT", "AURA_STATE_FILE"}:
            configured = value.strip()
            if configured.startswith('"'):
                try:
                    configured = json.loads(configured)
                except ValueError as exc:
                    raise SetupError(f"{key.strip()} in your settings has an invalid quoted path.") from exc
            elif configured.startswith("'") and configured.endswith("'"):
                configured = configured[1:-1]
            if not isinstance(configured, str):
                raise SetupError(f"{key.strip()} in your settings must be a folder path.")
            path = Path(configured).expanduser()
            if not path.is_absolute():
                path = (root / path).resolve()
            lines[index] = key + "=" + json.dumps(str(path), ensure_ascii=False)
    local = source / ".env"
    local.write_text("\n".join(lines) + "\n", encoding="utf-8")
    if os.name != "nt":
        local.chmod(0o600)


def runtime_environment(root: Path, node_bin: Path, ffmpeg_bin: Path) -> dict[str, str]:
    environment = os.environ.copy()
    environment.update({
        "ANM_INSTALL_ROOT": str(root),
        "UV_PYTHON_INSTALL_DIR": str(root / "tools" / "python"),
        "UV_PYTHON_BIN_DIR": str(root / "tools" / "python-bin"),
        "UV_PYTHON_INSTALL_BIN": "0",
        "UV_CACHE_DIR": str(root / "tools" / "cache"),
        "UV_NO_MODIFY_PATH": "1",
        "PIP_CACHE_DIR": str(root / "tools" / "cache" / "pip"),
        "npm_config_cache": str(root / "tools" / "cache" / "npm"),
        "PATH": os.pathsep.join((str(node_bin), str(ffmpeg_bin), str(root / "tools" / "uv"), environment.get("PATH", ""))),
    })
    return environment


def write_shortcuts(root: Path) -> None:
    # Installed scripts point only to persistent locations and scope all env vars.
    bootstrap = root / "bootstrap.py"
    uv = root / "tools" / "uv" / ("uv.exe" if sys.platform == "win32" else "uv")
    if sys.platform == "win32":
        command = root / "Start ANM Player.cmd"
        script = '@echo off\r\nsetlocal DisableDelayedExpansion\r\nchcp 65001 >nul\r\n'
        for key, value in runtime_environment(root, root / "tools" / "node", root / "tools" / "bin").items():
            if key.startswith("UV_") or key == "ANM_INSTALL_ROOT":
                script += f'set "{key}={value.replace("%", "%%")}"\r\n'
        escaped_uv, escaped_bootstrap, escaped_root = (str(path).replace("%", "%%") for path in (uv, bootstrap, root))
        script += f'"{escaped_uv}" run --no-config --no-project --managed-python --python 3.13 "{escaped_bootstrap}" --root "{escaped_root}" %*\r\nif errorlevel 1 pause\r\n'
        command.write_text(script, encoding="utf-8", newline="")
        # Use environment variables instead of interpolating paths into PowerShell code.
        environment = os.environ.copy()
        environment["ANM_SETUP_SHORTCUT_TARGET"] = str(command)
        environment["ANM_SETUP_SHORTCUT_ROOT"] = str(root)
        powershell = shutil.which("powershell.exe")
        if powershell:
            subprocess.run([powershell, "-NoProfile", "-NonInteractive", "-Command", "$desktop=[Environment]::GetFolderPath('Desktop'); if ($desktop) { $s=(New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $desktop 'ANM Player.lnk')); $s.TargetPath=$env:ANM_SETUP_SHORTCUT_TARGET; $s.WorkingDirectory=$env:ANM_SETUP_SHORTCUT_ROOT; $s.Save() }"], env=environment, check=False, capture_output=True)
    else:
        extension = ".command" if sys.platform == "darwin" else ".sh"
        command = root / ("Start ANM Player" + extension)
        values = runtime_environment(root, root / "tools" / "node" / "bin", root / "tools" / "bin")
        exports = "\n".join("export " + key + "=" + shlex.quote(value) for key, value in values.items() if key.startswith("UV_") or key == "ANM_INSTALL_ROOT")
        script = "#!/bin/sh\nset -eu\n" + exports + "\nexec " + shlex.quote(str(uv)) + " run --no-config --no-project --managed-python --python 3.13 " + shlex.quote(str(bootstrap)) + " --root " + shlex.quote(str(root)) + ' "$@"\n'
        command.write_text(script, encoding="utf-8")
        command.chmod(0o755)
        desktop = Path.home() / "Desktop"
        if desktop.is_dir():
            if sys.platform == "darwin":
                shortcut = desktop / "ANM Player.command"
                if not shortcut.exists():
                    shutil.copy2(command, shortcut)
            else:
                shortcut = desktop / "ANM Player.desktop"
                if not shortcut.exists():
                    escaped = str(command).replace("\\", "\\\\").replace('"', '\\"').replace("`", "\\`").replace("$", "\\$")
                    shortcut.write_text('[Desktop Entry]\nType=Application\nName=ANM Player\nComment=Open your music library\nExec=sh "' + escaped + '"\nIcon=multimedia-player\nTerminal=true\nCategories=AudioVideo;Audio;\n', encoding="utf-8")
                    shortcut.chmod(0o755)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--setup-only", action="store_true", default=os.environ.get("ANM_SETUP_ONLY") == "1")
    args = parser.parse_args(argv)
    try:
        root = (args.root or install_root()).expanduser().resolve()
        if any(character in str(root) for character in "\r\n"):
            raise SetupError("The setup folder cannot contain a line break.")
        root.mkdir(parents=True, exist_ok=True)
        (root / "tools").mkdir(exist_ok=True)
        platform_names()
        print(f"[setup] ANM Player lives in {root}", flush=True)
        with setup_lock(root):
            source = source_directory(root)
            node_bin = install_node(root)
            ffmpeg_bin = install_ffmpeg(root)
            prepare_environment(root, source)
            # The downloaded stable bootstrap is used by future desktop launches.
            own_file = Path(__file__).resolve()
            if own_file != root / "bootstrap.py":
                shutil.copyfile(own_file, root / "bootstrap.py")
            write_shortcuts(root)
            environment = runtime_environment(root, node_bin, ffmpeg_bin)
            arguments = [sys.executable, str(source / "scripts" / "start_aura.py")]
            if args.no_browser:
                arguments.append("--no-browser")
            if args.setup_only:
                arguments.append("--setup-only")
            checked(arguments, environment=environment, cwd=source)
        print("[setup] Ready. Use the ANM Player desktop shortcut next time.", flush=True)
        return 0
    except (OSError, ValueError, KeyError, SetupError, subprocess.SubprocessError, zipfile.BadZipFile, tarfile.TarError) as exc:
        print(f"\n[setup] {exc}\nYour music and settings have been kept. Run this setup again to retry.", file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
