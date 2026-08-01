import asyncio
import logging
from collections import defaultdict
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class DownloadProgressHub:
    def __init__(self) -> None:
        self._connections: dict[int, set[WebSocket]] = defaultdict(set)
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop | None) -> None:
        self._loop = loop

    async def connect(self, job_id: int, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections[job_id].add(websocket)

    def disconnect(self, job_id: int, websocket: WebSocket) -> None:
        self._connections[job_id].discard(websocket)
        if not self._connections[job_id]:
            self._connections.pop(job_id, None)

    async def broadcast(self, job_id: int, payload: dict[str, Any]) -> None:
        stale: list[WebSocket] = []
        for websocket in self._connections.get(job_id, set()):
            try:
                await websocket.send_json(payload)
            except Exception:
                stale.append(websocket)

        for websocket in stale:
            self.disconnect(job_id, websocket)

    def publish_threadsafe(self, job_id: int, payload: dict[str, Any]) -> None:
        loop = self._loop
        if not loop or loop.is_closed():
            return
        coroutine = self.broadcast(job_id, payload)
        try:
            future = asyncio.run_coroutine_threadsafe(coroutine, loop)
        except RuntimeError:
            coroutine.close()
            return

        def consume_result(completed) -> None:
            try:
                completed.result()
            except Exception:
                logger.debug("download progress broadcast did not complete", exc_info=True)

        future.add_done_callback(consume_result)


download_progress_hub = DownloadProgressHub()
