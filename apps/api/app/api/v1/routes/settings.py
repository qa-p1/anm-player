import logging
import os
import shutil
import sqlite3
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from sqlalchemy import select

from app.api.deps import DbSession, get_settings_service, require_operator
from app.models import LyricsCacheEntry, StreamCacheEntry
from app.schemas.settings import SettingsSummary, SettingsUpdateRequest
from app.schemas.storage import (
    CacheClearRequest,
    CacheClearResponse,
    CreateDirectoryRequest,
    DirectoryEntry,
    DirectoryListing,
    StartMigrationRequest,
    StartMigrationResponse,
    StartResetRequest,
    StorageCategoryUsage,
    StorageSummary,
)
from app.services import SettingsService
from app.services.backup import BackupError, backup_filename, create_database_snapshot
from app.storage import storage_manager
from app.storage.coordinator import StorageMigrationError, storage_coordinator

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("", response_model=SettingsSummary, summary="Settings summary")
def settings_summary(service: Annotated[SettingsService, Depends(get_settings_service)]) -> SettingsSummary:
    return service.summary()


@router.patch("", response_model=SettingsSummary, summary="Update settings")
def update_settings(
    request: SettingsUpdateRequest,
    service: Annotated[SettingsService, Depends(get_settings_service)],
) -> SettingsSummary:
    return service.update(request)


def _directory_entry(path: Path) -> DirectoryEntry:
    try:
        first_child = next(path.iterdir(), None)
        disabled = False
        reason = None
        empty = first_child is None
    except OSError:
        disabled = True
        reason = "This directory cannot be read"
        empty = False
    same_device = None
    try:
        same_device = path.stat().st_dev == storage_manager.paths.root.stat().st_dev
    except OSError:
        pass
    return DirectoryEntry(
        directory_id=None if disabled else storage_coordinator.issue_directory(path),
        name=path.name or str(path),
        display_path=str(path),
        disabled=disabled,
        empty=empty,
        same_device=same_device,
        reason=reason,
    )


@router.get("/storage", response_model=StorageSummary, dependencies=[Depends(require_operator)])
def storage_summary() -> StorageSummary:
    paths = storage_manager.paths
    usage = _storage_usage(paths.root)
    disk = shutil.disk_usage(paths.root)
    return StorageSummary(
        data_root=str(paths.root),
        used_bytes=sum(usage.model_dump().values()),
        free_bytes=disk.free,
        total_bytes=disk.total,
        categories=usage,
        migration=storage_coordinator.status(),
    )


@router.get(
    "/backup",
    response_class=FileResponse,
    summary="Download a consistent snapshot of the library database",
    dependencies=[Depends(require_operator)],
)
def download_database_backup() -> FileResponse:
    try:
        snapshot = create_database_snapshot(storage_manager.paths.database)
    except (BackupError, OSError, sqlite3.Error) as exc:
        logger.exception("Could not create a database backup")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Could not create a database backup") from exc
    cleanup = BackgroundTasks()
    cleanup.add_task(snapshot.unlink, missing_ok=True)
    return FileResponse(
        snapshot,
        media_type="application/vnd.sqlite3",
        filename=backup_filename(),
        headers={"Cache-Control": "no-store"},
        background=cleanup,
    )


@router.get("/storage/directories", response_model=DirectoryListing, dependencies=[Depends(require_operator)])
def browse_directories(
    parent_id: str | None = Query(default=None, min_length=1, max_length=4096),
) -> DirectoryListing:
    if parent_id is None:
        roots = storage_coordinator.filesystem_roots()
        return DirectoryListing(directories=[_directory_entry(path) for path in roots])
    try:
        current_path = storage_coordinator.resolve_directory(parent_id)
    except StorageMigrationError as exc:
        logger.warning("Rejected storage directory identifier: %s", exc)
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Directory selection expired or is invalid") from exc
    directories: list[DirectoryEntry] = []
    try:
        candidates = sorted((path for path in current_path.iterdir() if path.is_dir()), key=lambda path: path.name.casefold())
    except OSError as exc:
        logger.warning("Could not list storage directory %s: %s", current_path, exc)
        candidates = []
        current = _directory_entry(current_path)
        current.disabled = True
        current.reason = "This directory cannot be read"
    else:
        current = _directory_entry(current_path)
        directories = [_directory_entry(path) for path in candidates]
    parent = _directory_entry(current_path.parent) if current_path.parent != current_path else None
    return DirectoryListing(current=current, parent=parent, directories=directories)


