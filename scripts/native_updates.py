"""Launcher-owned updates: stage a new source tree and keep live user data separate."""
from __future__ import annotations

import json
import os
import re
import shutil
import sqlite3
import stat
import subprocess
import sys
import threading
import time
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath
from typing import Callable

REPOSITORY = "qa-p1/anm-player"
COMMIT = re.compile(r"^[0-9a-f]{40}$")
BUSY_STATES = {"checking", "downloading", "installing", "building", "restarting"}


class UpdateError(RuntimeError):
    pass


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    try:
        with temporary.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def read_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def github_head() -> dict:
    request = urllib.request.Request(
        f"https://api.github.com/repos/{REPOSITORY}/commits/main",
        headers={"Accept": "application/vnd.github+json", "User-Agent": "ANM-Player-Updater"},
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        payload = json.loads(response.read(2 * 1024 * 1024))
    sha = payload.get("sha", "")
    if not isinstance(sha, str) or not COMMIT.fullmatch(sha):
        raise UpdateError("GitHub returned an invalid update. Try checking again later.")
    return {"commit": sha, "summary": str(payload.get("commit", {}).get("message", "Update ANM Player")).splitlines()[0][:240]}


def installed_commit(root: Path) -> str | None:
    commit = read_json(root / ".aura" / "install.json").get("commit")
    if isinstance(commit, str) and COMMIT.fullmatch(commit):
        return commit
    if (root / ".git").exists():
        try:
            result = subprocess.run(["git", "rev-parse", "HEAD"], cwd=root, capture_output=True, text=True, timeout=10, check=True)
            commit = result.stdout.strip()
            return commit if COMMIT.fullmatch(commit) else None
        except (OSError, subprocess.SubprocessError):
            pass
    return None


def extract_source(archive: Path, destination: Path) -> None:
    """Strip GitHub's single outer folder; reject links, traversal and zip bombs."""
    with zipfile.ZipFile(archive) as source:
        entries = source.infolist()
        total = 0
        prefixes: set[str] = set()
        for entry in entries:
            path = PurePosixPath(entry.filename)
            if path.is_absolute() or ".." in path.parts or "\\" in entry.filename or not path.parts:
                raise UpdateError("The update archive contains an invalid path.")
            prefixes.add(path.parts[0])
            if stat.S_ISLNK(entry.external_attr >> 16):
                raise UpdateError("Links are not allowed in update archives.")
            total += entry.file_size
            if total > 250 * 1024 * 1024 or len(entries) > 15000:
                raise UpdateError("The update archive is too large.")
        if len(prefixes) != 1:
            raise UpdateError("The update archive has an invalid layout.")
        destination.mkdir(parents=True, exist_ok=False)
        for entry in entries:
            parts = PurePosixPath(entry.filename).parts[1:]
            if not parts:
                continue
            if parts[0] in {".git", ".env", ".aura", "node_modules", "data"} or ":" in "/".join(parts):
                raise UpdateError("The update archive contains local installation files.")
            target = destination.joinpath(*parts)
            if entry.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with source.open(entry) as incoming, target.open("wb") as outgoing:
                    shutil.copyfileobj(incoming, outgoing)
        for name in ("scripts/start_aura.py", "package-lock.json", "apps/api/requirements.txt", "VERSION"):
            if not (destination / name).is_file():
                raise UpdateError("The update is incomplete. Your current app has been kept.")


def download_source(commit: str, destination: Path) -> None:
    if not COMMIT.fullmatch(commit):
        raise UpdateError("Invalid update revision.")
    archive = destination.with_suffix(".zip")
    archive.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(f"https://codeload.github.com/{REPOSITORY}/zip/{commit}", headers={"User-Agent": "ANM-Player-Updater"})
    try:
        with urllib.request.urlopen(request, timeout=60) as incoming, archive.open("wb") as outgoing:
            total = 0
            while chunk := incoming.read(1024 * 1024):
                total += len(chunk)
                if total > 40 * 1024 * 1024:
                    raise UpdateError("The update download is too large.")
                outgoing.write(chunk)
        extract_source(archive, destination)
    finally:
        archive.unlink(missing_ok=True)


def durable_environment(root: Path, values: dict[str, str]) -> dict[str, str]:
    result = dict(values)
    for key, fallback in (("AURA_DATA_ROOT", "./data"), ("AURA_STATE_FILE", "./.aura/storage-state.json")):
        path = Path(result.get(key, fallback)).expanduser()
        result[key] = str((root / path).resolve() if not path.is_absolute() else path.resolve())
    return result


def database_path(values: dict[str, str]) -> Path:
    state = read_json(Path(values["AURA_STATE_FILE"]))
    if state.get("migration"):
        raise UpdateError("Finish the storage move before updating.")
    return Path(state.get("data_root") or values["AURA_DATA_ROOT"]) / "aura.db"


def snapshot_database(database: Path, backup: Path) -> None:
    if not database.is_file():
        raise UpdateError("The library database was not found; the update has been stopped.")
    backup.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(database) as source, sqlite3.connect(backup) as target:
        source.backup(target)
        if target.execute("PRAGMA quick_check").fetchone() != ("ok",):
            raise UpdateError("The library backup could not be verified.")


def restore_database(backup: Path, database: Path) -> None:
    with sqlite3.connect(backup) as source, sqlite3.connect(database) as target:
        source.backup(target)


def cleanup_updates(home: Path, active: Path, previous: Path | None = None, *, user_paths: tuple[Path, ...] = (), clean_caches: bool = True) -> None:
    """Only discard our marked source copies; user storage is never traversed."""
    protected = {active.resolve()}
    if previous is not None:
        protected.add(previous.resolve())
    def contains_user_data(path: Path) -> bool:
        return any(user.resolve().is_relative_to(path.resolve()) for user in user_paths)
    releases = home / "releases"
    try:
        candidates = list(releases.iterdir()) if releases.is_dir() else []
    except OSError:
        candidates = []
    candidates.append(home / "app")
    for path in candidates:
        if path.is_symlink() or not path.is_dir() or path.resolve() in protected or (path / ".git").exists() or contains_user_data(path):
            continue
        marker = read_json(path / ".aura/install.json")
        if marker.get("managed") is not True or not COMMIT.fullmatch(str(marker.get("commit", ""))):
            continue
        if path.parent == releases and path.name != marker["commit"]:
            continue
        shutil.rmtree(path, ignore_errors=True)  # Windows can still hold a file briefly.
    backups = home / "backups"
    if backups.is_dir():
        for path in sorted(backups.glob("before-*.db"), key=lambda item: item.name, reverse=True)[2:]:
            if not path.is_symlink():
                try:
                    path.unlink(missing_ok=True)
                except OSError:
                    pass  # Retry a temporarily locked backup at the next start.
    # Only disposable installer download caches, not installed Python/Node/FFmpeg.
    for path in (home / "tools/cache", home / "download-cache") if clean_caches else ():
        if path.is_dir() and not path.is_symlink() and not contains_user_data(path):
            shutil.rmtree(path, ignore_errors=True)


class NativeUpdater:
    def __init__(self, root: Path, home: Path, values: dict[str, str], restart: Callable[[Path, dict[str, str]], None], *, check_on_start: bool = False):
        self.root = root
        self.home = home
        self.values = durable_environment(root, values)
        self.restart = restart
        self.commit = installed_commit(root)
        self.state_file = home / "update-state.json"
        self.lock = threading.Lock()
        self.running = False
        if not self.state_file.exists():
            self.set_state("idle", "Check for updates when you’re ready.")
        elif self.status().get("state") in BUSY_STATES and not os.environ.get("ANM_UPDATE_RESTART"):
            self.set_state("error", "The last update was interrupted. Your current app is ready; check again to retry.")
        if not os.environ.get("ANM_UPDATE_RESTART"):
            pointer = read_json(home / "current.json")
            prior = pointer.get("previous_root")
            cleanup_updates(home, root, Path(prior) if isinstance(prior, str) else None, user_paths=self.user_paths(), clean_caches=False)
            if check_on_start:
                self.start(install=False)

    def user_paths(self) -> tuple[Path, ...]:
        state_file = Path(self.values["AURA_STATE_FILE"])
        state = read_json(state_file)
        return (Path(state.get("data_root") or self.values["AURA_DATA_ROOT"]), state_file)

    def status(self) -> dict:
        state = read_json(self.state_file)
        return {**state, "supported": True, "current_commit": self.commit, "current_version": (self.root / "VERSION").read_text().strip()}

    def set_state(self, state: str, message: str, **extra) -> dict:
        previous = read_json(self.state_file)
        payload = {**previous, **extra, "state": state, "message": message, "updated_at": time.time()}
        write_json(self.state_file, payload)
        return payload

    def start(self, *, install: bool) -> dict:
        with self.lock:
            if self.running:
                raise UpdateError("An update check or installation is already running.")
            status = self.status()
            if install and (status.get("state") != "available" or not COMMIT.fullmatch(str(status.get("latest_commit", "")))):
                raise UpdateError("Check for updates before installing.")
            self.running = True
            commit = status.get("latest_commit") if install else None
            self.set_state("downloading" if install else "checking", "Downloading the update…" if install else "Checking GitHub…")
            threading.Thread(target=self._work, args=(commit,), daemon=True).start()
        return self.status()

    def _run(self, command: list[str], root: Path, env: dict[str, str], *, timeout: int = 1800) -> None:
        log = self.home / "update.log"
        if log.is_file() and log.stat().st_size > 5 * 1024 * 1024:
            log.replace(log.with_suffix(".previous.log"))
        with log.open("a", encoding="utf-8") as handle:
            result = subprocess.run(command, cwd=root, env=env, stdout=handle, stderr=subprocess.STDOUT, timeout=timeout, check=False)
        if result.returncode:
            raise UpdateError("Setup did not finish. Your current app is still available. Try again; details are in the update log.")

    def _work(self, commit: str | None) -> None:
        candidate: Path | None = None
        try:
            if commit is None:
                latest = github_head()
                available = latest["commit"] != self.commit
                self.set_state("available" if available else "current", "An update is ready to install." if available else "You’re up to date.", latest_commit=latest["commit"], summary=latest["summary"])
                return
            candidate = self.home / "releases" / commit
            # A failed stage is disposable; never remove the running or selected source.
            active = read_json(self.home / "current.json").get("root")
            if candidate.resolve() == self.root.resolve() or active == str(candidate.resolve()):
                raise UpdateError("This update is already installed. Check for updates again.")
            if candidate.exists():
                shutil.rmtree(candidate)
            download_source(commit, candidate)
            self.set_state("installing", "Installing the update’s dependencies…")
            env = {**os.environ, **self.values, "ANM_INSTALL_ROOT": str(self.home), "PIP_CACHE_DIR": str(self.home / "tools/cache/pip"), "npm_config_cache": str(self.home / "tools/cache/npm")}
            (candidate / ".env").write_text("\n".join(f"{key}={json.dumps(value)}" for key, value in self.values.items()) + "\n", encoding="utf-8")
            if os.name != "nt":
                (candidate / ".env").chmod(0o600)
            write_json(candidate / ".aura" / "install.json", {"commit": commit, "managed": True})
            self._run([sys.executable, str(candidate / "scripts" / "start_aura.py"), "--setup-only", "--skip-migrations"], candidate, env)
            self.set_state("building", "Building the updated app…")
            npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
            if not npm:
                raise UpdateError("Node.js could not be found. Run the setup script again.")
            self._run([npm, "run", "build"], candidate, env)
            database_path(self.values)  # Refuse a storage move before stopping the old app.
            self.set_state("restarting", "Restarting ANM Player…")
            self.restart(candidate, env)
            if read_json(self.home / "current.json").get("root") != str(candidate.resolve()):
                write_json(self.home / "current.json", {"root": str(candidate.resolve()), "commit": commit, "previous_root": str(self.root.resolve())})
            self.set_state("completed", "Update installed. Opening your refreshed app…", installed_commit=commit)
            stable_bootstrap = self.home / "bootstrap.py"
            if stable_bootstrap.is_file() and (candidate / "scripts/bootstrap.py").is_file():
                try:
                    temporary = stable_bootstrap.with_suffix(".next.py")
                    shutil.copyfile(candidate / "scripts/bootstrap.py", temporary)
                    os.replace(temporary, stable_bootstrap)
                except OSError:
                    try:
                        temporary.unlink(missing_ok=True)
                    except OSError:
                        pass
            cleanup_updates(self.home, candidate, self.root, user_paths=self.user_paths())
        except Exception as exc:
            if candidate is not None and candidate != self.root and read_json(self.home / "current.json").get("root") != str(candidate.resolve()) and not any(path.resolve().is_relative_to(candidate.resolve()) for path in self.user_paths()):
                shutil.rmtree(candidate, ignore_errors=True)
            fallback = "Couldn’t check for updates. Check your connection and try again." if commit is None else "The update could not finish. Your previous app has been kept. Check your connection and try again."
            self.set_state("error", str(exc) if isinstance(exc, UpdateError) else fallback)
        finally:
            with self.lock:
                self.running = False
