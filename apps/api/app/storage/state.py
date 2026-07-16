from __future__ import annotations

import json
import os
import threading
from copy import deepcopy
from pathlib import Path
from typing import Any


API_DIR = Path(__file__).resolve().parents[2]
STATE_SCHEMA_VERSION = 1


def default_state_file() -> Path:
    configured = os.getenv("AURA_STATE_FILE")
    if configured:
        return Path(configured).expanduser().resolve()
    return API_DIR / ".aura" / "storage-state.json"


def default_data_root() -> Path:
    seeded = os.getenv("AURA_DATA_ROOT")
    if seeded:
        return Path(seeded).expanduser().resolve()
    return (API_DIR / "data").resolve()


class StorageStateStore:
    """Small, durable pointer to storage that always lives outside ``data_root``."""

    def __init__(self, path: str | Path | None = None, *, initial_root: str | Path | None = None) -> None:
        self.path = Path(path).expanduser().resolve() if path else default_state_file()
        self.initial_root = Path(initial_root).expanduser().resolve() if initial_root else default_data_root()
        self._lock = threading.RLock()

    def read(self) -> dict[str, Any]:
        with self._lock:
            if not self.path.exists():
                state = self._new_state()
                self._write_unlocked(state)
                return deepcopy(state)
            with self.path.open("r", encoding="utf-8") as handle:
                state = json.load(handle)
            if not isinstance(state, dict) or not isinstance(state.get("data_root"), str):
                raise RuntimeError(f"Invalid Aura storage state: {self.path}")
            state.setdefault("schema_version", STATE_SCHEMA_VERSION)
            state.setdefault("migration", None)
            return deepcopy(state)

    def update(self, **changes: Any) -> dict[str, Any]:
        with self._lock:
            state = self.read()
            state.update(changes)
            self._write_unlocked(state)
            return deepcopy(state)

    def set_migration(self, migration: dict[str, Any] | None) -> dict[str, Any]:
        return self.update(migration=migration)

    def switch_root(self, root: str | Path, *, migration: dict[str, Any] | None = None) -> dict[str, Any]:
        return self.update(data_root=str(Path(root).expanduser().resolve()), migration=migration)

    def _new_state(self) -> dict[str, Any]:
        return {
            "schema_version": STATE_SCHEMA_VERSION,
            "data_root": str(self.initial_root),
            "migration": None,
        }

    def _write_unlocked(self, state: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temp = self.path.with_name(f".{self.path.name}.{os.getpid()}.tmp")
        payload = json.dumps(state, indent=2, sort_keys=True) + "\n"
        with temp.open("w", encoding="utf-8", newline="\n") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp, self.path)
        if os.name != "nt":
            directory_fd = os.open(self.path.parent, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)


storage_state_store = StorageStateStore()