@router.post("/storage/directories", response_model=DirectoryEntry, dependencies=[Depends(require_operator)])
def create_directory(request: CreateDirectoryRequest) -> DirectoryEntry:
    if request.name in {".", ".."} or request.name != request.name.strip():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid folder name")
    try:
        parent = storage_coordinator.resolve_directory(request.parent_id)
        child = parent / request.name
        child.mkdir()
    except StorageMigrationError as exc:
        logger.warning("Rejected storage directory identifier: %s", exc)
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Directory selection expired or is invalid") from exc
    except FileExistsError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A folder with that name already exists") from exc
    except OSError as exc:
        logger.warning("Could not create storage directory under %s: %s", parent, exc)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Could not create folder") from exc
    return _directory_entry(child)


@router.post(
    "/storage/migrations",
    response_model=StartMigrationResponse,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_operator)],
)
def start_storage_migration(request: StartMigrationRequest) -> StartMigrationResponse:
    try:
        target = storage_coordinator.consume_directory(request.directory_id)
        operation_id = storage_coordinator.start_migration(target)
    except StorageMigrationError as exc:
        already_running = "already" in str(exc).casefold()
        logger.warning("Rejected storage migration request: %s", exc)
        code = status.HTTP_409_CONFLICT if already_running else status.HTTP_422_UNPROCESSABLE_ENTITY
        detail = "A storage migration is already running" if already_running else "Storage migration request was rejected"
        raise HTTPException(status_code=code, detail=detail) from exc
    return StartMigrationResponse(operation_id=operation_id)


@router.post(
    "/storage/reset",
    response_model=StartMigrationResponse,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_operator)],
)
def reset_storage(request: StartResetRequest) -> StartMigrationResponse:
    if request.confirmation != "RESET ANM PLAYER":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Type RESET ANM PLAYER exactly to confirm the fresh start",
        )
    try:
        target = storage_coordinator.consume_directory(request.directory_id)
        operation_id = storage_coordinator.start_reset(target)
    except StorageMigrationError as exc:
        already_running = "already" in str(exc).casefold()
        logger.warning("Rejected fresh-start request: %s", exc)
        code = status.HTTP_409_CONFLICT if already_running else status.HTTP_422_UNPROCESSABLE_ENTITY
        detail = "Another storage operation is already running" if already_running else "Fresh-start request was rejected"
        raise HTTPException(status_code=code, detail=detail) from exc
    return StartMigrationResponse(operation_id=operation_id)


@router.get("/storage/migrations/current", response_model=dict[str, object], dependencies=[Depends(require_operator)])
def current_storage_migration() -> dict[str, object]:
    return storage_coordinator.status()


@router.post("/cache/clear", response_model=CacheClearResponse, dependencies=[Depends(require_operator)])
def clear_cache(request: CacheClearRequest, session: DbSession) -> CacheClearResponse:
    categories = {"artwork", "streams", "lyrics"} if request.category == "all" else {request.category}
    files_removed = bytes_removed = 0
    directories = {
        "artwork": storage_manager.paths.artwork_cache,
        "streams": storage_manager.paths.stream_cache,
        "lyrics": storage_manager.paths.lyrics_cache,
    }
    for category in categories:
        for path in directories[category].rglob("*"):
            if not path.is_file():
                continue
            try:
                bytes_removed += path.stat().st_size
                path.unlink()
                files_removed += 1
            except OSError:
                continue
    if "streams" in categories:
        for entry in session.scalars(select(StreamCacheEntry)):
            try:
                file_exists = storage_manager.paths.stream_file(entry.relative_path).is_file()
            except (OSError, ValueError):
                file_exists = False
            if not file_exists:
                session.delete(entry)
    if "lyrics" in categories:
        for entry in session.scalars(select(LyricsCacheEntry)):
            try:
                file_exists = bool(entry.relative_path) and storage_manager.paths.lyrics_file(entry.relative_path).is_file()
            except (OSError, ValueError):
                file_exists = False
            if not file_exists:
                session.delete(entry)
    session.commit()
    return CacheClearResponse(files_removed=files_removed, bytes_removed=bytes_removed)


def _storage_usage(root: Path) -> StorageCategoryUsage:
    buckets = StorageCategoryUsage()
    mapping = {
        "aura.db": "database",
        "music": "music",
        "downloads": "downloads",
        "cache/artwork": "artwork",
        "cache/lyrics": "lyrics",
        "cache/streams": "streams",
        "config": "config",
        "thumbnails": "thumbnails",
        "logs": "logs",
    }
    values = buckets.model_dump()
    for directory, _children, names in os.walk(root):
        for name in names:
            path = Path(directory) / name
            try:
                size = path.stat().st_size
            except OSError:
                continue
            relative = path.relative_to(root).as_posix()
            category = "other"
            for prefix, candidate in mapping.items():
                if relative == prefix or relative.startswith(f"{prefix}/"):
                    category = candidate
                    break
            values[category] += size
    return StorageCategoryUsage(**values)
