from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.api.deps import get_advanced_search_service, get_catalog_service
from app.schemas.music import SongResponse
from app.services.advanced_search import AdvancedSearchService, SearchFilters
from app.services.catalog import CatalogService

router = APIRouter()


@router.get("/songs", response_model=list[SongResponse])
def advanced_search_songs(
    catalog: Annotated[CatalogService, Depends(get_catalog_service)],
    search: Annotated[AdvancedSearchService, Depends(get_advanced_search_service)],
    q: Annotated[str | None, Query(max_length=200)] = None,
    artist_ids: Annotated[str | None, Query(max_length=1000, pattern=r"^\d+(,\d+)*$")] = None,
    album_ids: Annotated[str | None, Query(max_length=1000, pattern=r"^\d+(,\d+)*$")] = None,
    year_min: Annotated[int | None, Query(ge=1900, le=2100)] = None,
    year_max: Annotated[int | None, Query(ge=1900, le=2100)] = None,
    duration_min: Annotated[int | None, Query(ge=0, le=7200)] = None,
    duration_max: Annotated[int | None, Query(ge=0, le=7200)] = None,
    has_artwork: bool | None = None,
    sort_by: Annotated[str, Query(pattern="^(relevance|title|artist|album|year|duration|date_added)$")] = "relevance",
    sort_order: Annotated[str, Query(pattern="^(asc|desc)$")] = "asc",
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0, le=1_000_000)] = 0,
) -> list[SongResponse]:
    artist_id_list = [int(value) for value in artist_ids.split(",")] if artist_ids else None
    album_id_list = [int(value) for value in album_ids.split(",")] if album_ids else None
    filters = SearchFilters(
        query=q,
        artist_ids=artist_id_list,
        album_ids=album_id_list,
        year_min=year_min,
        year_max=year_max,
        duration_min=duration_min,
        duration_max=duration_max,
        has_artwork=has_artwork,
        sort_by=sort_by,
        sort_order=sort_order,
        limit=limit,
        offset=offset,
    )
    return [catalog._song_to_response(song) for song in search.search_songs(filters)]
