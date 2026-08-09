import asyncio
import json
import threading
from contextlib import contextmanager

import app.storage.middleware as middleware_module
from app.storage.coordinator import StorageMigrationError
from app.storage.middleware import StorageGateMiddleware


class FakeCoordinator:
    def __init__(self) -> None:
        self.gated = threading.Event()
        self.opened = 0
        self.closed = 0
        self.fail_reads = False

    @contextmanager
    def filesystem_read(self):
        if self.fail_reads:
            raise StorageMigrationError("migration started")
        yield

    def stream_opened(self) -> None:
        self.opened += 1

    def stream_closed(self) -> None:
        self.closed += 1

    def status(self) -> dict:
        return {"active": True, "phase": "copying", "percent": 50}


async def receive() -> dict:
    return {"type": "http.request", "body": b"", "more_body": False}


def run_middleware(middleware, scope) -> list[dict]:
    messages: list[dict] = []

    async def send(message) -> None:
        messages.append(message)

    asyncio.run(middleware(scope, receive, send))
    return messages


def test_gate_passes_non_http_and_allowed_health_requests(monkeypatch) -> None:
    coordinator = FakeCoordinator()
    coordinator.gated.set()
    calls: list[str] = []

    async def app(scope, _receive, send) -> None:
        calls.append(scope["type"])
        if scope["type"] == "http":
            await send({"type": "http.response.start", "status": 204, "headers": []})
            await send({"type": "http.response.body", "body": b""})

    monkeypatch.setattr(middleware_module, "storage_coordinator", coordinator)
    middleware = StorageGateMiddleware(app)

    run_middleware(middleware, {"type": "websocket", "path": "/socket"})
    messages = run_middleware(middleware, {"type": "http", "path": "/api/v1/health", "method": "GET"})

    assert calls == ["websocket", "http"]
    assert messages[0]["status"] == 204


def test_gate_returns_structured_locked_response(monkeypatch) -> None:
    coordinator = FakeCoordinator()
    coordinator.gated.set()

    async def app(_scope, _receive, _send) -> None:
        raise AssertionError("locked request reached the application")

    monkeypatch.setattr(middleware_module, "storage_coordinator", coordinator)
    messages = run_middleware(
        StorageGateMiddleware(app),
        {"type": "http", "path": "/api/v1/library", "method": "GET"},
    )

    assert messages[0]["status"] == 423
    body = json.loads(messages[1]["body"])
    assert body["error"]["code"] == "storage_migration_in_progress"
    assert body["error"]["details"]["migration"]["phase"] == "copying"


def test_local_stream_is_counted_until_final_body_and_on_failure(monkeypatch) -> None:
    coordinator = FakeCoordinator()

    async def streaming_app(_scope, _receive, send) -> None:
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"first", "more_body": True})
        await send({"type": "http.response.body", "body": b"last", "more_body": False})

    monkeypatch.setattr(middleware_module, "storage_coordinator", coordinator)
    scope = {"type": "http", "path": "/api/v1/media/songs/1", "method": "GET"}
    messages = run_middleware(StorageGateMiddleware(streaming_app), scope)

    assert len(messages) == 3
    assert coordinator.opened == coordinator.closed == 1

    async def failing_app(_scope, _receive, _send) -> None:
        raise RuntimeError("client disconnected")

    try:
        run_middleware(StorageGateMiddleware(failing_app), scope)
    except RuntimeError as exc:
        assert str(exc) == "client disconnected"
    else:
        raise AssertionError("stream failure was swallowed")
    assert coordinator.opened == coordinator.closed == 2


def test_gate_handles_a_migration_that_starts_during_request_entry(monkeypatch) -> None:
    coordinator = FakeCoordinator()
    coordinator.fail_reads = True

    async def app(_scope, _receive, _send) -> None:
        raise AssertionError("request reached app after storage gate closed")

    monkeypatch.setattr(middleware_module, "storage_coordinator", coordinator)
    messages = run_middleware(
        StorageGateMiddleware(app),
        {"type": "http", "path": "/api/v1/settings", "method": "GET"},
    )
    assert messages[0]["status"] == 423
