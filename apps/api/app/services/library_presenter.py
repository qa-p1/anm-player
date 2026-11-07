from __future__ import annotations

import logging
import re
from pathlib import PurePosixPath

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models import (
    AlbumDownloadJob,
    Favorite,
    LibraryAlbum,
    LibraryTrack,
)
from app.repositories.music import FavoriteRepository
from app.schemas.library import (
    AlbumDownloadJobResponse,
    LibraryAlbumDetailResponse,
    LibraryAlbumResponse,
    LibraryTrackResponse,
    OnlineAlbumPreview,
    UnifiedAlbumArtist,
    UnifiedAlbumCapabilities,
    UnifiedAlbumInternal,
    UnifiedAlbumResponse,
    UnifiedAlbumState,
    UnifiedAlbumTrackResponse,
)
from app.services.file_paths import download_available
from app.storage import storage_manager

logger = logging.getLogger(__name__)


class LibraryPresenter:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.favorites = FavoriteRepository(session)

    def albums_to_response(self, albums) -> list[LibraryAlbumResponse]:
        album_list = list(albums)
        album_ids = [album.id for album in album_list if album.id]
        if album_ids:
            loaded = self.session.scalars(
                select(LibraryAlbum)
                .options(
                    selectinload(LibraryAlbum.tracks).joinedload(LibraryTrack.song)
                )
                .where(LibraryAlbum.id.in_(album_ids))
            ).unique()
            loaded_by_id = {album.id: album for album in loaded}
            album_list = [loaded_by_id.get(album.id, album) for album in album_list]
        favorite_ids = self.favorites.ids_for(
            Favorite.library_album_id, [album.id for album in album_list]
        )
        return [
            self.album_to_response(album, is_favorited=album.id in favorite_ids)
            for album in album_list
        ]

    def tracks_to_response(self, tracks) -> list[LibraryTrackResponse]:
        track_list = list(tracks)
        track_ids = [track.id for track in track_list if track.id]
        if track_ids:
            loaded = self.session.scalars(
                select(LibraryTrack)
                .options(joinedload(LibraryTrack.album), joinedload(LibraryTrack.song))
                .where(LibraryTrack.id.in_(track_ids))
            )
            loaded_by_id = {track.id: track for track in loaded}
            track_list = [loaded_by_id.get(track.id, track) for track in track_list]
        favorite_ids = self.favorites.ids_for(
            Favorite.library_track_id, [track.id for track in track_list]
        )
        return [
            self.track_to_response(track, is_favorited=track.id in favorite_ids)
            for track in track_list
        ]

    def album_to_response(
        self,
        album: LibraryAlbum,
        *,
        is_favorited: bool | None = None,
    ) -> LibraryAlbumResponse:
        tracks = list(album.tracks)
        artwork_path, artwork_url = self.album_artwork(album, tracks)
        download_state, downloaded_count = self.download_state(tracks)
        duration = (
            sum(
                track.duration_seconds
                or (track.song.duration_seconds if track.song else 0)
                or 0
                for track in tracks
            )
            or None
        )
        return LibraryAlbumResponse(
            id=album.id,
            public_id=album.public_id,
            canonical_url=f"/albums/{album.public_id}",
            source=album.source,
            external_id=album.external_id,
            title=album.title,
            artist_name=album.artist_name,
            artist_external_id=album.artist_external_id,
            year=album.year,
            artwork_url=artwork_url,
            artwork_path=artwork_path,
            description=album.description,
            track_count=len(tracks),
            duration_seconds=duration,
            is_favorited=(
                self.favorites.is_favorited("library_album", album.id)
                if is_favorited is None
                else is_favorited
            ),
            download_state=download_state,
            downloaded_track_count=downloaded_count,
            is_in_library=album.is_in_library,
            added_at=album.added_at,
            created_at=album.created_at,
            updated_at=album.updated_at,
        )

    def album_detail_to_response(
        self, album: LibraryAlbum
    ) -> LibraryAlbumDetailResponse:
        base = self.albums_to_response([album])[0]
        return LibraryAlbumDetailResponse(
            **base.model_dump(),
            tracks=self.tracks_to_response(album.tracks),
        )

    def track_to_response(
        self,
        track: LibraryTrack,
        *,
        is_favorited: bool | None = None,
    ) -> LibraryTrackResponse:
        artwork_path = track.artwork_path or (
            track.song.artwork_path if track.song else None
        )
        artwork_url = track.artwork_url or (
            track.song.artwork_url if track.song else None
        )
        if not artwork_path and track.album:
            artwork_path = track.album.artwork_path
        if not artwork_url and track.album:
            artwork_url = track.album.artwork_url
        return LibraryTrackResponse(
            id=track.id,
            song_id=track.song_id,
            artist_id=track.song.artist_id if track.song else None,
            source=track.source,
            external_id=track.external_id,
            title=track.title,
            artist_name=track.artist_name,
            artist_external_id=track.artist_external_id,
            album_id=track.album_id,
            album_public_id=track.album.public_id if track.album else None,
            album_title=track.album_title,
            duration_seconds=track.duration_seconds
            or (track.song.duration_seconds if track.song else None),
            track_number=track.track_number,
            disc_number=track.disc_number,
            position=track.position,
            source_url=track.source_url,
            artwork_url=artwork_url,
            artwork_path=artwork_path,
            explicit=track.explicit,
            is_downloaded=self.track_download_available(track),
            is_favorited=(
                self.favorites.is_favorited("library_track", track.id)
                if is_favorited is None
                else is_favorited
            ),
            is_in_library=track.is_in_library,
            created_at=track.created_at,
            updated_at=track.updated_at,
        )

    @staticmethod
    def album_artwork(
        album: LibraryAlbum,
        tracks: list[LibraryTrack] | None = None,
    ) -> tuple[str | None, str | None]:
        if album.artwork_path or album.artwork_url:
            return album.artwork_path, album.artwork_url
        for track in tracks if tracks is not None else album.tracks:
            artwork_path = track.artwork_path or (
                track.song.artwork_path if track.song else None
            )
            artwork_url = track.artwork_url or (
                track.song.artwork_url if track.song else None
            )
            if artwork_path or artwork_url:
                return artwork_path, artwork_url
        return None, None

    @staticmethod
    def preferred_artwork(
        artwork_path: str | None, artwork_url: str | None
    ) -> str | None:
        if not artwork_path:
            return artwork_url
        normalized = artwork_path.split("?", 1)[0]
        for prefix in ("/api/v1/media/artwork/", "/media/artwork/"):
            if not normalized.startswith(prefix):
                continue
            parts = PurePosixPath(normalized.removeprefix(prefix)).parts
            valid_filename = bool(
                parts and re.fullmatch(r"[a-f0-9]{32}(?:[a-f0-9]{32})?\.jpg", parts[-1])
            )
            if (
                len(parts) == 3
                and parts[0] == "cache"
                and parts[1] in {"thumb", "small", "medium", "large", "original"}
                and valid_filename
            ):
                candidate = storage_manager.paths.artwork_cache / parts[1] / parts[2]
                return (
                    artwork_path if candidate.is_file() else artwork_url or artwork_path
                )
            if len(parts) == 2 and parts[0] == "downloads" and valid_filename:
                candidate = storage_manager.paths.download_thumbnails / parts[1]
                return (
                    artwork_path if candidate.is_file() else artwork_url or artwork_path
                )
        return artwork_url or artwork_path

    def album_download_to_response(
        self, job: AlbumDownloadJob
    ) -> AlbumDownloadJobResponse:
        return AlbumDownloadJobResponse(
            id=job.id,
            album_id=job.album_id,
            status=job.status,
            progress=job.progress,
            total_tracks=job.total_tracks,
            completed_tracks=job.completed_tracks,
            failed_tracks=job.failed_tracks,
            max_parallel=job.max_parallel,
            error_message=job.error_message,
            completed_at=job.completed_at,
            created_at=job.created_at,
            updated_at=job.updated_at,
        )

    def download_state(self, tracks: list[LibraryTrack]) -> tuple[str, int]:
        downloaded = sum(1 for track in tracks if self.track_download_available(track))
        if not tracks or downloaded == 0:
            return "none", downloaded
        if downloaded == len(tracks):
            return "downloaded", downloaded
        return "partial", downloaded

    @staticmethod
    def track_download_available(track: LibraryTrack) -> bool:
        return download_available(track.is_downloaded, track.relative_path)

    def stored_unified_album(
        self, album: LibraryAlbum, active_job: AlbumDownloadJob | None
    ) -> UnifiedAlbumResponse:
        tracks = list(album.tracks)
        artwork_path, artwork_url = self.album_artwork(album, tracks)
        downloaded_count = sum(
            1 for track in tracks if self.track_download_available(track)
        )
        track_responses = [self.unified_stored_track(track) for track in tracks]
        playable_count = sum(1 for track in track_responses if track.is_available)
        if active_job:
            download_state = active_job.status
            download_progress = active_job.progress
        elif tracks and downloaded_count == len(tracks):
            download_state = "downloaded"
            download_progress = 100
        elif downloaded_count:
            download_state = "partial"
            download_progress = (
                int(downloaded_count / len(tracks) * 100) if tracks else 0
            )
        else:
            download_state = "none"
            download_progress = None
        has_remote = any(
            track.source != "local" and (track.source_url or track.external_id)
            for track in tracks
        )
        in_library = album.is_in_library
        return UnifiedAlbumResponse(
            id=album.public_id,
            canonical_url=f"/albums/{album.public_id}",
            source=album.source,
            internal=UnifiedAlbumInternal(
                library_album_id=album.id, local_album_id=album.local_album_id
            ),
            title=album.title,
            artist=UnifiedAlbumArtist(
                name=album.artist_name,
                id=album.artist_external_id,
                href=f"/library/artists/online/{album.artist_external_id}"
                if album.artist_external_id
                else None,
            ),
            year=album.year,
            artwork_url=self.preferred_artwork(artwork_path, artwork_url),
            description=album.description,
            track_count=len(tracks),
            duration_seconds=sum(
                track.duration_seconds
                or (track.song.duration_seconds if track.song else 0)
                or 0
                for track in tracks
            )
            or None,
            state=UnifiedAlbumState(
                in_library=in_library,
                is_favorited=self.favorites.is_favorited("library_album", album.id),
                download=download_state,
                download_progress=download_progress,
                downloaded_track_count=downloaded_count,
                playable_track_count=playable_count,
            ),
            capabilities=UnifiedAlbumCapabilities(
                can_play=playable_count > 0,
                can_shuffle=playable_count > 0,
                can_add_to_library=not in_library,
                can_remove_from_library=in_library,
                can_favorite=in_library,
                can_download=in_library
                and active_job is None
                and downloaded_count < len(tracks)
                and has_remote,
                can_cancel_download=active_job is not None,
                can_remove_download=downloaded_count > 0,
            ),
            tracks=track_responses,
        )

    def preview_unified_album(
        self, preview: OnlineAlbumPreview
    ) -> UnifiedAlbumResponse:
        tracks = [
            UnifiedAlbumTrackResponse(
                id=f"youtube:{track.external_id}",
                title=track.title,
                artist_name=track.artist_name,
                duration_seconds=track.duration_seconds,
                track_number=track.track_number,
                disc_number=track.disc_number,
                explicit=track.explicit,
                provider_track_id=track.external_id,
                playback_source="streaming" if track.external_id else "unavailable",
                is_downloaded=False,
                is_available=bool(track.external_id),
                stream_url=f"/api/v1/ytmusic/stream/{track.external_id}"
                if track.external_id
                else None,
            )
            for track in preview.tracks
        ]
        playable_count = sum(1 for track in tracks if track.is_available)
        return UnifiedAlbumResponse(
            id=preview.external_id,
            canonical_url=f"/albums/{preview.external_id}",
            source=preview.source,
            internal=UnifiedAlbumInternal(),
            title=preview.title,
            artist=UnifiedAlbumArtist(
                name=preview.artist_name,
                id=preview.artist_external_id,
                href=f"/library/artists/online/{preview.artist_external_id}"
                if preview.artist_external_id
                else None,
            ),
            year=preview.year,
            artwork_url=preview.artwork_url,
            description=preview.description,
            track_count=len(tracks),
            duration_seconds=sum(track.duration_seconds or 0 for track in tracks)
            or None,
            state=UnifiedAlbumState(
                in_library=False,
                is_favorited=False,
                download="none",
                playable_track_count=playable_count,
            ),
            capabilities=UnifiedAlbumCapabilities(
                can_play=playable_count > 0,
                can_shuffle=playable_count > 0,
                can_add_to_library=True,
                can_remove_from_library=False,
                can_favorite=False,
                can_download=False,
                can_cancel_download=False,
                can_remove_download=False,
            ),
            tracks=tracks,
        )

    def unified_stored_track(self, track: LibraryTrack) -> UnifiedAlbumTrackResponse:
        downloaded = self.track_download_available(track)
        can_stream = track.source != "local" and bool(track.external_id)
        available = downloaded or can_stream
        playback_source = (
            "downloaded" if downloaded else "streaming" if can_stream else "unavailable"
        )
        stream_url = (
            f"/api/v1/media/library-tracks/{track.id}/stream"
            if downloaded
            else f"/api/v1/ytmusic/stream/{track.external_id}"
            if can_stream
            else None
        )
        return UnifiedAlbumTrackResponse(
            id=f"{track.source}:{track.external_id}",
            title=track.title,
            artist_name=track.artist_name,
            duration_seconds=track.duration_seconds
            or (track.song.duration_seconds if track.song else None),
            track_number=track.track_number,
            disc_number=track.disc_number,
            explicit=track.explicit,
            library_track_id=track.id,
            song_id=track.song_id,
            artist_id=track.song.artist_id if track.song else None,
            provider_track_id=track.external_id if track.source != "local" else None,
            playback_source=playback_source,
            is_downloaded=downloaded,
            is_available=available,
            stream_url=stream_url,
        )
