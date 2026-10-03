from typing import Annotated

from fastapi import APIRouter, Depends, Response, status

from app.api.deps import LimitQuery, OffsetQuery, ResourceId, get_catalog_service
from app.schemas.music import (
    PlaylistAddSongsRequest,
    PlaylistAddOnlineTrackRequest,
    PlaylistBulkRemoveRequest,
    PlaylistCreateRequest,
    PlaylistDetailResponse,
    PlaylistDuplicateRequest,
    PlaylistReorderRequest,
    PlaylistResponse,
    PlaylistUpdateRequest,
)
from app.services import CatalogService

router = APIRouter()


@router.get("", response_model=list[PlaylistResponse], summary="List playlists")
def list_playlists(
    service: Annotated[CatalogService, Depends(get_catalog_service)],
    limit: LimitQuery = 50,
    offset: OffsetQuery = 0,
) -> list[PlaylistResponse]:
    return service.list_playlists(limit=limit, offset=offset)


@router.post("", response_model=PlaylistResponse, status_code=status.HTTP_201_CREATED, summary="Create playlist")
def create_playlist(
    service: Annotated[CatalogService, Depends(get_catalog_service)],
    request: PlaylistCreateRequest,
) -> PlaylistResponse:
    return service.create_playlist(request)


@router.get("/{playlist_id}", response_model=PlaylistDetailResponse, summary="Get playlist by ID")
def get_playlist(
    service: Annotated[CatalogService, Depends(get_catalog_service)],
    playlist_id: ResourceId,
) -> PlaylistDetailResponse:
    return service.get_playlist(playlist_id)


@router.patch("/{playlist_id}", response_model=PlaylistDetailResponse, summary="Update a playlist")
def update_playlist(
    request: PlaylistUpdateRequest,
    service: Annotated[CatalogService, Depends(get_catalog_service)],
    playlist_id: ResourceId,
) -> PlaylistDetailResponse:
    return service.update_playlist(playlist_id, request)


@router.post(
    "/{playlist_id}/duplicate",
    response_model=PlaylistDetailResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Duplicate a playlist and all of its items",
)
def duplicate_playlist(
    service: Annotated[CatalogService, Depends(get_catalog_service)],
    playlist_id: ResourceId,
    request: PlaylistDuplicateRequest | None = None,
) -> PlaylistDetailResponse:
    return service.duplicate_playlist(playlist_id, request)


@router.put(
    "/{playlist_id}/reorder",
    response_model=PlaylistDetailResponse,
    summary="Replace the complete mixed playlist item order",
)
def reorder_playlist(
    request: PlaylistReorderRequest,
    service: Annotated[CatalogService, Depends(get_catalog_service)],
    playlist_id: ResourceId,
) -> PlaylistDetailResponse:
    return service.reorder_playlist(playlist_id, request)


@router.post(
    "/{playlist_id}/items/bulk-remove",
    response_model=PlaylistDetailResponse,
    summary="Remove multiple mixed playlist items atomically",
)
def bulk_remove_playlist_items(
    request: PlaylistBulkRemoveRequest,
    service: Annotated[CatalogService, Depends(get_catalog_service)],
    playlist_id: ResourceId,
) -> PlaylistDetailResponse:
    return service.bulk_remove_playlist_items(playlist_id, request)


@router.delete(
    "/{playlist_id}/items",
    response_model=PlaylistDetailResponse,
    summary="Clear all playlist items",
)
def clear_playlist_items(
    service: Annotated[CatalogService, Depends(get_catalog_service)],
    playlist_id: ResourceId,
) -> PlaylistDetailResponse:
    return service.clear_playlist(playlist_id)


@router.post(
    "/{playlist_id}/clear",
    response_model=PlaylistDetailResponse,
    summary="Clear all playlist items",
    description="Deprecated alias of `DELETE /playlists/{playlist_id}/items`, kept for existing clients.",
    deprecated=True,
)
def clear_playlist(
    service: Annotated[CatalogService, Depends(get_catalog_service)],
    playlist_id: ResourceId,
) -> PlaylistDetailResponse:
    return service.clear_playlist(playlist_id)


@router.get(
    "/{playlist_id}/export.m3u8",
    response_class=Response,
    summary="Export a playlist as UTF-8 M3U",
)
def export_playlist_m3u8(
    service: Annotated[CatalogService, Depends(get_catalog_service)],
    playlist_id: ResourceId,
) -> Response:
    filename, content = service.export_playlist_m3u8(playlist_id)
    return Response(
        content=content,
        media_type="application/vnd.apple.mpegurl",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.delete("/{playlist_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete playlist")
def delete_playlist(
    service: Annotated[CatalogService, Depends(get_catalog_service)],
    playlist_id: ResourceId,
) -> None:
    service.delete_playlist(playlist_id)


@router.post("/{playlist_id}/songs", response_model=PlaylistDetailResponse, summary="Add songs to playlist")
def add_songs_to_playlist(
    service: Annotated[CatalogService, Depends(get_catalog_service)],
    playlist_id: ResourceId,
    request: PlaylistAddSongsRequest,
) -> PlaylistDetailResponse:
    return service.add_songs_to_playlist(playlist_id, request)


@router.post("/{playlist_id}/online-track", response_model=PlaylistDetailResponse, summary="Add online track to playlist")
def add_online_track_to_playlist(
    service: Annotated[CatalogService, Depends(get_catalog_service)],
    playlist_id: ResourceId,
    request: PlaylistAddOnlineTrackRequest,
) -> PlaylistDetailResponse:
    return service.add_online_track_to_playlist(playlist_id, request)


@router.delete("/{playlist_id}/songs/{song_id}", response_model=PlaylistDetailResponse, summary="Remove song from playlist")
def remove_song_from_playlist(
    service: Annotated[CatalogService, Depends(get_catalog_service)],
    playlist_id: ResourceId,
    song_id: ResourceId,
) -> PlaylistDetailResponse:
    return service.remove_song_from_playlist(playlist_id, song_id)


@router.delete(
    "/{playlist_id}/tracks/{track_id}",
    response_model=PlaylistDetailResponse,
    summary="Remove a saved or online track from playlist",
)
def remove_library_track_from_playlist(
    service: Annotated[CatalogService, Depends(get_catalog_service)],
    playlist_id: ResourceId,
    track_id: ResourceId,
) -> PlaylistDetailResponse:
    return service.remove_library_track_from_playlist(playlist_id, track_id)
