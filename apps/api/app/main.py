import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.openapi.docs import get_redoc_html, get_swagger_ui_html
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse

from app.api.deps import require_operator
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
LIBRARY_RECONCILE_INTERVAL_SECONDS = 30


def _startup_scan() -> None:
    try:
        with storage_coordinator.filesystem_read():
            with SessionLocal() as session:
                LibraryScannerService(session, cancel_event=storage_coordinator.cancel_work).scan_directory(
                    storage_manager.paths.music
                )
    except Exception:
        logger.exception("startup library scan failed")


def _reconcile_library() -> None:
    try:
        with storage_coordinator.filesystem_read():
            with SessionLocal() as session:
                result = LibraryScannerService(
                    session,
                    cancel_event=storage_coordinator.cancel_work,
                ).scan_directory(
                    storage_manager.paths.music,
                    refresh_existing_metadata=False,
                )
        changed = result.added + result.updated + result.removed + result.reconciled
        if changed or result.errors:
            logger.info(
                "background library sync changed %s records and encountered %s errors",
                changed,
                result.errors,
            )
    except Exception:
        if not storage_coordinator.gated.is_set():
            logger.exception("background library reconciliation failed")


async def _library_reconcile_loop() -> None:
    while True:
        await asyncio.sleep(LIBRARY_RECONCILE_INTERVAL_SECONDS)
        if storage_coordinator.gated.is_set():
            continue
        await asyncio.to_thread(_reconcile_library)


async def _start_runtime_work() -> None:
    download_worker.start()
    await _schedule_scan_if_enabled()


async def _schedule_scan_if_enabled() -> None:
    with SessionLocal() as session:
        enabled = SettingsService(session).get_bool("startup_scan_enabled", True)
    if enabled:
        asyncio.create_task(asyncio.to_thread(_startup_scan), name="aura-startup-library-scan")


async def _finish_recovery_then_start() -> None:
    while storage_coordinator.gated.is_set():
        state = storage_coordinator.status()
        if state.get("phase") == "blocked":
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
    reconcile_task = asyncio.create_task(
        _library_reconcile_loop(),
        name="aura-library-reconcile",
    )
    try:
        yield
    finally:
        if recovery_task:
            recovery_task.cancel()
        monitor_task.cancel()
        reconcile_task.cancel()
        await asyncio.gather(
            *(task for task in (recovery_task, monitor_task, reconcile_task) if task is not None),
            return_exceptions=True,
        )
        download_worker.stop()
        download_progress_hub.bind_loop(None)


def create_app() -> FastAPI:
    configure_logging()

    app = FastAPI(
        title=f"{settings.app_name} API",
        version=settings.app_version,
        description="Self-hosted music app API foundation.",
        openapi_url=None,
        docs_url=None,
        redoc_url=None,
        lifespan=lifespan,
    )

    app.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=settings.trusted_hosts,
    )
    app.add_middleware(StorageGateMiddleware)

    app.add_exception_handler(AppError, app_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.add_exception_handler(Exception, unhandled_error_handler)

    app.include_router(api_v1_router, prefix=settings.api_prefix)

    @app.get(
        f"{settings.api_prefix}/openapi.json",
        include_in_schema=False,
        dependencies=[Depends(require_operator)],
    )
    def openapi_schema() -> JSONResponse:
        return JSONResponse(app.openapi())

    @app.get(
        f"{settings.api_prefix}/docs",
        include_in_schema=False,
        dependencies=[Depends(require_operator)],
    )
    def swagger_docs():
        return get_swagger_ui_html(
            openapi_url=f"{settings.api_prefix}/openapi.json",
            title=f"{settings.app_name} API documentation",
        )

    @app.get(
        f"{settings.api_prefix}/redoc",
        include_in_schema=False,
        dependencies=[Depends(require_operator)],
    )
    def redoc_docs():
        return get_redoc_html(
            openapi_url=f"{settings.api_prefix}/openapi.json",
            title=f"{settings.app_name} API documentation",
        )

    return app


app = create_app()
