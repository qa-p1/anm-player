import importlib.util
import re
import signal
import socket
import subprocess
import sys
import threading
from pathlib import Path
from types import SimpleNamespace
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener

import pytest


LAUNCHER_PATH = Path(__file__).resolve().parents[3] / "scripts" / "start_aura.py"
SPEC = importlib.util.spec_from_file_location("start_aura", LAUNCHER_PATH)
assert SPEC and SPEC.loader
launcher = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(launcher)


def test_dependency_fingerprint_changes_with_lockfile(tmp_path, monkeypatch) -> None:
    first = tmp_path / "requirements.txt"
    second = tmp_path / "package-lock.json"
    first.write_text("fastapi==1\n", encoding="utf-8")
    second.write_text("{}\n", encoding="utf-8")
    monkeypatch.setattr(launcher, "REPOSITORY_ROOT", tmp_path)
    monkeypatch.setattr(launcher, "DEPENDENCY_FILES", (first, second))

    original = launcher.dependency_fingerprint()
    second.write_text('{"changed": true}\n', encoding="utf-8")

    assert launcher.dependency_fingerprint() != original


def test_first_run_env_generation_preserves_existing_token(tmp_path, monkeypatch) -> None:
    example = "API_ENV=production\nAPI_ACCESS_TOKEN=\nAURA_DATA_ROOT=./data\nAURA_STATE_FILE=./.aura/state.json\n"
    (tmp_path / ".env.example").write_text(example, encoding="utf-8")
    monkeypatch.setattr(launcher, "REPOSITORY_ROOT", tmp_path)

    first = launcher.ensure_environment()
    token = first["API_ACCESS_TOKEN"]
    second = launcher.ensure_environment()

    assert token == second["API_ACCESS_TOKEN"]
    assert re.fullmatch(r"[A-Za-z0-9_-]{32,256}", token)
    assert (tmp_path / "data").is_dir()
    assert (tmp_path / ".aura").is_dir()


def test_existing_placeholder_token_is_not_overwritten(tmp_path, monkeypatch) -> None:
    content = "API_ACCESS_TOKEN=change-me\nAURA_DATA_ROOT=./data\nAURA_STATE_FILE=./.aura/state.json\n"
    env_file = tmp_path / ".env"
    env_file.write_text(content, encoding="utf-8")
    monkeypatch.setattr(launcher, "REPOSITORY_ROOT", tmp_path)

    with pytest.raises(launcher.LauncherError, match="placeholder"):
        launcher.ensure_environment()

    assert env_file.read_text(encoding="utf-8") == content


def test_cli_rejects_invalid_ports() -> None:
    with pytest.raises(SystemExit):
        launcher.parse_args(["--api-port", "70000"])


