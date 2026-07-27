from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.deps import ResourceId, get_catalog_service, get_metadata_service
from app.schemas.music import SongResponse
from app.services.catalog import CatalogService
from app.services.metadata.service import MetadataEnrichmentService

router = APIRouter()


class EnrichSongRequest(BaseModel):
    provider: str | None = Field(default=None, max_length=80)


@router.post("/songs/{song_id}/enrich", response_model=SongResponse)
async def enrich_song(
    song_id: ResourceId,
    request: EnrichSongRequest,
    catalog_service: Annotated[CatalogService, Depends(get_catalog_service)],
    metadata_service: Annotated[MetadataEnrichmentService, Depends(get_metadata_service)],
) -> SongResponse:
    song = await metadata_service.enrich_song(song_id, request.provider)
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    return catalog_service._song_to_response(song)
