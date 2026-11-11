from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response, status

from app.api.deps import LimitQuery, OffsetQuery, ResourceId, get_download_service, get_playlist_service, require_operator
from app.schemas.music import (
    PlaylistAddOnlineTrackRequest,
    PlaylistAddSongsRequest,
    PlaylistBulkRemoveRequest,
    PlaylistCreateRequest,
    PlaylistDetailResponse,
    PlaylistDuplicateRequest,
    PlaylistReorderRequest,
    PlaylistResponse,
    PlaylistUpdateRequest,
)
from app.core.exceptions import InvalidInputError
from app.services.playlist_artwork import MAX_UPLOAD_BYTES
from app.core.youtube import youtube_video_id
from app.schemas.music import DownloadCreateRequest, DownloadJobResponse
from app.services.downloads import DownloadService
from app.services.playlists import PlaylistService
from pydantic import BaseModel

router = APIRouter()


@router.get("", response_model=list[PlaylistResponse], summary="List playlists")
def list_playlists(
    service: Annotated[PlaylistService, Depends(get_playlist_service)],
    limit: LimitQuery = 50,
    offset: OffsetQuery = 0,
) -> list[PlaylistResponse]:
    return service.list_playlists(limit=limit, offset=offset)


@router.post(
    "",
    response_model=PlaylistResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create playlist",
)
def create_playlist(
    service: Annotated[PlaylistService, Depends(get_playlist_service)],
    request: PlaylistCreateRequest,
) -> PlaylistResponse:
    return service.create_playlist(request)


@router.get(
    "/{playlist_id}",
    response_model=PlaylistDetailResponse,
    summary="Get playlist by ID",
)
def get_playlist(
    service: Annotated[PlaylistService, Depends(get_playlist_service)],
    playlist_id: ResourceId,
) -> PlaylistDetailResponse:
    return service.get_playlist(playlist_id)


@router.patch(
    "/{playlist_id}", response_model=PlaylistDetailResponse, summary="Update a playlist"
)
def update_playlist(
    request: PlaylistUpdateRequest,
    service: Annotated[PlaylistService, Depends(get_playlist_service)],
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
    service: Annotated[PlaylistService, Depends(get_playlist_service)],
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
    service: Annotated[PlaylistService, Depends(get_playlist_service)],
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
    service: Annotated[PlaylistService, Depends(get_playlist_service)],
    playlist_id: ResourceId,
) -> PlaylistDetailResponse:
    return service.bulk_remove_playlist_items(playlist_id, request)


@router.delete(
    "/{playlist_id}/items",
    response_model=PlaylistDetailResponse,
    summary="Clear all playlist items",
)
def clear_playlist_items(
    service: Annotated[PlaylistService, Depends(get_playlist_service)],
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
    service: Annotated[PlaylistService, Depends(get_playlist_service)],
    playlist_id: ResourceId,
) -> PlaylistDetailResponse:
    return service.clear_playlist(playlist_id)


