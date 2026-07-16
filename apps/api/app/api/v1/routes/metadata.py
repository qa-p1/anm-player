"""
Metadata Enrichment API routes.

Provides endpoints for searching and applying metadata from external providers.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.deps import get_catalog_service, get_metadata_service
from app.schemas.music import AlbumResponse, SongResponse
from app.services.catalog import CatalogService
from app.services.metadata.service import MetadataEnrichmentService

router = APIRouter()


class MetadataSearchRequest(BaseModel):
    title: str | None = None
    artist: str | None = None
    album: str | None = None
    duration_ms: int | None = None
    provider: str | None = None
    limit: int = 5


class MetadataSearchResult(BaseModel):
    title: str | None
    artist: str | None
    album: str | None
    album_artist: str | None
    track_number: int | None
    total_tracks: int | None
    year: int | None
    genre: list[str] | None
    isrc: str | None
    provider_track_id: str | None
    provider_release_id: str | None
    artwork_url: str | None
    provider: str | None
    confidence: float


class EnrichSongRequest(BaseModel):
    provider: str | None = None


@router.post("/search", response_model=list[MetadataSearchResult])
async def search_metadata(
    request: MetadataSearchRequest,
    metadata_service: Annotated[MetadataEnrichmentService, Depends(get_metadata_service)],
) -> list[MetadataSearchResult]:
    """
    Search for metadata from external providers without applying to database.
    
    Useful for previewing metadata before enrichment.
    
    Metadata enrichment now relies on YouTube Music data collected during browse
    and download flows, so this endpoint returns no external-provider matches.
    """
    results = await metadata_service.search_metadata(
        title=request.title,
        artist=request.artist,
        album=request.album,
        duration_ms=request.duration_ms,
        provider_name=request.provider,
        limit=request.limit,
    )
    
    return [
        MetadataSearchResult(
            title=r.title,
            artist=r.artist,
            album=r.album,
            album_artist=r.album_artist,
            track_number=r.track_number,
            total_tracks=r.total_tracks,
            year=r.year,
            genre=r.genre,
            isrc=r.isrc,
            provider_track_id=r.provider_track_id,
            provider_release_id=r.provider_release_id,
            artwork_url=r.artwork_url,
            provider=r.provider,
            confidence=r.confidence,
        )
        for r in results
    ]


@router.post("/songs/{song_id}/enrich", response_model=SongResponse)
async def enrich_song(
    song_id: int,
    request: EnrichSongRequest,
    catalog_service: Annotated[CatalogService, Depends(get_catalog_service)],
    metadata_service: Annotated[MetadataEnrichmentService, Depends(get_metadata_service)],
) -> SongResponse:
    """
    Enrich a song with metadata from external providers.
    
    This will:
    1. Search for matching metadata
    2. Select the best match by confidence
    3. Update song, artist, and album metadata
    4. Fetch and cache artwork if available
    """
    song = await metadata_service.enrich_song(song_id, request.provider)
    
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")

    return catalog_service._song_to_response(song)


@router.post("/albums/{album_id}/enrich", response_model=AlbumResponse)
async def enrich_album(
    album_id: int,
    catalog_service: Annotated[CatalogService, Depends(get_catalog_service)],
    metadata_service: Annotated[MetadataEnrichmentService, Depends(get_metadata_service)],
) -> AlbumResponse:
    """
    Enrich all songs in an album with metadata.
    
    This is a batch operation that enriches all songs in the album.
    """
    album = await metadata_service.enrich_album(album_id)
    
    if not album:
        raise HTTPException(status_code=404, detail="Album not found")

    return catalog_service._album_to_response_simple(album)


@router.get("/providers")
def list_providers(
    metadata_service: Annotated[MetadataEnrichmentService, Depends(get_metadata_service)],
) -> list[dict[str, str]]:
    """
    List available metadata providers.
    
    Returns information about each provider including:
    - name: Provider identifier
    - display_name: Human-readable name
    - features: What the provider supports
    """
    return [{"name": provider.name, "display_name": provider.name.replace("_", " ").title()} for provider in metadata_service.providers]
