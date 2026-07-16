from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.deps import LimitQuery, OffsetQuery, get_catalog_service
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


@router.get("/favorites", response_model=list[ArtistResponse], summary="List favorite artists")
def list_favorite_artists(
    service: Annotated[CatalogService, Depends(get_catalog_service)],
    limit: LimitQuery = 50,
    offset: OffsetQuery = 0,
) -> list[ArtistResponse]:
    return service.list_favorite_artists(limit=limit, offset=offset)


@router.get("/random", response_model=list[ArtistResponse], summary="Get random artists")
def get_random_artists(
    service: Annotated[CatalogService, Depends(get_catalog_service)],
    limit: LimitQuery = 5,
) -> list[ArtistResponse]:
    return service.get_random_artists(limit=limit)


@router.get("/{artist_id}", response_model=ArtistDetailResponse, summary="Get artist by ID")
def get_artist(
    service: Annotated[CatalogService, Depends(get_catalog_service)],
    artist_id: int,
) -> ArtistDetailResponse:
    return service.get_artist(artist_id)
