import importlib.util
import re
import socket
from pathlib import Path

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
