#!/usr/bin/env python3
"""Prepare ANM Player in the current user's folder, then open it.

ANM Player uses this computer's own Python, Node.js and FFmpeg. Anything missing
or too old is installed system-wide with the platform's package manager. Only
the app's libraries (a Python venv and node_modules) live in the app folder.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import hashlib
import json
import os
import re
import secrets
import shlex
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath
from collections.abc import Iterator

REPOSITORY = "qa-p1/anm-player"
NODE_RANGE = (24, 26)
PYTHON_RANGE = ((3, 13), (3, 15))
DESKTOP_ID = "anm-player"


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


def tool_version(path: Path, *arguments: str) -> str | None:
    """First line of a tool's version output, or None when it can't run."""
    try:
        result = subprocess.run([str(path), *arguments], capture_output=True, text=True, timeout=20, check=False)
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode:
        return None
    output = (result.stdout or result.stderr).strip()
    return output.splitlines()[0] if output else ""


def node_supported(path: Path) -> bool:
    version = tool_version(path, "--version") or ""
    match = re.match(r"v?(\d+)\.", version)
    return bool(match) and NODE_RANGE[0] <= int(match.group(1)) <= NODE_RANGE[1]


def runs(path: Path) -> bool:
    return tool_version(path, "-version") is not None


def refresh_windows_path() -> None:
    """Pick up PATH changes from installers without needing a new window."""
    if os.name != "nt":
        return
    import winreg
    entries: list[str] = []
    for hive, key in ((winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment"), (winreg.HKEY_CURRENT_USER, "Environment")):
        try:
            with winreg.OpenKey(hive, key) as handle:
                value, _ = winreg.QueryValueEx(handle, "Path")
                entries.extend(os.path.expandvars(part) for part in str(value).split(";") if part)
        except OSError:
            continue
    current = os.environ.get("PATH", "").split(os.pathsep)
    os.environ["PATH"] = os.pathsep.join(dict.fromkeys([*entries, *current]))


def well_known_directories() -> list[Path]:
    """Where package managers put tools, even when PATH (or a desktop launch) misses them."""
    if os.name == "nt":
        program_files = Path(os.environ.get("ProgramFiles", "C:\\Program Files"))
        local = Path(os.environ.get("LOCALAPPDATA", ""))
        return [program_files / "nodejs", local / "Microsoft" / "WinGet" / "Links", Path(os.environ.get("ProgramData", "C:\\ProgramData")) / "chocolatey" / "bin"]
    directories = [Path("/usr/bin"), Path("/usr/local/bin")]
    if sys.platform == "darwin":
        directories = [Path("/opt/homebrew/bin"), Path("/opt/homebrew/opt/node@24/bin"), Path("/usr/local/opt/node@24/bin"), *directories]
    return directories


def find_tool(name: str, accept) -> Path | None:
    names = [name + ".exe", name + ".cmd", name] if os.name == "nt" else [name]
    directories = [Path(part) for part in os.environ.get("PATH", "").split(os.pathsep) if part] + well_known_directories()
    seen: set[Path] = set()
    for directory in directories:
        if directory in seen:
            continue
        seen.add(directory)
        for candidate_name in names:
            candidate = directory / candidate_name
            if candidate.is_file() and os.access(candidate, os.X_OK) and accept(candidate):
                return candidate
    return None


def privilege_prefix() -> list[str]:
    if os.name == "nt" or os.geteuid() == 0:
        return []
    if shutil.which("sudo"):
        interactive = sys.stdin is not None and sys.stdin.isatty()
        # Passwordless or recently-authorised sudo works even without a terminal.
        if interactive or subprocess.run(["sudo", "-n", "true"], capture_output=True, check=False).returncode == 0:
            return ["sudo"]
    # Started from the app launcher: ask through the desktop's password dialog.
    if shutil.which("pkexec"):
        return ["pkexec"]
    raise SetupError("ANM Player needs to install a missing program but can't ask for your password here. Run the setup file from a terminal once.")


def package_manager() -> str | None:
    order = ("winget", "choco") if os.name == "nt" else ("brew",) if sys.platform == "darwin" else ("pacman", "apt-get", "dnf", "zypper")
    return next((name for name in order if shutil.which(name)), None)


def apt_candidate_major(package: str) -> int:
    result = subprocess.run(["apt-cache", "policy", package], capture_output=True, text=True, check=False)
    match = re.search(r"Candidate:\s*(?:\d+:)?(\d+)\.", result.stdout)
    return int(match.group(1)) if match else 0


def pacman_version_major(package: str) -> int:
    result = subprocess.run(["pacman", "-Si", package], capture_output=True, text=True, check=False)
    match = re.search(r"^Version\s*:\s*(?:\d+:)?(\d+)\.", result.stdout, re.MULTILINE)
    return int(match.group(1)) if match else 0


def run_install(command: list[str], *, label: str) -> bool:
    print(f"[setup] {label}: {' '.join(command)}", flush=True)
    try:
        return subprocess.run(command, check=False).returncode == 0
    except OSError:
        return False


def install_system_tool(tool: str) -> None:
    """Install Node.js or FFmpeg system-wide with the platform package manager."""
    manager = package_manager()
    label = {"node": "Installing Node.js 24", "ffmpeg": "Installing FFmpeg"}[tool]
    if manager is None:
        raise SetupError(missing_tool_message(tool))
    print(f"[setup] {label} for this computer. You may be asked for {'permission' if os.name == 'nt' else 'your password'}.", flush=True)
    if os.name == "nt":
        # winget can be present but unusable (broken or blocked sources); Chocolatey is the fallback.
        installed = manager == "winget" and run_install(["winget", "install", "--id", {"node": "OpenJS.NodeJS.LTS", "ffmpeg": "Gyan.FFmpeg"}[tool], "--exact", "--silent", "--accept-package-agreements", "--accept-source-agreements"], label=label)
        if not installed and shutil.which("choco"):
            run_install(["choco", "install", "-y", {"node": "nodejs-lts", "ffmpeg": "ffmpeg"}[tool]], label=label)
        refresh_windows_path()
        return
    if manager == "brew":
        run_install(["brew", "install", {"node": "node@24", "ffmpeg": "ffmpeg"}[tool]], label=label)
        return
    sudo = privilege_prefix()
    if manager == "pacman":
        if tool == "ffmpeg":
            run_install([*sudo, "pacman", "-S", "--needed", "--noconfirm", "ffmpeg"], label=label)
        else:
            node = "nodejs" if NODE_RANGE[0] <= pacman_version_major("nodejs") <= NODE_RANGE[1] else "nodejs-lts-krypton"
            run_install([*sudo, "pacman", "-S", "--needed", "--noconfirm", node, "npm"], label=label)
    elif manager == "apt-get":
        apt = [*sudo, "env", "DEBIAN_FRONTEND=noninteractive", "apt-get"]  # never stop on a package prompt
        run_install([*apt, "update"], label="Refreshing package lists")
        if tool == "ffmpeg":
            run_install([*apt, "install", "-y", "ffmpeg"], label=label)
        else:
            if apt_candidate_major("nodejs") < NODE_RANGE[0]:
                # Debian/Ubuntu ship older Node.js; NodeSource is the official apt repository for 24.
                with tempfile.TemporaryDirectory() as temporary:
                    script = Path(temporary) / "nodesource.sh"
                    download("https://deb.nodesource.com/setup_24.x", script, max_bytes=2 * 1024 * 1024)
                    run_install([*sudo, "bash", str(script)], label="Adding the Node.js 24 package source")
            run_install([*apt, "install", "-y", "nodejs"], label=label)
    elif manager == "dnf":
        packages = (["ffmpeg"], ["ffmpeg-free"]) if tool == "ffmpeg" else (["nodejs24", "nodejs24-npm"], ["nodejs", "npm"])
        for names in packages:
            if run_install([*sudo, "dnf", "install", "-y", *names], label=label):
                break
    elif manager == "zypper":
        packages = (["ffmpeg"], ["ffmpeg-7"]) if tool == "ffmpeg" else (["nodejs24", "npm24"], ["nodejs", "npm"])
        for names in packages:
            if run_install([*sudo, "zypper", "--non-interactive", "install", *names], label=label):
                break


def missing_tool_message(tool: str) -> str:
    if tool == "node":
        return "Node.js 24 is required. Install it from https://nodejs.org (LTS) or your package manager, then open ANM Player again."
    return "FFmpeg is required. Install it with your package manager (or from https://ffmpeg.org), then open ANM Player again."


def ensure_system_tools() -> dict[str, Path]:
    """Return the system Node.js and FFmpeg folders, installing them if needed."""
    refresh_windows_path()
    found: dict[str, Path] = {}
    for tool in ("node", "ffmpeg"):
        def locate() -> Path | None:
            if tool == "node":
                node = find_tool("node", node_supported)
                npm_name = "npm.cmd" if os.name == "nt" else "npm"
                return node if node and (node.parent / npm_name).is_file() else None
            ffmpeg = find_tool("ffmpeg", runs)
            return ffmpeg if ffmpeg and runs(ffmpeg.parent / ("ffprobe.exe" if os.name == "nt" else "ffprobe")) else None
        path = locate()
        if path is None:
            install_system_tool(tool)
            path = locate()
        if path is None:
            raise SetupError(missing_tool_message(tool))
        found[tool] = path.parent
    return found


def tool_environment(root: Path, tools: dict[str, Path]) -> dict[str, str]:
    """The launcher sees exactly the system tools that setup verified."""
    environment = os.environ.copy()
    for key in [key for key in environment if key.startswith("UV_")]:
        environment.pop(key)
    leading = list(dict.fromkeys(str(path) for path in (tools["node"], tools["ffmpeg"])))
    remaining = [part for part in environment.get("PATH", "").split(os.pathsep) if part and part not in leading]
    environment["PATH"] = os.pathsep.join([*leading, *remaining])
    environment["ANM_INSTALL_ROOT"] = str(root)
    return environment


def system_python() -> Path | None:
    """A supported Python that belongs to this computer, not an old private copy."""
    def supported(path: Path) -> bool:
        version = tool_version(path, "-c", "import sys; print('%d.%d' % sys.version_info[:2])") or ""
        try:
            major, minor = (int(part) for part in version.split("."))
        except ValueError:
            return False
        return PYTHON_RANGE[0] <= (major, minor) < PYTHON_RANGE[1]
    if os.name == "nt":
        launcher = shutil.which("py")
        for flag in ("-3.14", "-3.13"):
            if launcher and tool_version(Path(launcher), flag, "-c", "import sys; print(sys.executable)"):
                result = subprocess.run([launcher, flag, "-c", "import sys; print(sys.executable)"], capture_output=True, text=True, check=False)
                candidate = Path(result.stdout.strip())
                if candidate.is_file():
                    return candidate
    for name in ("python3.14", "python3.13", "python3", "python"):
        candidate = find_tool(name, supported)
        if candidate is not None and "WindowsApps" not in str(candidate):
            return candidate
    return None


def check_python() -> None:
    low, high = PYTHON_RANGE
    if not low <= sys.version_info[:2] < high:
        raise SetupError(f"ANM Player needs Python 3.13 or 3.14; this is Python {sys.version.split()[0]}. Run the setup file again to install a supported Python.")
    try:
        import ensurepip  # noqa: F401  (Debian splits venv support into python3-venv)
        import venv  # noqa: F401
    except ImportError as exc:
        raise SetupError("This Python can't create app environments. Install the python3-venv package, then run setup again.") from exc


def retire_private_tools(root: Path) -> None:
    """Older setups downloaded their own Python, Node and FFmpeg into tools/.

    Stop an app still running on them, drop app environments built from that
    private Python (they're rebuilt from the system Python), and remove tools/.
    """
    tools = root / "tools"
    if not tools.is_dir() or tools.is_symlink():
        return
    print("[setup] Switching ANM Player to this computer's own Python, Node.js and FFmpeg…", flush=True)
    sources = [root / "app", *(sorted((root / "releases").iterdir()) if (root / "releases").is_dir() else [])]
    stop_running_app(root, active_source(root))
    for source in sources:
        venv = source / "apps" / "api" / ".venv"
        if not venv.is_dir() or venv.is_symlink():
            continue
        configuration = venv / "pyvenv.cfg"
        try:
            home = next((line.split("=", 1)[1].strip() for line in configuration.read_text(encoding="utf-8").splitlines() if line.split("=", 1)[0].strip() == "home"), "")
        except OSError:
            home = ""
        if not home or Path(home).resolve().is_relative_to(tools.resolve()):
            shutil.rmtree(venv)
            (source / ".aura" / "launcher-dependencies.json").unlink(missing_ok=True)
    shutil.rmtree(tools)
    for leftover in ("Start ANM Player.sh", "Start ANM Player.command", "Start ANM Player.cmd"):
        (root / leftover).unlink(missing_ok=True)

def active_source(root: Path) -> Path:
    pointer = root / "current.json"
    try:
        return Path(json.loads(pointer.read_text(encoding="utf-8"))["root"]) if pointer.is_file() else root / "app"
    except (OSError, ValueError, KeyError, TypeError):
        return root / "app"


def stop_running_app(root: Path, source: Path) -> None:
    if (source / "scripts" / "start_aura.py").is_file():
        environment = {**os.environ, "ANM_INSTALL_ROOT": str(root)}
        subprocess.run([sys.executable, str(source / "scripts" / "start_aura.py"), "--stop"], cwd=source, env=environment, check=False, capture_output=True, timeout=120)


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


def desktop_exec_argument(value: str) -> str:
    """Quote one Exec argument per the freedesktop Desktop Entry spec."""
    quoted = '"' + "".join("\\" + character if character in '"`$\\' else character for character in value) + '"'
    return quoted.replace("\\", "\\\\").replace("%", "%%")


def user_desktop_folder() -> Path | None:
    if os.name == "nt":
        return None
    candidate: Path | None = None
    if sys.platform != "darwin" and shutil.which("xdg-user-dir"):
        result = subprocess.run(["xdg-user-dir", "DESKTOP"], capture_output=True, text=True, check=False)
        value = result.stdout.strip()
        if value and Path(value) != Path.home():
            candidate = Path(value)
    candidate = candidate or Path.home() / "Desktop"
    return candidate if candidate.is_dir() else None


def owned_shortcut(path: Path, root: Path) -> bool:
    """Only replace shortcuts that ANM Player created (now or by older setups)."""
    if not path.exists() and not path.is_symlink():
        return True
    try:
        text = path.read_text(encoding="utf-8", errors="replace") if path.is_file() else ""
    except OSError:
        return False
    return "X-ANM-Player=true" in text or str(root) in text


def write_launch_script(root: Path, icon: Path) -> Path:
    """A tiny launcher that finds this computer's Python each time it runs."""
    script = root / "launch.sh"
    quoted_root = shlex.quote(str(root))
    script.write_text(f"""#!/bin/sh
# Opens ANM Player with this computer's own Python. Written by ANM Player setup.
ROOT={quoted_root}
PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export PATH

notify() {{
  if command -v notify-send >/dev/null 2>&1; then
    notify-send --app-name="ANM Player" --icon={shlex.quote(str(icon))} "ANM Player" "$1" 2>/dev/null || true
  elif command -v osascript >/dev/null 2>&1; then
    osascript -e 'on run argv' -e 'display notification (item 1 of argv) with title "ANM Player"' -e 'end run' "$1" >/dev/null 2>&1 || true
  fi
}}

for python in python3.14 python3.13 python3; do
  if command -v "$python" >/dev/null 2>&1 && "$python" -c 'import sys; sys.exit(not (3, 13) <= sys.version_info[:2] < (3, 15))' 2>/dev/null; then
    if [ -t 1 ]; then
      exec "$python" "$ROOT/bootstrap.py" --root "$ROOT" "$@"
    fi
    if "$python" "$ROOT/bootstrap.py" --root "$ROOT" "$@" >"$ROOT/launch.log" 2>&1; then
      exit 0
    fi
    notify "ANM Player couldn't start. Details are in $ROOT/launch.log"
    exit 1
  fi
done
notify "ANM Player needs Python 3.13 or 3.14. Run the ANM Player setup file again to install it."
exit 1
""", encoding="utf-8")
    script.chmod(0o755)
    return script


def write_linux_shortcuts(root: Path, launcher: Path, icon: Path) -> None:
    entry = "\n".join([
        "[Desktop Entry]",
        "Type=Application",
        "Version=1.5",
        "Name=ANM Player",
        "GenericName=Music Player",
        "Comment=Play and organise your music",
        "Exec=" + desktop_exec_argument(str(launcher)),
        "Icon=" + str(icon),
        "Terminal=false",
        "StartupNotify=false",
        "Categories=AudioVideo;Audio;Player;",
        "Keywords=music;player;songs;playlist;",
        "X-ANM-Player=true",
        "",
    ])
    data_home = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share")
    applications = data_home / "applications"
    applications.mkdir(parents=True, exist_ok=True)
    targets = [applications / f"{DESKTOP_ID}.desktop"]
    desktop = user_desktop_folder()
    if desktop is not None:
        targets.append(desktop / "ANM Player.desktop")
    for target in targets:
        if not owned_shortcut(target, root):
            continue
        target.write_text(entry, encoding="utf-8")
        target.chmod(0o755)
        if target.parent == desktop and shutil.which("gio"):
            # GNOME/Nautilus only launches desktop files that are marked trusted.
            subprocess.run(["gio", "set", str(target), "metadata::trusted", "true"], capture_output=True, check=False)
    if shutil.which("update-desktop-database"):
        subprocess.run(["update-desktop-database", str(applications)], capture_output=True, check=False)


def write_macos_shortcuts(root: Path, launcher: Path, icon: Path) -> None:
    bundle = Path.home() / "Applications" / "ANM Player.app"
    marker = bundle / "Contents" / "Resources" / "anm-player-setup"
    if bundle.exists() and not marker.exists():
        return  # Someone else's app with the same name; leave it alone.
    executable = bundle / "Contents" / "MacOS" / "ANM Player"
    executable.parent.mkdir(parents=True, exist_ok=True)
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text(str(root) + "\n", encoding="utf-8")
    if icon.is_file():
        shutil.copyfile(icon, marker.parent / icon.name)
    executable.write_text("#!/bin/sh\nexec " + shlex.quote(str(launcher)) + ' "$@"\n', encoding="utf-8")
    executable.chmod(0o755)
    (bundle / "Contents" / "Info.plist").write_text("""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>ANM Player</string>
<key>CFBundleDisplayName</key><string>ANM Player</string>
<key>CFBundleIdentifier</key><string>io.github.qa-p1.anm-player</string>
<key>CFBundleExecutable</key><string>ANM Player</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>LSUIElement</key><true/>
</dict></plist>
""", encoding="utf-8")
    desktop = user_desktop_folder()
    if desktop is not None:
        link = desktop / "ANM Player.app"
        legacy = desktop / "ANM Player.command"
        if legacy.is_file() and owned_shortcut(legacy, root):
            legacy.unlink()
        if not link.exists() and not link.is_symlink():
            link.symlink_to(bundle)


def write_windows_shortcuts(root: Path) -> None:
    pythonw = shutil.which("pyw") or str(Path(sys.executable).with_name("pythonw.exe"))
    arguments = ("-3 " if Path(pythonw).name.lower() == "pyw.exe" else "") + subprocess.list2cmdline([str(root / "bootstrap.py"), "--root", str(root)])
    environment = os.environ.copy()
    environment.update({
        "ANM_SHORTCUT_TARGET": pythonw,
        "ANM_SHORTCUT_ARGUMENTS": arguments,
        "ANM_SHORTCUT_ROOT": str(root),
        "ANM_SHORTCUT_ICON": str(root / "anm-player.ico"),
    })
    # Values travel through environment variables, never interpolated into code.
    command = (
        "$shell = New-Object -ComObject WScript.Shell; "
        "$places = @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Desktop')); "
        "foreach ($place in $places) { if ($place) { "
        "$s = $shell.CreateShortcut((Join-Path $place 'ANM Player.lnk')); "
        "$s.TargetPath = $env:ANM_SHORTCUT_TARGET; $s.Arguments = $env:ANM_SHORTCUT_ARGUMENTS; "
        "$s.WorkingDirectory = $env:ANM_SHORTCUT_ROOT; $s.IconLocation = $env:ANM_SHORTCUT_ICON; "
        "$s.Description = 'Play and organise your music'; $s.Save() } }"
    )
    powershell = shutil.which("powershell.exe")
    if powershell:
        subprocess.run([powershell, "-NoProfile", "-NonInteractive", "-Command", command], env=environment, check=False, capture_output=True)
    (root / "Start ANM Player.cmd").unlink(missing_ok=True)


def install_icon(root: Path, source: Path) -> Path:
    """Copy the app icon next to the launcher (older app copies only have the SVG)."""
    public = source / "apps" / "web" / "public"
    if (public / "icon.ico").is_file():
        shutil.copyfile(public / "icon.ico", root / "anm-player.ico")
    for name, target in (("icon-512.png", "anm-player.png"), ("favicon.svg", "anm-player.svg")):
        if (public / name).is_file():
            shutil.copyfile(public / name, root / target)
            return root / target
    return root / "anm-player.png"


def write_shortcuts(root: Path, source: Path) -> None:
    icon = install_icon(root, source)
    if os.name == "nt":
        write_windows_shortcuts(root)
        return
    launcher = write_launch_script(root, icon)
    if sys.platform == "darwin":
        write_macos_shortcuts(root, launcher, icon)
    else:
        write_linux_shortcuts(root, launcher, icon)


# Everything ANM Player keeps in a data folder; anything else there is the user's.
MANAGED_DATA = ("music", "downloads", "cache", "config", "thumbnails", "logs", "aura.db", "aura.db-wal", "aura.db-shm", "aura.db-journal")


def process_alive(pid: int) -> bool:
    if os.name == "nt":
        import ctypes
        kernel32 = ctypes.windll.kernel32
        handle = kernel32.OpenProcess(0x00101000, False, pid)  # SYNCHRONIZE | QUERY_LIMITED_INFORMATION
        if not handle:
            return False
        try:
            return kernel32.WaitForSingleObject(handle, 0) == 0x102  # WAIT_TIMEOUT: still running
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def remove_path(path: Path) -> None:
    def make_writable(function, target, _error) -> None:
        os.chmod(target, stat.S_IWRITE)
        function(target)

    for attempt in range(10):
        try:
            if path.is_dir() and not path.is_symlink():
                shutil.rmtree(path, onexc=make_writable)
            else:
                path.unlink(missing_ok=True)
            return
        except FileNotFoundError:
            return
        except OSError:
            if attempt == 9:
                raise
            time.sleep(1)  # Windows keeps files locked briefly after a process exits.


def configured_data_root(root: Path) -> Path:
    try:
        value = json.loads((root / "storage-state.json").read_text(encoding="utf-8")).get("data_root")
    except (OSError, ValueError, AttributeError):
        value = None
    return Path(value).resolve() if isinstance(value, str) and value else (root / "data").resolve()


def remove_shortcuts(root: Path) -> None:
    if os.name == "nt":
        command = (
            "$shell = New-Object -ComObject WScript.Shell; "
            "foreach ($place in @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Desktop'))) { if ($place) { "
            "$path = Join-Path $place 'ANM Player.lnk'; "
            "if ((Test-Path -LiteralPath $path) -and $shell.CreateShortcut($path).WorkingDirectory -eq $env:ANM_SHORTCUT_ROOT) { Remove-Item -LiteralPath $path } } }"
        )
        powershell = shutil.which("powershell.exe")
        if powershell:
            subprocess.run([powershell, "-NoProfile", "-NonInteractive", "-Command", command], env={**os.environ, "ANM_SHORTCUT_ROOT": str(root)}, check=False, capture_output=True)
        return
    desktop = user_desktop_folder()
    if sys.platform == "darwin":
        bundle = Path.home() / "Applications" / "ANM Player.app"
        if (bundle / "Contents" / "Resources" / "anm-player-setup").is_file():
            remove_path(bundle)
        link = desktop / "ANM Player.app" if desktop else None
        if link is not None and link.is_symlink() and Path(os.readlink(link)) == bundle:
            link.unlink()
        return
    applications = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share") / "applications"
    for shortcut in (applications / f"{DESKTOP_ID}.desktop", *([desktop / "ANM Player.desktop"] if desktop else [])):
        if shortcut.is_file() and owned_shortcut(shortcut, root):
            shortcut.unlink()
    if shutil.which("update-desktop-database") and applications.is_dir():
        subprocess.run(["update-desktop-database", str(applications)], capture_output=True, check=False)


def uninstall(root: Path, *, keep_data: bool) -> None:
    """Remove the app and its shortcuts; optionally keep the music library for a reinstall."""
    protected = {Path.home().resolve(), Path(root.anchor).resolve()}
    markers = (root / "bootstrap.py", root / "current.json", root / "app" / "scripts" / "start_aura.py")
    if root in protected or not any(marker.exists() for marker in markers):
        raise SetupError(f"{root} does not look like an ANM Player installation, so nothing was removed.")
    stop_running_app(root, active_source(root))
    remove_shortcuts(root)
    data = configured_data_root(root)
    keep: set[Path] = set()
    if keep_data:
        # The state file remembers a data folder that was moved elsewhere.
        keep.add(root / "storage-state.json")
        if data.is_relative_to(root) and data != root:
            keep.add(root / data.relative_to(root).parts[0])
    elif not data.is_relative_to(root) and data not in protected:
        for name in MANAGED_DATA:
            remove_path(data / name)
        try:
            data.rmdir()
        except OSError:
            pass  # The folder also holds files that aren't ANM Player's.
    for entry in list(root.iterdir()):
        if entry not in keep:
            remove_path(entry)
    if not keep:
        root.rmdir()


def notify(message: str) -> None:
    if sys.platform == "darwin":
        subprocess.run(["osascript", "-e", "on run argv", "-e", "display notification (item 1 of argv) with title \"ANM Player\"", "-e", "end run", message], capture_output=True, check=False)
    elif os.name != "nt" and shutil.which("notify-send"):
        subprocess.run(["notify-send", "--app-name=ANM Player", "ANM Player", message], capture_output=True, check=False)


def run_uninstall(root: Path, *, keep_data: bool, wait_pid: int | None) -> int:
    if wait_pid:
        deadline = time.monotonic() + 120
        while process_alive(wait_pid) and time.monotonic() < deadline:
            time.sleep(0.5)
    try:
        uninstall(root, keep_data=keep_data)
    except (OSError, SetupError) as exc:
        message = f"ANM Player could not be fully removed: {exc}"
        print(f"[uninstall] {message}", file=sys.stderr, flush=True)
        if os.name == "nt" and sys.stdout is None:
            import ctypes
            ctypes.windll.user32.MessageBoxW(None, message, "ANM Player", 0x10)
        else:
            notify(message)
        return 1
    message = f"ANM Player was removed. Your music and settings are still in {configured_data_root(root)}." if keep_data else "ANM Player and all of its data were removed."
    print(f"[uninstall] {message}", flush=True)
    notify(message)
    return 0


def report_failure(message: str) -> None:
    print(f"\n[setup] {message}\nYour music and settings have been kept. Run this setup again to retry.", file=sys.stderr, flush=True)
    if os.name == "nt" and sys.stdout is None:
        # Started from the Start menu with pythonw: there is no console to read.
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, message, "ANM Player", 0x10)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--setup-only", action="store_true", default=os.environ.get("ANM_SETUP_ONLY") == "1")
    parser.add_argument("--uninstall", action="store_true", help="remove ANM Player and its shortcuts")
    parser.add_argument("--keep-data", action="store_true", help="with --uninstall, keep the music library and settings")
    parser.add_argument("--wait-pid", type=int, help=argparse.SUPPRESS)
    # Launcher options such as --stop or --foreground pass straight through.
    args, launcher_options = parser.parse_known_args(argv)
    if args.uninstall:
        return run_uninstall((args.root or install_root()).expanduser().resolve(), keep_data=args.keep_data, wait_pid=args.wait_pid)
    try:
        check_python()
        root = (args.root or install_root()).expanduser().resolve()
        if any(character in str(root) for character in "\r\n"):
            raise SetupError("The setup folder cannot contain a line break.")
        root.mkdir(parents=True, exist_ok=True)
        print(f"[setup] ANM Player lives in {root}", flush=True)
        if Path(sys.executable).resolve().is_relative_to((root / "tools").resolve()):
            # An older shortcut started the private Python that setup is about to retire.
            replacement = system_python()
            if replacement is not None:
                arguments = [str(replacement), str(Path(__file__).resolve()), *(argv if argv is not None else sys.argv[1:])]
                return subprocess.run(arguments, env={key: value for key, value in os.environ.items() if not key.startswith("UV_")}, check=False).returncode
        with setup_lock(root):
            tools = ensure_system_tools()
            if not Path(sys.executable).resolve().is_relative_to((root / "tools").resolve()):
                retire_private_tools(root)
            source = source_directory(root)
            prepare_environment(root, source)
            # The downloaded stable bootstrap is used by future launches.
            own_file = Path(__file__).resolve()
            if own_file != root / "bootstrap.py":
                shutil.copyfile(own_file, root / "bootstrap.py")
            write_shortcuts(root, source)
            arguments = [sys.executable, str(source / "scripts" / "start_aura.py")]
            if args.no_browser:
                arguments.append("--no-browser")
            if args.setup_only:
                arguments.append("--setup-only")
            arguments.extend(launcher_options)
            checked(arguments, environment=tool_environment(root, tools), cwd=source)
        print("[setup] Ready. Open ANM Player from your app launcher next time.", flush=True)
        return 0
    except (OSError, ValueError, KeyError, SetupError, subprocess.SubprocessError, zipfile.BadZipFile) as exc:
        report_failure(str(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
