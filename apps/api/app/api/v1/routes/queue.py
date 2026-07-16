from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.deps import LimitQuery, OffsetQuery, get_placeholder_service, get_queue_service
from app.schemas.common import PlaceholderResponse
from app.schemas.music import QueueItemResponse
from app.services import PlaceholderService, QueueService

router = APIRouter()


@router.get("", response_model=list[QueueItemResponse], summary="List queue items")
def list_queue_items(
    service: Annotated[QueueService, Depends(get_queue_service)],
    limit: LimitQuery = 50,
    offset: OffsetQuery = 0,
) -> list[QueueItemResponse]:
    return service.list_items(limit=limit, offset=offset)


@router.get("/placeholder", response_model=PlaceholderResponse, summary="Queue placeholder")
def queue_placeholder(service: Annotated[PlaceholderService, Depends(get_placeholder_service)]) -> PlaceholderResponse:
    return service.response(
        feature="queue",
        message="Queue API structure is present. Background workers and live progress updates are not implemented.",
        extension_points=["QueueService", "worker dispatch", "WebSockets"],
    )
