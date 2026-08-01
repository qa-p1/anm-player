from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.deps import LimitQuery, OffsetQuery, get_catalog_service
from app.schemas.music import SongResponse
from app.services import CatalogService

router = APIRouter()


@router.get("", response_model=list[SongResponse], summary="List songs")
def list_songs(
    service: Annotated[CatalogService, Depends(get_catalog_service)],
    limit: LimitQuery = 50,
    offset: OffsetQuery = 0,
) -> list[SongResponse]:
    return service.list_songs(limit=limit, offset=offset)
