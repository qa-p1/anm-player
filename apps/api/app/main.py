import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware

from app.api.error_handlers import app_error_handler, unhandled_error_handler, validation_error_handler
from app.api.v1.router import api_v1_router
from app.core.config import settings
from app.core.exceptions import AppError
from app.core.logging import configure_logging
from app.database.session import SessionLocal
from app.services.library_scanner import LibraryScannerService
from app.services.settings import SettingsService
from app.storage import storage_manager
from app.storage.coordinator import storage_coordinator
from app.storage.middleware import StorageGateMiddleware
from app.services.websocket_manager import download_progress_hub
from app.workers.downloads.worker import download_worker

logger = logging.getLogger(__name__)


def _startup_scan() -> None:
    try:
        with storage_coordinator.filesystem_read():
            with SessionLocal() as session:
                LibraryScannerService(session, cancel_event=storage_coordinator.cancel_work).scan_directory(
                    storage_manager.paths.music
                )
    except Exception:
        logger.exception("startup library scan failed")


async def _start_runtime_work() -> None:
    download_worker.start()
    await _schedule_scan_if_enabled()


async def _schedule_scan_if_enabled() -> None:
    with SessionLocal() as session:
        enabled = SettingsService(session).get_bool("startup_scan_enabled", True)
    if enabled:
        asyncio.create_task(asyncio.to_thread(_startup_scan), name="aura-startup-library-scan")


async def _finish_recovery_then_start() -> None:
    while storage_coordinator.migration_active:
        state = storage_coordinator.status()
        if state.get("phase") in {"blocked", "failed"}:
            return
        await asyncio.sleep(0.5)
    await _start_runtime_work()


async def _monitor_runtime_migrations(*, skip_first_completion: bool) -> None:
    was_gated = storage_coordinator.gated.is_set()
    while True:
        await asyncio.sleep(0.5)
        gated = storage_coordinator.gated.is_set()
        if was_gated and not gated:
            if skip_first_completion:
                skip_first_completion = False
            else:
                await _schedule_scan_if_enabled()
        was_gated = gated


@asynccontextmanager
async def lifespan(_: FastAPI):
    storage_manager.initialize()
    download_progress_hub.bind_loop(asyncio.get_running_loop())
    recovery_task: asyncio.Task | None = None
    if storage_coordinator.migration_active:
        storage_coordinator.recover()
        recovery_task = asyncio.create_task(_finish_recovery_then_start(), name="aura-storage-recovery-monitor")
    else:
        await _start_runtime_work()
    monitor_task = asyncio.create_task(
        _monitor_runtime_migrations(skip_first_completion=recovery_task is not None),
        name="aura-storage-migration-monitor",
    )
    try:
        yield
    finally:
        if recovery_task:
            recovery_task.cancel()
        monitor_task.cancel()
        download_worker.stop()


def create_app() -> FastAPI:
    configure_logging()

    app = FastAPI(
        title=f"{settings.app_name} API",
        version=settings.app_version,
        description="Self-hosted music app API foundation.",
        openapi_url=f"{settings.api_prefix}/openapi.json",
        docs_url=f"{settings.api_prefix}/docs",
        redoc_url=f"{settings.api_prefix}/redoc",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(StorageGateMiddleware)

    app.add_exception_handler(AppError, app_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.add_exception_handler(Exception, unhandled_error_handler)

    app.include_router(api_v1_router, prefix=settings.api_prefix)
    return app


app = create_app()
