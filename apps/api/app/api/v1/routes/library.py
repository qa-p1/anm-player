from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select

from app.api.deps import (
    DbSession,
    LimitQuery,
    OffsetQuery,
    ProviderId,
    ResourceId,
    get_library_album_service,
    require_operator,
)
from app.models import Artist, LibraryAlbum, Playlist, Song
from app.schemas.library import (
    AlbumDownloadCreateRequest,
    AlbumDownloadJobResponse,
    AlbumStatusRequest,
    AlbumStatusResponse,
    LibraryArtistDetailResponse,
    LibraryAlbumDetailResponse,
    LibraryAlbumResponse,
    LibraryCountsResponse,
    LibraryRemoveResponse,
    LibrarySearchResponse,
    LibrarySyncResponse,
    LibraryTrackDownloadRemoveResponse,
    PlaylistImportRequest,
    PlaylistLibraryTrackAddRequest,
    SmartCollectionResponse,
    TrackStatusRequest,
    TrackStatusResponse,
)
from app.services import LibraryAlbumService
from app.services.library_scanner import LibraryScannerService
from app.storage import storage_manager
from app.storage.coordinator import storage_coordinator

router = APIRouter()


@router.get("/counts", response_model=LibraryCountsResponse, summary="Count active library records")
def library_counts(session: DbSession) -> LibraryCountsResponse:
    return LibraryCountsResponse(
        songs=int(session.scalar(select(func.count(Song.id)).where(Song.is_downloaded.is_(True))) or 0),
        albums=int(
            session.scalar(
                select(func.count(LibraryAlbum.id)).where(LibraryAlbum.is_in_library.is_(True))
            )
            or 0
        ),
        artists=int(
            session.scalar(
                select(func.count(func.distinct(Artist.id)))
                .join(Song, Song.artist_id == Artist.id)
                .where(Song.is_downloaded.is_(True))
            )
            or 0
        ),
        playlists=int(session.scalar(select(func.count(Playlist.id))) or 0),
    )


@router.post("/sync", response_model=LibrarySyncResponse, summary="Synchronize the managed library")
def sync_library(session: DbSession) -> LibrarySyncResponse:
    with storage_coordinator.filesystem_read():
        result = LibraryScannerService(
            session,
            cancel_event=storage_coordinator.cancel_work,
        ).scan_directory(storage_manager.paths.music)
    return LibrarySyncResponse(
        added=result.added,
        updated=result.updated,
        removed=result.removed,
        reconciled=result.reconciled,
        errors=result.errors,
        total_processed=result.total_processed,
    )


@router.get("/search", response_model=LibrarySearchResponse, summary="Unified library search")
def search_library(
    service: Annotated[LibraryAlbumService, Depends(get_library_album_service)],
    q: Annotated[str, Query(min_length=1, max_length=200)],
    limit: LimitQuery = 50,
) -> LibrarySearchResponse:
    return service.search(q, limit=limit)


@router.get("/smart/{collection_id}", response_model=SmartCollectionResponse, summary="Get smart collection")
def smart_collection(
    service: Annotated[LibraryAlbumService, Depends(get_library_album_service)],
    collection_id: str,
    limit: LimitQuery = 50,
) -> SmartCollectionResponse:
    return service.smart_collection(collection_id, limit=limit)


@router.get("/albums", response_model=list[LibraryAlbumResponse], summary="List saved library albums")
async def list_library_albums(
    service: Annotated[LibraryAlbumService, Depends(get_library_album_service)],
    q: Annotated[str | None, Query(max_length=200)] = None,
    limit: LimitQuery = 50,
    offset: OffsetQuery = 0,
) -> list[LibraryAlbumResponse]:
    return await service.list_albums_refreshed(query=q, limit=limit, offset=offset)


@router.post("/albums/status", response_model=AlbumStatusResponse, summary="Check saved album statuses")
def library_album_statuses(
    service: Annotated[LibraryAlbumService, Depends(get_library_album_service)],
    request: AlbumStatusRequest,
) -> AlbumStatusResponse:
    return service.album_statuses(request.external_ids)