@router.get(
    "/{playlist_id}/export.m3u8",
    response_class=Response,
    summary="Export a playlist as UTF-8 M3U",
)
def export_playlist_m3u8(
    service: Annotated[PlaylistService, Depends(get_playlist_service)],
    playlist_id: ResourceId,
) -> Response:
    filename, content = service.export_playlist_m3u8(playlist_id)
    return Response(
        content=content,
        media_type="application/vnd.apple.mpegurl",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.delete(
    "/{playlist_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete playlist"
)
def delete_playlist(
    service: Annotated[PlaylistService, Depends(get_playlist_service)],
    playlist_id: ResourceId,
) -> None:
    service.delete_playlist(playlist_id)


@router.post(
    "/{playlist_id}/songs",
    response_model=PlaylistDetailResponse,
    summary="Add songs to playlist",
)
def add_songs_to_playlist(
    service: Annotated[PlaylistService, Depends(get_playlist_service)],
    playlist_id: ResourceId,
    request: PlaylistAddSongsRequest,
) -> PlaylistDetailResponse:
    return service.add_songs_to_playlist(playlist_id, request)


@router.post(
    "/{playlist_id}/online-track",
    response_model=PlaylistDetailResponse,
    summary="Add online track to playlist",
)
def add_online_track_to_playlist(
    service: Annotated[PlaylistService, Depends(get_playlist_service)],
    playlist_id: ResourceId,
    request: PlaylistAddOnlineTrackRequest,
) -> PlaylistDetailResponse:
    return service.add_online_track_to_playlist(playlist_id, request)


@router.delete(
    "/{playlist_id}/songs/{song_id}",
    response_model=PlaylistDetailResponse,
    summary="Remove song from playlist",
)
def remove_song_from_playlist(
    service: Annotated[PlaylistService, Depends(get_playlist_service)],
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
    service: Annotated[PlaylistService, Depends(get_playlist_service)],
    playlist_id: ResourceId,
    track_id: ResourceId,
) -> PlaylistDetailResponse:
    return service.remove_library_track_from_playlist(playlist_id, track_id)


@router.put(
    "/{playlist_id}/artwork",
    response_model=PlaylistDetailResponse,
    summary="Upload a custom playlist cover (raw JPEG, PNG or WebP body)",
    dependencies=[Depends(require_operator)],
)
async def set_playlist_artwork(
    request: Request,
    service: Annotated[PlaylistService, Depends(get_playlist_service)],
    playlist_id: ResourceId,
) -> PlaylistDetailResponse:
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_UPLOAD_BYTES:
        raise InvalidInputError("Cover images must be 10 MB or smaller.")
    content = bytearray()
    async for chunk in request.stream():
        content.extend(chunk)
        if len(content) > MAX_UPLOAD_BYTES:
            raise InvalidInputError("Cover images must be 10 MB or smaller.")
    return service.set_playlist_artwork(
        playlist_id, bytes(content), request.headers.get("content-type")
    )


@router.delete(
    "/{playlist_id}/artwork",
    response_model=PlaylistDetailResponse,
    summary="Remove a custom playlist cover",
    dependencies=[Depends(require_operator)],
)
def remove_playlist_artwork(
    service: Annotated[PlaylistService, Depends(get_playlist_service)],
    playlist_id: ResourceId,
) -> PlaylistDetailResponse:
    return service.remove_playlist_artwork(playlist_id)


class PlaylistDownloadResponse(BaseModel):
    queued: list[DownloadJobResponse]
    already_queued: int
    already_offline: int
    unavailable: int


@router.post(
    "/{playlist_id}/download",
    response_model=PlaylistDownloadResponse,
    status_code=202,
    summary="Download every playlist song that is not offline yet",
    dependencies=[Depends(require_operator)],
)
def download_playlist(
    playlists: Annotated[PlaylistService, Depends(get_playlist_service)],
    downloads: Annotated[DownloadService, Depends(get_download_service)],
    playlist_id: ResourceId,
) -> PlaylistDownloadResponse:
    detail = playlists.get_playlist(playlist_id)
    requests: list[DownloadCreateRequest] = []
    offline = unavailable = 0
    for item in detail.items:
        entry = item.track or item.song
        if entry is None:
            continue
        if entry.is_downloaded:
            offline += 1
            continue
        video_id = (
            item.track.external_id
            if item.track is not None and item.track.source == "youtube"
            else youtube_video_id(entry.source_url or "")
        )
        if not video_id:
            unavailable += 1
            continue
        artist = item.track.artist_name if item.track is not None else item.song.artist_name
        album = item.track.album_title if item.track is not None else item.song.album_title
        requests.append(DownloadCreateRequest(
            source_url=f"https://music.youtube.com/watch?v={video_id}",
            video_id=video_id,
            title=(entry.title or "")[:255] or None,
            artist=(artist or "")[:255] or None,
            album=(album or "")[:255] or None,
            thumbnail_url=entry.artwork_url,
            search_query=f"playlist:{playlist_id}",
        ))
    queued, skipped = downloads.enqueue_missing(requests) if requests else ([], 0)
    return PlaylistDownloadResponse(queued=queued, already_queued=skipped, already_offline=offline, unavailable=unavailable)
