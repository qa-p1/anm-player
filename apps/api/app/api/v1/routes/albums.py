from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select

from app.api.deps import ProviderId, ResourceId, get_library_album_service, require_operator
from app.schemas.library import AlbumDownloadCreateRequest, AlbumFavoriteRequest, UnifiedAlbumResponse
from app.models import LibraryAlbum
from app.services import LibraryAlbumService

router = APIRouter()


@router.get("/legacy/{album_id}/public-id", response_model=dict[str, str], summary="Resolve a legacy local album ID")
def resolve_legacy_album_public_id(
    service: Annotated[LibraryAlbumService, Depends(get_library_album_service)],
    album_id: ResourceId,
) -> dict[str, str]:
    album = service.session.scalars(select(LibraryAlbum).where(LibraryAlbum.local_album_id == album_id)).first()
    if not album:
        raise HTTPException(status_code=404, detail="Canonical album not found")
    return {"public_id": album.public_id, "canonical_url": f"/albums/{album.public_id}"}


@router.get("/{public_id}", response_model=UnifiedAlbumResponse, summary="Get album by permanent public ID")
async def get_unified_album(
    service: Annotated[LibraryAlbumService, Depends(get_library_album_service)],
    public_id: ProviderId,
) -> UnifiedAlbumResponse:
    return await service.get_unified_album(public_id)


@router.put("/{public_id}/library", response_model=UnifiedAlbumResponse, dependencies=[Depends(require_operator)])
async def add_unified_album_to_library(
    service: Annotated[LibraryAlbumService, Depends(get_library_album_service)],
    public_id: ProviderId,
) -> UnifiedAlbumResponse:
    return await service.add_unified_album_to_library(public_id)


@router.delete("/{public_id}/library", response_model=UnifiedAlbumResponse, dependencies=[Depends(require_operator)])
async def remove_unified_album_from_library(
    service: Annotated[LibraryAlbumService, Depends(get_library_album_service)],
    public_id: ProviderId,
    delete_downloads: bool = False,
) -> UnifiedAlbumResponse:
    return await service.remove_unified_album_from_library(public_id, delete_downloads=delete_downloads)


@router.put("/{public_id}/favorite", response_model=UnifiedAlbumResponse, dependencies=[Depends(require_operator)])
async def set_unified_album_favorite(
    request: AlbumFavoriteRequest,
    service: Annotated[LibraryAlbumService, Depends(get_library_album_service)],
    public_id: ProviderId,
) -> UnifiedAlbumResponse:
    return await service.set_unified_album_favorite(public_id, request.is_favorited)


@router.post("/{public_id}/download", response_model=UnifiedAlbumResponse, dependencies=[Depends(require_operator)])
async def download_unified_album(
    service: Annotated[LibraryAlbumService, Depends(get_library_album_service)],
    public_id: ProviderId,
    request: AlbumDownloadCreateRequest | None = None,
) -> UnifiedAlbumResponse:
    return await service.download_unified_album(public_id, max_parallel=request.max_parallel if request else None)


@router.post("/{public_id}/download/cancel", response_model=UnifiedAlbumResponse, dependencies=[Depends(require_operator)])
async def cancel_unified_album_download(
    service: Annotated[LibraryAlbumService, Depends(get_library_album_service)],
    public_id: ProviderId,
) -> UnifiedAlbumResponse:
    return await service.cancel_unified_album_download(public_id)


@router.delete("/{public_id}/download", response_model=UnifiedAlbumResponse, dependencies=[Depends(require_operator)])
async def remove_unified_album_download(
    service: Annotated[LibraryAlbumService, Depends(get_library_album_service)],
    public_id: ProviderId,
) -> UnifiedAlbumResponse:
    return await service.remove_unified_album_download(public_id)
