from typing import Annotated

from fastapi import APIRouter, Depends, status

from app.api.deps import LimitQuery, OffsetQuery, get_catalog_service
from app.schemas.music import (
    PlaylistAddSongsRequest,
    PlaylistAddOnlineTrackRequest,
    PlaylistCreateRequest,
    PlaylistDetailResponse,
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
    playlist_id: int,
) -> PlaylistDetailResponse:
    return service.get_playlist(playlist_id)


@router.patch("/{playlist_id}", response_model=PlaylistResponse, summary="Update playlist")
def update_playlist(
    service: Annotated[CatalogService, Depends(get_catalog_service)],
    playlist_id: int,
    request: PlaylistUpdateRequest,
) -> PlaylistResponse:
    return service.update_playlist(playlist_id, request)


@router.delete("/{playlist_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete playlist")
def delete_playlist(
    service: Annotated[CatalogService, Depends(get_catalog_service)],
    playlist_id: int,
) -> None:
    service.delete_playlist(playlist_id)


@router.post("/{playlist_id}/songs", response_model=PlaylistDetailResponse, summary="Add songs to playlist")
def add_songs_to_playlist(
    service: Annotated[CatalogService, Depends(get_catalog_service)],
    playlist_id: int,
    request: PlaylistAddSongsRequest,
) -> PlaylistDetailResponse:
    return service.add_songs_to_playlist(playlist_id, request)


@router.post("/{playlist_id}/online-track", response_model=PlaylistDetailResponse, summary="Add online track to playlist")
def add_online_track_to_playlist(
    service: Annotated[CatalogService, Depends(get_catalog_service)],
    playlist_id: int,
    request: PlaylistAddOnlineTrackRequest,
) -> PlaylistDetailResponse:
    return service.add_online_track_to_playlist(playlist_id, request)


@router.delete("/{playlist_id}/songs/{song_id}", response_model=PlaylistDetailResponse, summary="Remove song from playlist")
def remove_song_from_playlist(
    service: Annotated[CatalogService, Depends(get_catalog_service)],
    playlist_id: int,
    song_id: int,
    delete_file: bool = False,
) -> PlaylistDetailResponse:
    return service.remove_song_from_playlist(playlist_id, song_id, delete_file=delete_file)


@router.post("/{playlist_id}/reorder", response_model=PlaylistDetailResponse, summary="Reorder playlist song")
def reorder_playlist_song(
    service: Annotated[CatalogService, Depends(get_catalog_service)],
    playlist_id: int,
    request: PlaylistReorderRequest,
) -> PlaylistDetailResponse:
    return service.reorder_playlist_song(playlist_id, request)
