#!/usr/bin/env python3
"""Set up and run ANM Player's native API and web development servers."""

from __future__ import annotations

import argparse
import atexit
import hashlib
import http.server
import json
import os
import re
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path
from typing import Iterable
from urllib.parse import urlparse


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
API_ROOT = REPOSITORY_ROOT / "apps" / "api"
VENV_ROOT = API_ROOT / ".venv"
STAMP_FILE = REPOSITORY_ROOT / ".aura" / "launcher-dependencies.json"
RUNTIME_FILE = REPOSITORY_ROOT / ".aura" / "launcher-runtime.json"
LOG_FILE = REPOSITORY_ROOT / ".aura" / "launcher.log"
DEPENDENCY_FILES = (
    REPOSITORY_ROOT / "package.json",
    REPOSITORY_ROOT / "package-lock.json",
    REPOSITORY_ROOT / "apps" / "web" / "package.json",
    API_ROOT / "requirements.txt",
)
SUPPORTED_PYTHON = (3, 13)
MINIMUM_NODE_MAJOR = 24
MAXIMUM_NODE_MAJOR = 26
PLACEHOLDER_TOKENS = {
    "change-me",
    "replace-me",
    "replace-with-a-long-random-token",
    "your-token-here",
}


class LauncherError(RuntimeError):
    """A setup or runtime failure that can be explained without a traceback."""


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="start-anm-player", description=__doc__)
    parser.add_argument("--no-browser", action="store_true", help="Do not open ANM Player in the default browser")
    parser.add_argument("--setup-only", action="store_true", help="Install and configure ANM Player without starting it")
    parser.add_argument("--force-install", action="store_true", help="Reinstall Python and npm dependencies")
    parser.add_argument("--foreground", action="store_true", help="Keep servers and logs in this terminal (Ctrl+C to stop)")
    parser.add_argument("--stop", action="store_true", help="Stop the background ANM Player instance for this checkout")
    parser.add_argument("--background-worker", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--ready-file", type=Path, help=argparse.SUPPRESS)
    parser.add_argument("--api-port", type=valid_port, default=8000, help="Loopback API port (default: 8000)")
    parser.add_argument("--web-port", type=valid_port, default=5173, help="Loopback web port (default: 5173)")
    return parser.parse_args(argv)


def valid_port(value: str) -> int:
    port = int(value)
    if not 1 <= port <= 65535:
        raise argparse.ArgumentTypeError("port must be between 1 and 65535")
    return port


def venv_python() -> Path:
    return VENV_ROOT / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def npm_command() -> str:
    command = "npm.cmd" if os.name == "nt" else "npm"
    resolved = shutil.which(command)
    if not resolved:
        raise LauncherError("npm was not found. Install Node.js 24 LTS, then run the launcher again.")
    return resolved


def check_prerequisites() -> None:
    if sys.version_info < SUPPORTED_PYTHON or sys.version_info >= (3, 15):
        raise LauncherError(
            f"ANM Player requires Python 3.13 or 3.14; this launcher is using {sys.version.split()[0]}."
        )
    node = shutil.which("node")
    if not node:
        raise LauncherError("Node.js was not found. Install Node.js 24 LTS, then run the launcher again.")
    npm_command()
    if not shutil.which("ffmpeg"):
        raise LauncherError("FFmpeg was not found on PATH. Install FFmpeg, then run the launcher again.")
    result = subprocess.run(
        [node, "--version"],
        cwd=REPOSITORY_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    try:
        major = int(result.stdout.strip().lstrip("v").split(".", 1)[0])
    except (ValueError, IndexError) as exc:
        raise LauncherError("Could not determine the installed Node.js version.") from exc
    if result.returncode or not MINIMUM_NODE_MAJOR <= major <= MAXIMUM_NODE_MAJOR:
        raise LauncherError(
            f"ANM Player supports Node.js 24 through 26; found {result.stdout.strip() or 'an unknown version'}."
        )


def dependency_fingerprint() -> str:
    digest = hashlib.sha256()
    for path in DEPENDENCY_FILES:
        if not path.is_file():
            raise LauncherError(f"Required dependency file is missing: {path.relative_to(REPOSITORY_ROOT)}")
        digest.update(path.relative_to(REPOSITORY_ROOT).as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def dependencies_current(fingerprint: str) -> bool:
    if not venv_python().is_file() or not (REPOSITORY_ROOT / "node_modules").is_dir():
        return False
    try:
        payload = json.loads(STAMP_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return False
    return payload.get("fingerprint") == fingerprint


def run_checked(
    arguments: list[str],
    *,
    cwd: Path,
    label: str,
    env: dict[str, str] | None = None,
) -> None:
    print(f"[setup] {label}", flush=True)
    result = subprocess.run(arguments, cwd=cwd, env=env, check=False)
    if result.returncode:
        raise LauncherError(f"{label} failed with exit code {result.returncode}.")


def install_dependencies(*, force: bool) -> None:
    fingerprint = dependency_fingerprint()
    if not force and dependencies_current(fingerprint):
        print("[setup] Dependencies are unchanged; skipping installation.", flush=True)
        return
    if not venv_python().is_file():
        run_checked([sys.executable, "-m", "venv", str(VENV_ROOT)], cwd=API_ROOT, label="Creating Python environment")
    run_checked(
        [str(venv_python()), "-m", "pip", "install", "--requirement", str(API_ROOT / "requirements.txt")],
        cwd=API_ROOT,
        label="Installing Python dependencies",
    )
    run_checked([npm_command(), "ci"], cwd=REPOSITORY_ROOT, label="Installing frontend dependencies")
    STAMP_FILE.parent.mkdir(parents=True, exist_ok=True)
    STAMP_FILE.write_text(
        json.dumps({"fingerprint": fingerprint}, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def read_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def ensure_environment() -> dict[str, str]:
    example = REPOSITORY_ROOT / ".env.example"
    env_file = REPOSITORY_ROOT / ".env"
    if not env_file.exists():
        if not example.is_file():
            raise LauncherError(".env.example is missing; the release checkout is incomplete.")
        env_file.write_text(example.read_text(encoding="utf-8"), encoding="utf-8", newline="\n")
        print("[setup] Created .env from .env.example.", flush=True)

    content = env_file.read_text(encoding="utf-8")
    values = read_env(env_file)
    token = values.get("API_ACCESS_TOKEN", "").strip()
    if not token:
        token = secrets.token_urlsafe(48)
        lines = content.splitlines()
        replaced = False
        for index, line in enumerate(lines):
            if line.strip().startswith("API_ACCESS_TOKEN="):
                lines[index] = f"API_ACCESS_TOKEN={token}"
                replaced = True
                break
        if not replaced:
            lines.append(f"API_ACCESS_TOKEN={token}")
        env_file.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
        print("[setup] Generated a local API access token.", flush=True)
        values["API_ACCESS_TOKEN"] = token
    elif token.casefold() in PLACEHOLDER_TOKENS:
        raise LauncherError(
            "The existing .env contains a placeholder API_ACCESS_TOKEN. Replace it with a URL-safe secret, "
            "or remove that value and rerun the launcher."
        )
    elif not re.fullmatch(r"[A-Za-z0-9_-]{32,256}", token):
        raise LauncherError(
            "The existing API_ACCESS_TOKEN must contain 32-256 URL-safe letters, numbers, underscores, or dashes."
        )

    for key, fallback in (("AURA_DATA_ROOT", "./data"), ("AURA_STATE_FILE", "./.aura/storage-state.json")):
        configured = Path(values.get(key, fallback)).expanduser()
        resolved = configured if configured.is_absolute() else REPOSITORY_ROOT / configured
        directory = resolved if key == "AURA_DATA_ROOT" else resolved.parent
        directory.resolve().mkdir(parents=True, exist_ok=True)
    return values


def run_migrations(values: dict[str, str]) -> None:
    environment = os.environ.copy()
    environment.update(values)
    run_checked(
        [str(venv_python()), "-m", "alembic", "upgrade", "head"],
        cwd=API_ROOT,
        label="Applying database migrations",
        env=environment,
    )


def require_available_ports(api_port: int, web_port: int) -> None:
    if api_port == web_port:
        raise LauncherError("The API and web ports must be different.")
    for label, port in (("API", api_port), ("web", web_port)):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            _configure_port_probe(probe)
            try:
                probe.bind(("127.0.0.1", port))
            except OSError as exc:
                raise LauncherError(
                    f"The {label} port {port} is already in use. Stop the existing process or choose another port."
                ) from exc


def wait_for_ports_free(ports: Iterable[int], *, timeout: float = 15) -> None:
    """Wait until every managed listener has released its port."""
    unique_ports = tuple(dict.fromkeys(ports))
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            require_available_ports(*unique_ports) if len(unique_ports) == 2 else _probe_ports(unique_ports)
            return
        except LauncherError:
            time.sleep(0.2)
    _probe_ports(unique_ports)


def _probe_ports(ports: Iterable[int]) -> None:
    for port in ports:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            _configure_port_probe(probe)
            try:
                probe.bind(("127.0.0.1", port))
            except OSError as exc:
                raise LauncherError(f"Port {port} is still in use after ANM Player stopped.") from exc


def _configure_port_probe(probe: socket.socket) -> None:
    """Make a probe ignore POSIX TIME_WAIT without weakening Windows checks."""
    if os.name != "nt":
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        return
    exclusive = getattr(socket, "SO_EXCLUSIVEADDRUSE", None)
    if exclusive is not None:
        probe.setsockopt(socket.SOL_SOCKET, exclusive, 1)


def urlparse_port(url: str, *, default: int) -> int:
    try:
        port = urlparse(url).port
    except ValueError:
        port = None
    return port or default


def child_process(arguments: list[str], *, cwd: Path, env: dict[str, str]) -> subprocess.Popen[str]:
    options: dict[str, object] = {
        "cwd": cwd,
        "env": env,
        "stdout": subprocess.PIPE,
        "stderr": subprocess.STDOUT,
        "text": True,
        "encoding": "utf-8",
        "errors": "replace",
        "bufsize": 1,
    }
    if os.name == "nt":
        options["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW
    else:
        options["start_new_session"] = True
    return subprocess.Popen(arguments, **options)  # type: ignore[arg-type]


def stream_output(process: subprocess.Popen[str], prefix: str) -> None:
    assert process.stdout is not None
    for line in process.stdout:
        message = f"[{prefix}] {line.rstrip()}"
        encoding = getattr(sys.stdout, "encoding", None) or "utf-8"
        safe_message = message.encode(encoding, errors="replace").decode(encoding)
        print(safe_message, flush=True)


def wait_until_ready(
    url: str, processes: Iterable[subprocess.Popen[str]], *, timeout: float = 90,
    stop_requested: threading.Event | None = None,
) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if stop_requested is not None and stop_requested.is_set():
            raise KeyboardInterrupt
        for process in processes:
            if process.poll() is not None:
                raise LauncherError(f"A child process exited with code {process.returncode} before ANM Player was ready.")
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if 200 <= response.status < 400:
                    return
        except (OSError, urllib.error.URLError):
            pass
        time.sleep(0.25)
    raise LauncherError(f"Timed out waiting for {url}.")


def stop_process_tree(process: subprocess.Popen[str], *, timeout: float = 5) -> None:
    if os.name == "nt":
        if process.poll() is not None:
            return
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    else:
        try:
            os.killpg(process.pid, signal.SIGTERM)
            process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


def serve(
    *, api_port: int, web_port: int, open_browser: bool, values: dict[str, str],
    ready_file: Path | None = None,
) -> int:
    require_available_ports(api_port, web_port)
    environment = os.environ.copy()
    environment.update(values)
    environment["API_ENV"] = "development"
    environment["AURA_API_PORT"] = str(api_port)
    processes: list[subprocess.Popen[str]] = []
    stop_requested = threading.Event()
    control: http.server.ThreadingHTTPServer | None = None
    control_token: str | None = None

    def cleanup() -> None:
        for process in reversed(processes):
            stop_process_tree(process)

    atexit.register(cleanup)
    previous_sigbreak = None
    previous_sigterm = signal.getsignal(signal.SIGTERM)

    def handle_shutdown(_signum: int, _frame: object) -> None:
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, handle_shutdown)
    if os.name == "nt" and hasattr(signal, "SIGBREAK"):
        previous_sigbreak = signal.getsignal(signal.SIGBREAK)

        def handle_sigbreak(_signum: int, _frame: object) -> None:
            raise KeyboardInterrupt

        signal.signal(signal.SIGBREAK, handle_sigbreak)
    try:
        browser_url = f"http://127.0.0.1:{web_port}/"
        # Register shutdown before spawning children, including foreground runs.
        control, control_token = start_control_server(stop_requested, browser_url, api_port=api_port)
        environment["ANM_LAUNCHER_CONTROL_PORT"] = str(control.server_port)
        environment["ANM_LAUNCHER_CONTROL_TOKEN"] = control_token
        api = child_process(
            [str(venv_python()), "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(api_port)],
            cwd=API_ROOT,
            env=environment,
        )
        processes.append(api)
        web = child_process(
            [npm_command(), "run", "dev", "--workspace", "apps/web", "--", "--host", "127.0.0.1", "--port", str(web_port), "--strictPort"],
            cwd=REPOSITORY_ROOT,
            env=environment,
        )
        processes.append(web)
        threading.Thread(target=stream_output, args=(api, "api"), daemon=True).start()
        threading.Thread(target=stream_output, args=(web, "web"), daemon=True).start()

        wait_until_ready(f"http://127.0.0.1:{api_port}/api/v1/health", processes, stop_requested=stop_requested)
        wait_until_ready(browser_url, processes, stop_requested=stop_requested)
        if stop_requested.is_set():
            return 0
        print(f"[anm-player] Ready at {browser_url}", flush=True)
        if ready_file is not None:
            ready_file.write_text("ready", encoding="utf-8")
        if open_browser:
            webbrowser.open(browser_url)

        while not stop_requested.wait(0.25):
            for process in processes:
                return_code = process.poll()
                if return_code is not None:
                    raise LauncherError(f"A child process stopped unexpectedly with exit code {return_code}.")
        print("[anm-player] Stopping ANM Player…", flush=True)
        return 0
    except KeyboardInterrupt:
        print("\n[anm-player] Stopping ANM Player…", flush=True)
        return 0
    finally:
        cleanup()
        if control is not None:
            control.shutdown()
            control.server_close()
            runtime = read_runtime()
            if runtime and runtime.get("token") == control_token:
                RUNTIME_FILE.unlink(missing_ok=True)
        if previous_sigbreak is not None:
            signal.signal(signal.SIGBREAK, previous_sigbreak)
        signal.signal(signal.SIGTERM, previous_sigterm)
        atexit.unregister(cleanup)


def read_runtime() -> dict[str, object] | None:
    try:
        runtime = json.loads(RUNTIME_FILE.read_text(encoding="utf-8"))
        if not isinstance(runtime, dict):
            return None
        port = runtime.get("control_port")
        if (
            not isinstance(port, int) or not 1 <= port <= 65535
            or not isinstance(runtime.get("token"), str) or not isinstance(runtime.get("url"), str)
        ):
            return None
        api_port = runtime.get("api_port", 8000)
        if not isinstance(api_port, int) or not 1 <= api_port <= 65535:
            return None
        runtime["api_port"] = api_port
        return runtime
    except (OSError, ValueError):
        return None


def control_request(runtime: dict[str, object], *, stop: bool = False) -> bool:
    request = urllib.request.Request(
        f"http://127.0.0.1:{runtime['control_port']}/{'stop' if stop else 'status'}",
        headers={"Authorization": f"Bearer {runtime['token']}"},
        method="POST" if stop else "GET",
    )
    try:
        # Local lifecycle commands must not go through a configured HTTP proxy.
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=2) as response:
            return response.status == 200
    except (OSError, urllib.error.URLError):
        return False


def start_control_server(
    stop_requested: threading.Event, browser_url: str, *, api_port: int = 8000,
) -> tuple[http.server.ThreadingHTTPServer, str]:
    token = secrets.token_urlsafe(32)

    class ControlHandler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            self.respond(stop=False)

        def do_POST(self) -> None:
            self.respond(stop=True)

        def respond(self, *, stop: bool) -> None:
            if not secrets.compare_digest(self.headers.get("Authorization", ""), f"Bearer {token}"):
                self.send_error(403)
                return
            if self.path != ("/stop" if stop else "/status"):
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Length", "0")
            self.end_headers()
            if stop:
                # Let the API/proxy deliver the GUI's acknowledgement first.
                timer = threading.Timer(0.75, stop_requested.set)
                timer.daemon = True
                timer.start()

        def log_message(self, format: str, *args: object) -> None:
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), ControlHandler)
    try:
        RUNTIME_FILE.parent.mkdir(parents=True, exist_ok=True)
        with RUNTIME_FILE.open("w", encoding="utf-8") as runtime_file:
            if os.name != "nt":
                os.chmod(RUNTIME_FILE, 0o600)
            json.dump(
                {
                    "control_port": server.server_port,
                    "token": token,
                    "url": browser_url,
                    "api_port": api_port,
                },
                runtime_file,
            )
        threading.Thread(target=server.serve_forever, daemon=True).start()
    except BaseException:
        server.server_close()
        raise
    return server, token


def checkout_server_processes() -> tuple[set[int], set[int]]:
    """Find this checkout's API/web process tree and any launcher supervisors."""
    if os.name == "nt":
        result = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
             "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress"],
            capture_output=True, text=True, check=True, creationflags=subprocess.CREATE_NO_WINDOW,
        )
        rows = json.loads(result.stdout or "[]")
        if isinstance(rows, dict):
            rows = [rows]
        processes = {int(row["ProcessId"]): (int(row["ParentProcessId"]), row.get("CommandLine") or "") for row in rows}
    else:
        result = subprocess.run(["ps", "-axo", "pid=,ppid=,args="], capture_output=True, text=True, check=True)
        processes = {}
        for line in result.stdout.splitlines():
            parts = line.strip().split(None, 2)
            if len(parts) == 3:
                processes[int(parts[0])] = (int(parts[1]), parts[2])

    def normalized(value: str) -> str:
        return value.replace("\\", "/").casefold() if os.name == "nt" else value

    python_path = normalized(str(venv_python()))
    vite_paths = [
        normalized(str(root / path))
        for root in (REPOSITORY_ROOT, REPOSITORY_ROOT / "apps" / "web")
        for path in ("node_modules/.bin/vite", "node_modules/vite/bin/vite.js")
    ]

    def is_api(command: str) -> bool:
        return bool(
            command.startswith((python_path + " ", f'"{python_path}" '))
            and re.search(r"-m\s+uvicorn\s+app\.main:app(?:\s|$)", command)
        )

    def is_vite(command: str) -> bool:
        return bool(
            any(path in command for path in vite_paths)
            and re.match(r'^(?:"[^"]*node(?:\.exe)?"|\S*node(?:\.exe)?)\s', command)
        )

    def is_web_supervisor(command: str) -> bool:
        # npm stays alive while Vite is running and must be included in a
        # cleanup even if Vite has already exited.
        return bool(
            re.search(r"(?:^|[\\/\s])npm(?:\.cmd)?\s+run\s+dev(?:\s|$)", command)
            and re.search(r"(?:--workspace\s+)?apps[\\/]web(?:\s|$)", command)
        )

    def is_launcher(command: str) -> bool:
        script_path = normalized(str(Path(__file__).resolve()))
        return bool(
            re.search(rf'(?:^|\s)["\']?{re.escape(script_path)}["\']?(?:\s|$)', command)
            and re.search(r"--(?:background-worker|foreground)(?:\s|$)", command)
        )

    def descendants(roots: set[int]) -> set[int]:
        children: dict[int, set[int]] = {}
        for pid, (parent, _command) in processes.items():
            children.setdefault(parent, set()).add(pid)
        found: set[int] = set()
        pending = list(roots)
        while pending:
            parent = pending.pop()
            for child in children.get(parent, set()):
                if child in found or child == os.getpid():
                    continue
                found.add(child)
                pending.append(child)
        return found

    launcher_roots = {
        pid
        for pid, (_parent, raw_command) in processes.items()
        if pid != os.getpid() and is_launcher(normalized(raw_command))
    }
    if launcher_roots:
        # A foreground launcher may also open the user's browser. Only clean
        # up its API/web branches, including their npm and FFmpeg children.
        managed_roots = {
            pid for pid in descendants(launcher_roots)
            if is_api(normalized(processes[pid][1]))
            or is_vite(normalized(processes[pid][1]))
            or is_web_supervisor(normalized(processes[pid][1]))
        }
        return managed_roots | descendants(managed_roots), launcher_roots

    servers: set[int] = set()
    for pid, (_parent, raw_command) in processes.items():
        if pid == os.getpid():
            continue
        command = normalized(raw_command)
        if is_api(command) or is_vite(command):
            servers.add(pid)
        elif is_web_supervisor(command) and sys.platform.startswith("linux"):
            try:
                cwd = Path(f"/proc/{pid}/cwd").resolve(strict=True)
            except OSError:
                continue
            if cwd in {REPOSITORY_ROOT, REPOSITORY_ROOT / "apps" / "web"}:
                servers.add(pid)

    # On platforms without /proc, an identified Vite child establishes which
    # npm supervisor belongs to this checkout. Never match npm by its name alone.
    for server in tuple(servers):
        seen: set[int] = set()
        parent = processes[server][0]
        while parent in processes and parent not in seen and parent != os.getpid():
            seen.add(parent)
            next_parent, command = processes[parent]
            if is_web_supervisor(normalized(command)):
                servers.add(parent)
                break
            parent = next_parent
    return servers, set()


def stop_leftover_servers(*, allow_supervisor: bool = False) -> int:
    servers, supervisors = checkout_server_processes()
    if supervisors and not allow_supervisor:
        raise LauncherError("Another launcher is starting or running. Run the launcher with --stop first.")
    targets = servers | supervisors

    def terminate(pid: int, force: bool = False) -> None:
        try:
            if os.name == "nt":
                subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, check=False,
                               creationflags=subprocess.CREATE_NO_WINDOW)
            else:
                sig = signal.SIGKILL if force else signal.SIGTERM
                process_group = os.getpgid(pid)
                if process_group == pid and pid != os.getpgrp():
                    os.killpg(process_group, sig)
                else:
                    os.kill(pid, sig)
        except ProcessLookupError:
            pass

    # Stop child services first, then the worker that owns their cleanup.
    for pid in sorted(targets, key=lambda value: value in supervisors):
        terminate(pid)

    deadline = time.monotonic() + 10
    while targets and time.monotonic() < deadline:
        remaining_servers, remaining_supervisors = checkout_server_processes()
        remaining = targets.intersection(remaining_servers | remaining_supervisors)
        if not remaining:
            return len(targets)
        time.sleep(0.25)

    remaining_servers, remaining_supervisors = checkout_server_processes()
    remaining = targets.intersection(remaining_servers | remaining_supervisors)
    for pid in remaining:
        terminate(pid, force=True)
    force_deadline = time.monotonic() + 5
    while remaining and time.monotonic() < force_deadline:
        current_servers, current_supervisors = checkout_server_processes()
        remaining = targets.intersection(current_servers | current_supervisors)
        if not remaining:
            return len(targets)
        time.sleep(0.25)
    if remaining:
        raise LauncherError("An app process did not stop within 15 seconds. Check .aura/launcher.log.")
    return 0


def stop_background(*, api_port: int = 8000, web_port: int = 5173) -> int:
    runtime = read_runtime()
    if not runtime or not control_request(runtime):
        stopped = stop_leftover_servers(allow_supervisor=True)
        if stopped:
            wait_for_ports_free((api_port, web_port))
        print("[anm-player] Stopped leftover app servers." if stopped else "[anm-player] No app servers are running.", flush=True)
        RUNTIME_FILE.unlink(missing_ok=True)
        return 0
    if not control_request(runtime, stop=True):
        raise LauncherError("Could not request shutdown. Try --stop again.")
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        current = read_runtime()
        if not current or current.get("token") != runtime["token"]:
            stop_leftover_servers(allow_supervisor=True)
            browser_url = str(runtime.get("url", "http://127.0.0.1:5173/"))
            web_port = urlparse_port(browser_url, default=5173)
            wait_for_ports_free((int(runtime.get("api_port", 8000)), web_port))
            print("[anm-player] Stopped both servers.", flush=True)
            return 0
        time.sleep(0.25)
    # A child can be stuck in a provider request and prevent the graceful
    # worker cleanup from removing its runtime file. Fall back to the same
    # process-tree cleanup used for stale launches so --stop always completes.
    stop_leftover_servers(allow_supervisor=True)
    browser_url = str(runtime.get("url", "http://127.0.0.1:5173/"))
    web_port = urlparse_port(browser_url, default=5173)
    wait_for_ports_free((int(runtime.get("api_port", 8000)), web_port))
    RUNTIME_FILE.unlink(missing_ok=True)
    print("[anm-player] Stopped both servers.", flush=True)
    return 0


def launch_background(args: argparse.Namespace) -> int:
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="anm-player-start-") as temporary_directory:
        ready_file = Path(temporary_directory) / "ready"
        command = [
            sys.executable, "-u", str(Path(__file__).resolve()), "--background-worker",
            "--ready-file", str(ready_file), "--api-port", str(args.api_port), "--web-port", str(args.web_port),
        ]
        options: dict[str, object] = {"start_new_session": True} if os.name != "nt" else {
            "creationflags": subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP,
        }
        with LOG_FILE.open("a", encoding="utf-8") as log:
            process = subprocess.Popen(
                command, cwd=REPOSITORY_ROOT, stdin=subprocess.DEVNULL,
                stdout=log, stderr=subprocess.STDOUT, **options,
            )
        print(f"[anm-player] Starting in the background. Logs: {LOG_FILE}", flush=True)
        try:
            deadline = time.monotonic() + 200
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise LauncherError(f"Background startup failed. See {LOG_FILE} for details.")
                if ready_file.exists() and ready_file.read_text(encoding="utf-8") == "ready":
                    browser_url = f"http://127.0.0.1:{args.web_port}/"
                    print(f"[anm-player] Ready at {browser_url}. You can close this terminal.", flush=True)
                    if not args.no_browser:
                        webbrowser.open(browser_url)
                    return 0
                time.sleep(0.25)
            raise LauncherError(f"Background startup timed out. See {LOG_FILE} for details.")
        except BaseException:
            # Startup was cancelled or failed; do not leave half-started servers.
            stop_process_tree(process, timeout=20)
            raise


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        os.chdir(REPOSITORY_ROOT)
        if args.stop:
            return stop_background(api_port=args.api_port, web_port=args.web_port)
        if args.background_worker:
            if args.ready_file is None:
                raise LauncherError("The background worker requires a readiness file.")
            if os.name != "nt":
                def handle_sigterm(_signum: int, _frame: object) -> None:
                    raise KeyboardInterrupt

                signal.signal(signal.SIGTERM, handle_sigterm)
            return serve(
                api_port=args.api_port, web_port=args.web_port, open_browser=False,
                values=read_env(REPOSITORY_ROOT / ".env"), ready_file=args.ready_file,
            )
        runtime = read_runtime()
        if runtime and control_request(runtime):
            if args.setup_only or args.force_install:
                raise LauncherError("Stop the running app with --stop before changing its setup.")
            browser_url = str(runtime["url"])
            wait_until_ready(f"{browser_url}api/v1/health", [])
            print(f"[anm-player] Already running at {browser_url}", flush=True)
            if not args.no_browser:
                webbrowser.open(browser_url)
            return 0
        if not args.setup_only:
            if stop_leftover_servers():
                print("[anm-player] Cleared leftover app servers from an earlier launch.", flush=True)
            require_available_ports(args.api_port, args.web_port)
        check_prerequisites()
        install_dependencies(force=args.force_install)
        values = ensure_environment()
        run_migrations(values)
        if args.setup_only:
            print("[anm-player] Setup complete.", flush=True)
            return 0
        if not args.foreground:
            return launch_background(args)
        return serve(
            api_port=args.api_port,
            web_port=args.web_port,
            open_browser=not args.no_browser,
            values=values,
        )
    except (LauncherError, OSError, subprocess.SubprocessError) as exc:
        print(f"[anm-player] {exc}", file=sys.stderr, flush=True)
        print("[anm-player] Fix the issue above, then run the launcher again.", file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