@router.post("/tracks/status", response_model=TrackStatusResponse, summary="Check downloaded status for online tracks")
def library_track_statuses(
    request: TrackStatusRequest,
    service: Annotated[LibraryAlbumService, Depends(get_library_album_service)],
) -> TrackStatusResponse:
    return service.track_statuses(request.external_ids)


@router.get("/albums/{album_id}", response_model=LibraryAlbumDetailResponse, summary="Get saved library album")
def get_library_album(
    service: Annotated[LibraryAlbumService, Depends(get_library_album_service)],
    album_id: ResourceId,
) -> LibraryAlbumDetailResponse:
    return service.get_album(album_id)


@router.delete("/albums/{album_id}", response_model=LibraryRemoveResponse, summary="Remove album from library", dependencies=[Depends(require_operator)])
def remove_library_album(
    service: Annotated[LibraryAlbumService, Depends(get_library_album_service)],
    album_id: ResourceId,
    delete_downloads: bool = False,
) -> LibraryRemoveResponse:
    return service.remove_album(album_id, delete_downloads=delete_downloads)


@router.get("/artists/online/{external_id}", response_model=LibraryArtistDetailResponse, summary="Get online artist library page")
async def get_online_artist(
    service: Annotated[LibraryAlbumService, Depends(get_library_album_service)],
    external_id: ProviderId,
) -> LibraryArtistDetailResponse:
    return await service.get_online_artist(external_id)


@router.post("/albums/{album_id}/download", response_model=AlbumDownloadJobResponse, status_code=201, summary="Download saved album", dependencies=[Depends(require_operator)])
def download_library_album(
    service: Annotated[LibraryAlbumService, Depends(get_library_album_service)],
    album_id: ResourceId,
    request: AlbumDownloadCreateRequest | None = None,
) -> AlbumDownloadJobResponse:
    return service.create_album_download(album_id, max_parallel=request.max_parallel if request else None)


@router.delete("/albums/{album_id}/download", response_model=AlbumDownloadJobResponse, summary="Cancel an album download and remove its files", dependencies=[Depends(require_operator)])
def cancel_library_album_download(
    service: Annotated[LibraryAlbumService, Depends(get_library_album_service)],
    album_id: ResourceId,
) -> AlbumDownloadJobResponse:
    return service.cancel_album_download(album_id)


@router.delete("/tracks/{track_id}/download", response_model=LibraryTrackDownloadRemoveResponse, summary="Remove a track download but keep it in library", dependencies=[Depends(require_operator)])
def remove_track_download(
    service: Annotated[LibraryAlbumService, Depends(get_library_album_service)],
    track_id: ResourceId,
) -> LibraryTrackDownloadRemoveResponse:
    return service.remove_track_download(track_id)


@router.delete("/tracks/{track_id}", response_model=LibraryRemoveResponse, summary="Remove track from library", dependencies=[Depends(require_operator)])
def remove_library_track(
    service: Annotated[LibraryAlbumService, Depends(get_library_album_service)],
    track_id: ResourceId,
    delete_downloads: bool = False,
) -> LibraryRemoveResponse:
    return service.remove_track(track_id, delete_downloads=delete_downloads)


@router.post("/playlists/{playlist_id}/tracks", response_model=dict[str, int], summary="Add saved online tracks to playlist")
def add_library_tracks_to_playlist(
    service: Annotated[LibraryAlbumService, Depends(get_library_album_service)],
    playlist_id: ResourceId,
    request: PlaylistLibraryTrackAddRequest,
) -> dict[str, int]:
    return {"added": service.add_tracks_to_playlist(playlist_id, request.track_ids, force=request.force)}


@router.post("/playlists/import-url", response_model=dict[str, int], status_code=201, summary="Import and download a playlist URL", dependencies=[Depends(require_operator)])
async def import_playlist_url(
    service: Annotated[LibraryAlbumService, Depends(get_library_album_service)],
    request: PlaylistImportRequest,
) -> dict[str, int]:
    return await service.import_playlist_url(url=request.url, name=request.name, max_parallel=request.max_parallel)
