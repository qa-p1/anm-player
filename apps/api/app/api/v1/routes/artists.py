from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.deps import LimitQuery, OffsetQuery, ResourceId, get_catalog_service
from app.schemas.music import ArtistDetailResponse, ArtistResponse
from app.services import CatalogService

router = APIRouter()


@router.get("", response_model=list[ArtistResponse], summary="List artists")
def list_artists(
    service: Annotated[CatalogService, Depends(get_catalog_service)],
    limit: LimitQuery = 50,
    offset: OffsetQuery = 0,
) -> list[ArtistResponse]:
    return service.list_artists(limit=limit, offset=offset)


@router.get("/{artist_id}", response_model=ArtistDetailResponse, summary="Get artist by ID")
def get_artist(
    service: Annotated[CatalogService, Depends(get_catalog_service)],
    artist_id: ResourceId,
) -> ArtistDetailResponse:
    return service.get_artist(artist_id)
