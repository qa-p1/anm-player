import asyncio

import app.services.websocket_manager as websocket_module
from app.services.websocket_manager import DownloadProgressHub


class FakeWebSocket:
    def __init__(self, *, fail_send: bool = False) -> None:
        self.accepted = False
        self.fail_send = fail_send
        self.payloads: list[dict] = []

    async def accept(self) -> None:
        self.accepted = True

    async def send_json(self, payload: dict) -> None:
        if self.fail_send:
            raise RuntimeError("connection closed")
        self.payloads.append(payload)


def test_progress_hub_accepts_broadcasts_and_prunes_stale_connections() -> None:
    hub = DownloadProgressHub()
    healthy = FakeWebSocket()
    stale = FakeWebSocket(fail_send=True)

    async def exercise() -> None:
        await hub.connect(7, healthy)
        await hub.connect(7, stale)
        await hub.broadcast(7, {"progress": 42})

    asyncio.run(exercise())

    assert healthy.accepted and stale.accepted
    assert healthy.payloads == [{"progress": 42}]
    assert hub._connections[7] == {healthy}
    hub.disconnect(7, healthy)
    assert 7 not in hub._connections


def test_threadsafe_publish_handles_missing_closed_and_racing_loops(monkeypatch) -> None:
    hub = DownloadProgressHub()

    class FakeLoop:
        def __init__(self, *, closed: bool = False) -> None:
            self.closed = closed

        def is_closed(self) -> bool:
            return self.closed

    hub.publish_threadsafe(1, {"state": "ignored"})
    hub.bind_loop(FakeLoop(closed=True))
    hub.publish_threadsafe(1, {"state": "ignored"})

    def fail_to_schedule(coroutine, _loop):
        raise RuntimeError("loop stopped")

    monkeypatch.setattr(websocket_module.asyncio, "run_coroutine_threadsafe", fail_to_schedule)
    hub.bind_loop(FakeLoop())
    hub.publish_threadsafe(1, {"state": "raced"})


def test_threadsafe_publish_consumes_background_failures(monkeypatch) -> None:
    hub = DownloadProgressHub()

    class FakeLoop:
        def is_closed(self) -> bool:
            return False

    class FailedFuture:
        def __init__(self, coroutine) -> None:
            self.coroutine = coroutine

        def add_done_callback(self, callback) -> None:
            self.coroutine.close()
            callback(self)

        def result(self) -> None:
            raise RuntimeError("broadcast failed")

    monkeypatch.setattr(
        websocket_module.asyncio,
        "run_coroutine_threadsafe",
        lambda coroutine, _loop: FailedFuture(coroutine),
    )
    hub.bind_loop(FakeLoop())

    hub.publish_threadsafe(9, {"progress": 5})
