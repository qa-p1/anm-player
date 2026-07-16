from typing import Annotated

from fastapi import APIRouter, Depends, Query

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


@router.get("/search", response_model=list[SongResponse], summary="Search songs locally")
def search_songs(
    service: Annotated[CatalogService, Depends(get_catalog_service)],
    q: Annotated[str, Query(min_length=1, max_length=200, description="Search query")],
    limit: LimitQuery = 50,
) -> list[SongResponse]:
    return service.search_songs(q, limit=limit)


@router.get("/favorites", response_model=list[SongResponse], summary="List favorite songs")
def list_favorite_songs(
    service: Annotated[CatalogService, Depends(get_catalog_service)],
    limit: LimitQuery = 50,
    offset: OffsetQuery = 0,
) -> list[SongResponse]:
    return service.list_favorite_songs(limit=limit, offset=offset)


@router.get("/recently-played", response_model=list[SongResponse], summary="List recently played songs")
def get_recently_played(
    service: Annotated[CatalogService, Depends(get_catalog_service)],
    limit: LimitQuery = 50,
) -> list[SongResponse]:
    return service.get_recently_played(limit=limit)


@router.get("/most-played", response_model=list[SongResponse], summary="List most played songs")
def get_most_played(
    service: Annotated[CatalogService, Depends(get_catalog_service)],
    limit: LimitQuery = 50,
) -> list[SongResponse]:
    return service.get_most_played(limit=limit)


@router.get("/recently-added", response_model=list[SongResponse], summary="List recently added songs")
def get_recently_added(
    service: Annotated[CatalogService, Depends(get_catalog_service)],
    limit: LimitQuery = 50,
) -> list[SongResponse]:
    return service.get_recently_added(limit=limit)


@router.get("/random", response_model=list[SongResponse], summary="Get random songs")
def get_random_songs(
    service: Annotated[CatalogService, Depends(get_catalog_service)],
    limit: LimitQuery = 10,
) -> list[SongResponse]:
    return service.get_random_songs(limit=limit)


@router.get("/{song_id}", response_model=SongResponse, summary="Get song by ID")
def get_song(
    service: Annotated[CatalogService, Depends(get_catalog_service)],
    song_id: int,
) -> SongResponse:
    return service.get_song(song_id)
