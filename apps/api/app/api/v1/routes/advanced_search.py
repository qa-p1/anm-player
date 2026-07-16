"""
Advanced Search API routes.

Provides advanced filtering and search capabilities for the local library.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.api.deps import get_advanced_search_service, get_catalog_service
from app.schemas.music import AlbumResponse, ArtistResponse, SongResponse
from app.services.advanced_search import AdvancedSearchService, SearchFilters
from app.services.catalog import CatalogService

router = APIRouter()


@router.get("/songs", response_model=list[SongResponse])
def advanced_search_songs(
    catalog: Annotated[CatalogService, Depends(get_catalog_service)],
    search: Annotated[AdvancedSearchService, Depends(get_advanced_search_service)],
    q: Annotated[str | None, Query(description="Search query")] = None,
    artist_ids: Annotated[str | None, Query(description="Comma-separated artist IDs")] = None,
    album_ids: Annotated[str | None, Query(description="Comma-separated album IDs")] = None,
    year_min: Annotated[int | None, Query(description="Minimum year", ge=1900)] = None,
    year_max: Annotated[int | None, Query(description="Maximum year", le=2100)] = None,
    duration_min: Annotated[int | None, Query(description="Minimum duration in seconds", ge=0)] = None,
    duration_max: Annotated[int | None, Query(description="Maximum duration in seconds", le=7200)] = None,
    has_artwork: Annotated[bool | None, Query(description="Filter by artwork availability")] = None,
    sort_by: Annotated[str, Query(description="Sort field")] = "relevance",
    sort_order: Annotated[str, Query(description="Sort order: asc or desc")] = "asc",
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[SongResponse]:
    """
    Advanced search for songs with multiple filter options.
    
    Features:
    - Fuzzy text search across title, artist, and album
    - Filter by artist(s), album(s), year range, duration range
    - Filter by artwork availability
    - Multiple sort options: relevance, title, artist, album, year, duration, date_added
    - Pagination support
    """
    # Parse comma-separated IDs
    artist_id_list = [int(id.strip()) for id in artist_ids.split(",") if id.strip()] if artist_ids else None
    album_id_list = [int(id.strip()) for id in album_ids.split(",") if id.strip()] if album_ids else None
    
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
    
    songs = search.search_songs(filters)
    return [catalog._song_to_response(song) for song in songs]


@router.get("/albums", response_model=list[AlbumResponse])
def advanced_search_albums(
    catalog: Annotated[CatalogService, Depends(get_catalog_service)],
    search: Annotated[AdvancedSearchService, Depends(get_advanced_search_service)],
    q: Annotated[str | None, Query(description="Search query")] = None,
    artist_ids: Annotated[str | None, Query(description="Comma-separated artist IDs")] = None,
    year_min: Annotated[int | None, Query(description="Minimum year", ge=1900)] = None,
    year_max: Annotated[int | None, Query(description="Maximum year", le=2100)] = None,
    has_artwork: Annotated[bool | None, Query(description="Filter by artwork availability")] = None,
    sort_by: Annotated[str, Query(description="Sort field")] = "title",
    sort_order: Annotated[str, Query(description="Sort order: asc or desc")] = "asc",
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[AlbumResponse]:
    """
    Advanced search for albums with multiple filter options.
    """
    artist_id_list = [int(id.strip()) for id in artist_ids.split(",") if id.strip()] if artist_ids else None
    
    filters = SearchFilters(
        query=q,
        artist_ids=artist_id_list,
        year_min=year_min,
        year_max=year_max,
        has_artwork=has_artwork,
        sort_by=sort_by,
        sort_order=sort_order,
        limit=limit,
        offset=offset,
    )
    
    albums = search.search_albums(filters)
    return [catalog._album_to_response_simple(album) for album in albums]


@router.get("/artists", response_model=list[ArtistResponse])
def advanced_search_artists(
    catalog: Annotated[CatalogService, Depends(get_catalog_service)],
    search: Annotated[AdvancedSearchService, Depends(get_advanced_search_service)],
    q: Annotated[str | None, Query(description="Search query")] = None,
    has_artwork: Annotated[bool | None, Query(description="Filter by artwork availability")] = None,
    sort_by: Annotated[str, Query(description="Sort field")] = "title",
    sort_order: Annotated[str, Query(description="Sort order: asc or desc")] = "asc",
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[ArtistResponse]:
    """
    Advanced search for artists with multiple filter options.
    """
    filters = SearchFilters(
        query=q,
        has_artwork=has_artwork,
        sort_by=sort_by,
        sort_order=sort_order,
        limit=limit,
        offset=offset,
    )
    
    artists = search.search_artists(filters)
    
    # Get counts for each artist
    from app.repositories.music import ArtistRepository
    artist_repo = ArtistRepository(search.session)
    result = []
    for artist in artists:
        # Simple count (can be optimized)
        song_count = len([s for s in artist.songs if s.is_downloaded])
        album_count = len(artist.albums)
        result.append(catalog._artist_to_response(artist, song_count, album_count))
    
    return result


@router.get("/filter-options")
def get_filter_options(
    search: Annotated[AdvancedSearchService, Depends(get_advanced_search_service)],
) -> dict:
    """
    Get available filter options for dropdowns.
    
    Returns available years and genres in the library.
    """
    return {
        "years": search.get_available_years(),
        "genres": search.get_available_genres(),
    }
