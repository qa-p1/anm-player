from __future__ import annotations

from app.api.error_handlers import api_error_response
from app.storage.coordinator import StorageMigrationError, storage_coordinator


class StorageGateMiddleware:
    """Pure ASGI gate that also counts local streams until their final body."""

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path = scope.get("path", "")
        allowed = "/health" in path or path.endswith("/settings/storage/migrations/current")
        if storage_coordinator.gated.is_set() and not allowed:
            await self._locked(scope, receive, send)
            return

        starts_migration = path.endswith("/settings/storage/migrations") and scope.get("method") == "POST"
        if starts_migration or allowed:
            await self.app(scope, receive, send)
            return

        try:
            with storage_coordinator.filesystem_read():
                await self._serve_counted_stream(scope, receive, send, path)
        except StorageMigrationError:
            await self._locked(scope, receive, send)

    async def _locked(self, scope, receive, send) -> None:
        response = api_error_response(
            status_code=423,
            code="storage_migration_in_progress",
            message="ANM Player storage is temporarily locked. Try again when the current storage operation completes.",
            details={"migration": storage_coordinator.status()},
        )
        await response(scope, receive, send)

    async def _serve_counted_stream(self, scope, receive, send, path: str) -> None:
        is_local_stream = "/media/songs/" in path or "/media/library-tracks/" in path
        if not is_local_stream:
            await self.app(scope, receive, send)
            return
        storage_coordinator.stream_opened()
        closed = False

        async def counted_send(message) -> None:
            nonlocal closed
            await send(message)
            if message["type"] == "http.response.body" and not message.get("more_body", False) and not closed:
                closed = True
                storage_coordinator.stream_closed()

        try:
            await self.app(scope, receive, counted_send)
        finally:
            if not closed:
                storage_coordinator.stream_closed()
