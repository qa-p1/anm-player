from typing import Annotated

from fastapi import APIRouter, Depends, Path, WebSocket, WebSocketDisconnect

from app.api.deps import require_websocket_operator

from app.services.websocket_manager import download_progress_hub

router = APIRouter()


@router.websocket("/downloads/{job_id}/events", dependencies=[Depends(require_websocket_operator)])
async def download_events(
    websocket: WebSocket,
    job_id: Annotated[int, Path(ge=1, le=2_147_483_647)],
) -> None:
    await download_progress_hub.connect(job_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        download_progress_hub.disconnect(job_id, websocket)
