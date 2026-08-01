#!/usr/bin/env python3
"""Set up and run ANM Player's native API and web development servers."""

from __future__ import annotations

import argparse
import atexit
import hashlib
import json
import os
import re
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path
from typing import Iterable


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
API_ROOT = REPOSITORY_ROOT / "apps" / "api"
VENV_ROOT = API_ROOT / ".venv"
STAMP_FILE = REPOSITORY_ROOT / ".aura" / "launcher-dependencies.json"
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
            try:
                probe.bind(("127.0.0.1", port))
            except OSError as exc:
                raise LauncherError(
                    f"The {label} port {port} is already in use. Stop the existing process or choose another port."
                ) from exc


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
        options["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
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


def wait_until_ready(url: str, processes: Iterable[subprocess.Popen[str]], *, timeout: float = 90) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
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


def stop_process_tree(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    else:
        try:
            os.killpg(process.pid, signal.SIGTERM)
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


def serve(*, api_port: int, web_port: int, open_browser: bool, values: dict[str, str]) -> int:
    require_available_ports(api_port, web_port)
    environment = os.environ.copy()
    environment.update(values)
    environment["API_ENV"] = "development"
    environment["AURA_API_PORT"] = str(api_port)
    processes: list[subprocess.Popen[str]] = []

    def cleanup() -> None:
        for process in reversed(processes):
            stop_process_tree(process)

    atexit.register(cleanup)
    previous_sigbreak = None
    if os.name == "nt" and hasattr(signal, "SIGBREAK"):
        previous_sigbreak = signal.getsignal(signal.SIGBREAK)

        def handle_sigbreak(_signum: int, _frame: object) -> None:
            raise KeyboardInterrupt

        signal.signal(signal.SIGBREAK, handle_sigbreak)
    try:
        api = child_process(
            [str(venv_python()), "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(api_port)],
            cwd=API_ROOT,
            env=environment,
        )
        processes.append(api)
        web = child_process(
            [npm_command(), "run", "dev", "--workspace", "apps/web", "--", "--host", "127.0.0.1", "--port", str(web_port)],
            cwd=REPOSITORY_ROOT,
            env=environment,
        )
        processes.append(web)
        threading.Thread(target=stream_output, args=(api, "api"), daemon=True).start()
        threading.Thread(target=stream_output, args=(web, "web"), daemon=True).start()

        wait_until_ready(f"http://127.0.0.1:{api_port}/api/v1/health", processes)
        browser_url = f"http://127.0.0.1:{web_port}/"
        wait_until_ready(browser_url, processes)
        print(f"[anm-player] Ready at {browser_url}", flush=True)
        if open_browser:
            webbrowser.open(browser_url)

        while True:
            for process in processes:
                return_code = process.poll()
                if return_code is not None:
                    raise LauncherError(f"A child process stopped unexpectedly with exit code {return_code}.")
            time.sleep(0.25)
    except KeyboardInterrupt:
        print("\n[anm-player] Stopping ANM Player…", flush=True)
        return 0
    finally:
        cleanup()
        if previous_sigbreak is not None:
            signal.signal(signal.SIGBREAK, previous_sigbreak)
        atexit.unregister(cleanup)


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        os.chdir(REPOSITORY_ROOT)
        check_prerequisites()
        install_dependencies(force=args.force_install)
        values = ensure_environment()
        run_migrations(values)
        if args.setup_only:
            print("[anm-player] Setup complete.", flush=True)
            return 0
        return serve(
            api_port=args.api_port,
            web_port=args.web_port,
            open_browser=not args.no_browser,
            values=values,
        )
    except LauncherError as exc:
        print(f"[anm-player] {exc}", file=sys.stderr, flush=True)
        print("[anm-player] Fix the issue above, then run the launcher again.", file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