def test_migrations_receive_environment(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_run_checked(arguments, *, cwd, label, env=None) -> None:
        captured.update(arguments=arguments, cwd=cwd, label=label, env=env)

    monkeypatch.setattr(launcher, "run_checked", fake_run_checked)
    launcher.run_migrations({"AURA_DATA_ROOT": "./managed-data", "API_ACCESS_TOKEN": "secret"})

    assert captured["env"]["AURA_DATA_ROOT"] == "./managed-data"
    assert captured["env"]["API_ACCESS_TOKEN"] == "secret"


def test_port_preflight_rejects_collisions() -> None:
    with pytest.raises(launcher.LauncherError, match="must be different"):
        launcher.require_available_ports(8123, 8123)

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as occupied:
        occupied.bind(("127.0.0.1", 0))
        port = occupied.getsockname()[1]
        with pytest.raises(launcher.LauncherError, match="already in use"):
            launcher.require_available_ports(port, port + 1)


def test_stop_without_runtime_stops_leftover_servers(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(launcher, "RUNTIME_FILE", tmp_path / "missing-runtime.json")
    calls = []
    ports = []
    monkeypatch.setattr(launcher, "stop_leftover_servers", lambda **kwargs: calls.append(kwargs) or 1)
    monkeypatch.setattr(launcher, "wait_for_ports_free", lambda values: ports.append(values))
    assert launcher.stop_background(api_port=8123, web_port=5123) == 0
    assert calls == [{"allow_supervisor": True}]
    assert ports == [(8123, 5123)]


def test_process_discovery_only_matches_this_checkouts_servers(monkeypatch) -> None:
    if launcher.os.name == "nt":
        pytest.skip("POSIX process table fixture")
    python = launcher.venv_python()
    vite = launcher.REPOSITORY_ROOT / "node_modules/.bin/vite"
    rows = (
        f"91001 1 {python} -m uvicorn app.main:app --port 8000\n"
        f"91002 1 node {vite} --port 5173\n"
        "91003 1 /other/app/.venv/bin/python -m uvicorn app.main:app --port 8000\n"
        f"91004 1 bash -c echo '{python} -m uvicorn app.main:app'\n"
        "91005 1 node /other/app/node_modules/.bin/vite --port 5173\n"
        "91006 1 python3 /other/app/scripts/start_aura.py --background-worker\n"
        "91007 1 npm run dev --workspace apps/web\n"
    )
    monkeypatch.setattr(launcher.subprocess, "run", lambda *args, **kwargs: SimpleNamespace(stdout=rows))
    assert launcher.checkout_server_processes() == ({91001, 91002}, set())


def test_startup_does_not_kill_an_active_launcher(monkeypatch) -> None:
    monkeypatch.setattr(launcher, "checkout_server_processes", lambda: ({91001}, {91002}))
    with pytest.raises(launcher.LauncherError, match="Another launcher"):
        launcher.stop_leftover_servers()


def test_process_discovery_scopes_launchers_and_their_children(monkeypatch) -> None:
    if launcher.os.name == "nt":
        pytest.skip("POSIX process table fixture")
    rows = (
        f"91001 1 python3 {LAUNCHER_PATH} --background-worker\n"
        "91002 91001 npm run dev --workspace apps/web\n"
        "91003 91002 sh -c vite\n"
        "91004 91001 /usr/bin/browser http://127.0.0.1:5173/\n"
        "92001 1 python3 /other/app/scripts/start_aura.py --background-worker\n"
        "92002 92001 npm run dev --workspace apps/web\n"
    )
    monkeypatch.setattr(launcher.subprocess, "run", lambda *args, **kwargs: SimpleNamespace(stdout=rows))
    assert launcher.checkout_server_processes() == ({91002, 91003}, {91001})


def test_orphan_npm_is_identified_by_its_own_vite_child(monkeypatch) -> None:
    if launcher.os.name == "nt":
        pytest.skip("POSIX process table fixture")
    monkeypatch.setattr(launcher.sys, "platform", "darwin")
    vite = launcher.REPOSITORY_ROOT / "node_modules/.bin/vite"
    rows = (
        "91001 1 npm run dev --workspace apps/web\n"
        f"91002 91001 node {vite} --port 5173\n"
        "92001 1 npm run dev --workspace apps/web\n"
    )
    monkeypatch.setattr(launcher.subprocess, "run", lambda *args, **kwargs: SimpleNamespace(stdout=rows))
    assert launcher.checkout_server_processes() == ({91001, 91002}, set())


def test_stop_with_no_managed_servers_leaves_other_listeners_alone(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(launcher, "RUNTIME_FILE", tmp_path / "missing-runtime.json")
    monkeypatch.setattr(launcher, "stop_leftover_servers", lambda **kwargs: 0)
    monkeypatch.setattr(launcher, "wait_for_ports_free", lambda ports: pytest.fail("Unrelated listeners must be ignored"))
    assert launcher.stop_background() == 0


def test_background_launch_detaches_and_waits_for_readiness(tmp_path, monkeypatch) -> None:
    if launcher.os.name == "nt":
        pytest.skip("POSIX creation flag assertion")
    monkeypatch.setattr(launcher, "LOG_FILE", tmp_path / "launcher.log")
    captured = {}

    def popen(command, **kwargs):
        captured.update(command=command, **kwargs)
        Path(command[command.index("--ready-file") + 1]).write_text("ready")
        return SimpleNamespace(poll=lambda: None)

    monkeypatch.setattr(launcher.subprocess, "Popen", popen)
    args = launcher.parse_args(["--no-browser", "--api-port", "8123", "--web-port", "5123"])
    assert launcher.launch_background(args) == 0
    assert captured["start_new_session"] is True
    assert captured["stdin"] == launcher.subprocess.DEVNULL
    assert "--background-worker" in captured["command"]
    assert str(LAUNCHER_PATH) in captured["command"]
    assert not Path(captured["command"][captured["command"].index("--ready-file") + 1]).exists()


def test_failed_background_launch_cleans_up_its_worker(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(launcher, "LOG_FILE", tmp_path / "launcher.log")
    process = SimpleNamespace(poll=lambda: 1)
    stopped = []
    monkeypatch.setattr(launcher.subprocess, "Popen", lambda *args, **kwargs: process)
    monkeypatch.setattr(launcher, "stop_process_tree", lambda child, **kwargs: stopped.append(child))
    with pytest.raises(launcher.LauncherError, match="Background startup failed"):
        launcher.launch_background(launcher.parse_args(["--no-browser"]))
    assert stopped == [process]


def test_control_server_requires_secret_and_acknowledges_shutdown(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(launcher, "RUNTIME_FILE", tmp_path / "launcher-runtime.json")
    stop_requested = threading.Event()
    server, token = launcher.start_control_server(stop_requested, "http://127.0.0.1:5123/", api_port=8123)
    try:
        runtime = launcher.read_runtime()
        assert runtime and runtime["token"] == token and runtime["api_port"] == 8123
        unauthorized = Request(f"http://127.0.0.1:{server.server_port}/stop", method="POST")
        with pytest.raises(HTTPError) as rejected:
            build_opener(ProxyHandler({})).open(unauthorized, timeout=2)
        assert rejected.value.code == 403
        rejected.value.close()
        assert not stop_requested.is_set()
        assert launcher.control_request(runtime)
        assert launcher.control_request(runtime, stop=True)
        assert stop_requested.wait(2)
    finally:
        server.shutdown()
        server.server_close()


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX detached process integration")
def test_background_worker_survives_parent_exit_and_stops_both_services(tmp_path, monkeypatch) -> None:
    # Exercise real detachment and shutdown with isolated HTTP services, without
    # installing dependencies or opening the developer's database or browser.
    runtime_path = tmp_path / "runtime.json"
    pid_path = tmp_path / "worker.pid"
    monkeypatch.setattr(launcher, "RUNTIME_FILE", runtime_path)
    service = '''import http.server, sys
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Length", "2")
        self.end_headers()
        self.wfile.write(b"ok")
    def log_message(self, *args):
        pass
http.server.ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), Handler).serve_forever()
'''
    harness = tmp_path / "launcher_harness.py"
    harness.write_text(f'''
import importlib.util
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location("native_launcher", {str(LAUNCHER_PATH)!r})
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)
launcher.__file__ = __file__
launcher.REPOSITORY_ROOT = Path({str(tmp_path)!r})
launcher.API_ROOT = launcher.REPOSITORY_ROOT
launcher.RUNTIME_FILE = Path({str(runtime_path)!r})
launcher.LOG_FILE = launcher.REPOSITORY_ROOT / "launcher.log"
original_child = launcher.child_process
original_popen = launcher.subprocess.Popen

def child(arguments, *, cwd, env):
    port = arguments[arguments.index("--port") + 1]
    return original_child([sys.executable, "-u", "-c", {service!r}, port], cwd=cwd, env=env)

def popen(arguments, **kwargs):
    process = original_popen(arguments, **kwargs)
    if "--background-worker" in arguments:
        Path({str(pid_path)!r}).write_text(str(process.pid))
    return process

launcher.child_process = child
launcher.subprocess.Popen = popen
args = launcher.parse_args()
if args.background_worker:
    code = launcher.serve(api_port=args.api_port, web_port=args.web_port, open_browser=False, values={{}}, ready_file=args.ready_file)
else:
    code = launcher.launch_background(args)
raise SystemExit(code)
''')
    with socket.socket() as api, socket.socket() as web:
        api.bind(("127.0.0.1", 0))
        web.bind(("127.0.0.1", 0))
        ports = (api.getsockname()[1], web.getsockname()[1])
    try:
        parent = subprocess.run(
            [sys.executable, str(harness), "--no-browser", "--api-port", str(ports[0]), "--web-port", str(ports[1])],
            capture_output=True, text=True, timeout=20,
        )
        assert parent.returncode == 0, parent.stdout + parent.stderr
        assert "You can close this terminal" in parent.stdout
        runtime = launcher.read_runtime()
        assert runtime and launcher.control_request(runtime)
        for port in ports:
            with build_opener(ProxyHandler({})).open(f"http://127.0.0.1:{port}/", timeout=2) as response:
                assert response.status == 200
        assert launcher.control_request(runtime, stop=True)
        launcher.wait_for_ports_free(ports, timeout=8)
    finally:
        if pid_path.exists():
            try:
                launcher.os.kill(int(pid_path.read_text()), signal.SIGTERM)
            except ProcessLookupError:
                pass
