from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services.websocket_manager import download_progress_hub

router = APIRouter()


@router.websocket("/downloads/{job_id}/events")
async def download_events(websocket: WebSocket, job_id: int) -> None:
    await download_progress_hub.connect(job_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        download_progress_hub.disconnect(job_id, websocket)
