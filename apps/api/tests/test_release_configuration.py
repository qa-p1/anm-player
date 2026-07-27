from __future__ import annotations

import ast
import json
import re
import sys
from pathlib import Path

from app.core.config import Settings
from app.version import VERSION


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
API_ROOT = REPOSITORY_ROOT / "apps" / "api"
EXPECTED_ENVIRONMENT = {
    "COMPOSE_PROJECT_NAME",
    "WEB_BIND_HOST",
    "WEB_PORT",
    "API_ENV",
    "API_ACCESS_TOKEN",
    "API_TRUSTED_HOSTS",
    "AURA_DATA_ROOT",
    "AURA_STATE_FILE",
    "DOWNLOAD_WORKER_POLL_INTERVAL_SECONDS",
    "STREAM_FETCH_MAX_CONCURRENCY",
    "STREAM_MAX_FILE_MB",
    "STREAM_CACHE_BUDGET_MB",
    "ARTWORK_MAX_RESPONSE_MB",
    "ARTWORK_MAX_PIXELS",
    "ARTWORK_MAX_CONCURRENCY",
}
IMPORT_TO_REQUIREMENT = {
    "PIL": "pillow",
    "pydantic_settings": "pydantic-settings",
    "sqlalchemy": "sqlalchemy",
    "yt_dlp": "yt-dlp",
}


def environment_keys(path: Path) -> set[str]:
    return {
        line.split("=", 1)[0].strip()
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.lstrip().startswith("#") and "=" in line
    }


def requirement_names(path: Path) -> set[str]:
    names: set[str] = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        value = line.strip()
        if not value or value.startswith(("#", "-")):
            continue
        names.add(re.split(r"[<>=!~\[]", value, maxsplit=1)[0].strip().casefold())
    return names


def application_imports() -> set[str]:
    imports: set[str] = set()
    for source in (API_ROOT / "app").rglob("*.py"):
        tree = ast.parse(source.read_text(encoding="utf-8"), filename=str(source))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imports.update(alias.name.split(".", 1)[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imports.add(node.module.split(".", 1)[0])
    return imports


def test_example_environment_lists_only_supported_boot_variables() -> None:
    documented = environment_keys(REPOSITORY_ROOT / ".env.example")
    assert documented == EXPECTED_ENVIRONMENT

    settings_aliases = {
        str(field.alias)
        for field in Settings.model_fields.values()
        if field.alias and str(field.alias).isupper()
    }
    expected_settings = EXPECTED_ENVIRONMENT - {"COMPOSE_PROJECT_NAME", "WEB_BIND_HOST", "WEB_PORT"}
    assert settings_aliases == expected_settings

    compose = (REPOSITORY_ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    development = (REPOSITORY_ROOT / "docker-compose.dev.yml").read_text(encoding="utf-8")
    compose_variables = set(re.findall(r"\$\{([A-Z][A-Z0-9_]*)", compose + development))
    assert compose_variables <= documented


def test_relative_storage_configuration_is_rooted_at_the_repository(tmp_path) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text(
        "API_ENV=development\nAURA_DATA_ROOT=./custom-data\nAURA_STATE_FILE=./custom-state/state.json\n",
        encoding="utf-8",
    )

    configured = Settings(_env_file=env_file)

    assert configured.aura_data_root == (REPOSITORY_ROOT / "custom-data").resolve()
    assert configured.aura_state_file == (REPOSITORY_ROOT / "custom-state" / "state.json").resolve()


def test_runtime_imports_are_declared_in_runtime_requirements() -> None:
    declared = requirement_names(API_ROOT / "requirements.txt")
    external = application_imports() - set(sys.stdlib_module_names) - {"app", "__future__"}
    normalized = {IMPORT_TO_REQUIREMENT.get(name, name.replace("_", "-")).casefold() for name in external}
    assert normalized <= declared


def test_release_version_is_consistent_across_metadata() -> None:
    root_package = json.loads((REPOSITORY_ROOT / "package.json").read_text(encoding="utf-8"))
    web_package = json.loads((REPOSITORY_ROOT / "apps" / "web" / "package.json").read_text(encoding="utf-8"))
    file_version = (REPOSITORY_ROOT / "VERSION").read_text(encoding="utf-8").strip()

    assert VERSION == file_version == root_package["version"] == web_package["version"]
