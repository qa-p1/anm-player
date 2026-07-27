from __future__ import annotations

import asyncio
from datetime import UTC, datetime
import logging
import os
from pathlib import Path, PurePosixPath
import re
from urllib.parse import parse_qs, urlparse
from uuid import uuid4

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.enums import DownloadStatus
from app.core.exceptions import ConflictError, ResourceNotFoundError
from app.models import (
    AlbumDownloadItem,
    AlbumDownloadJob,
    DownloadJob,
    Favorite,
    History,
    LibraryAlbum,
    LibraryArtist,
    LibraryTrack,
    Playlist,
    PlaylistLibraryTrack,
    PlaylistSong,
    QueueItem,
    Song,
)
from app.schemas.library import (
    AlbumStatusItem,
    AlbumStatusResponse,
    AlbumDownloadJobResponse,
    LibraryAlbumDetailResponse,
    LibraryAlbumResponse,
    LibraryArtistDetailResponse,
    LibraryRemoveResponse,
    LibrarySearchResponse,
    LibrarySearchResult,
    LibraryTrackResponse,
    LibraryTrackDownloadRemoveResponse,
    OnlineAlbumPreview,
    SmartCollectionResponse,
    UnifiedAlbumArtist,
    UnifiedAlbumCapabilities,
    UnifiedAlbumInternal,
    UnifiedAlbumResponse,
    UnifiedAlbumState,
    UnifiedAlbumTrackResponse,
    TrackStatusItem,
    TrackStatusResponse,
)
from app.services.ytmusic_service import ytmusic_service
from app.services.file_paths import resolve_library_path
from app.services.library_scanner import library_sync_guard
from app.services.settings import SettingsService
from app.storage import storage_manager

logger = logging.getLogger(__name__)


class LibraryAlbumService:
    def __init__(self, session: Session) -> None:
        self.session = session

    def list_albums(self, *, query: str | None = None, limit: int = 50, offset: int = 0) -> list[LibraryAlbumResponse]:
        albums = self._list_album_models(query=query, limit=limit, offset=offset)
        return self._albums_to_response(albums)

    async def list_albums_refreshed(self, *, query: str | None = None, limit: int = 50, offset: int = 0) -> list[LibraryAlbumResponse]:
        """List albums after repairing durations saved by older Innertube parsers."""
        albums = self._list_album_models(query=query, limit=limit, offset=offset)
        await self._refresh_missing_album_durations(albums)
        return self._albums_to_response(albums)

    def _list_album_models(self, *, query: str | None, limit: int, offset: int) -> list[LibraryAlbum]:
        statement = (
            select(LibraryAlbum)
            .options(joinedload(LibraryAlbum.tracks).joinedload(LibraryTrack.song))
            .where(LibraryAlbum.is_in_library.is_(True))
            .order_by(LibraryAlbum.added_at.desc(), LibraryAlbum.id.desc())
            .offset(offset)
            .limit(limit)
        )
        if query:
            pattern = f"%{query}%"
            statement = statement.where(
                or_(
                    LibraryAlbum.title.ilike(pattern),
                    LibraryAlbum.artist_name.ilike(pattern),
                )
            )
        return list(self.session.scalars(statement).unique().all())

    def get_album(self, album_id: int) -> LibraryAlbumDetailResponse:
        album = self.session.scalars(
            select(LibraryAlbum)
            .options(joinedload(LibraryAlbum.tracks))
            .where(LibraryAlbum.id == album_id, LibraryAlbum.is_in_library.is_(True))
        ).unique().first()
        if not album:
            raise ResourceNotFoundError("Library album not found", details={"album_id": album_id})
        return self._album_detail_to_response(album)

    def search(self, query: str, *, limit: int = 50) -> LibrarySearchResponse:
        pattern = f"%{query}%"
        results: list[LibrarySearchResult] = []

        albums = self.session.scalars(
            select(LibraryAlbum)
            .where(
                LibraryAlbum.is_in_library.is_(True),
                or_(LibraryAlbum.title.ilike(pattern), LibraryAlbum.artist_name.ilike(pattern)),
            )
            .order_by(LibraryAlbum.added_at.desc())
            .limit(limit)
        ).all()
        for album in albums:
            results.append(
                LibrarySearchResult(
                    item_type="album",
                    id=album.id,
                    title=album.title,
                    subtitle=album.artist_name,
                    artwork_url=album.artwork_url,
                    artwork_path=album.artwork_path,
                    href=f"/albums/{album.public_id}",
                )
            )

        tracks = self.session.scalars(
            select(LibraryTrack)
            .where(
                LibraryTrack.is_in_library.is_(True),
                or_(LibraryTrack.title.ilike(pattern), LibraryTrack.artist_name.ilike(pattern), LibraryTrack.album_title.ilike(pattern)),
            )
            .order_by(LibraryTrack.created_at.desc())
            .limit(limit)
        ).all()
        for track in tracks:
            results.append(
                LibrarySearchResult(
                    item_type="track",
                    id=track.id,
                    title=track.title,
                    subtitle=track.artist_name,
                    artwork_url=track.artwork_url,
                    artwork_path=track.artwork_path,
                    href=f"/albums/{track.album.public_id}" if track.album else "/library/songs",
                )
            )

        artists = self.session.scalars(
            select(LibraryArtist)
            .where(LibraryArtist.name.ilike(pattern))
            .order_by(LibraryArtist.name.asc())
            .limit(limit)
        ).all()
        for artist in artists:
            results.append(
                LibrarySearchResult(
                    item_type="artist",
                    id=artist.external_id,
                    title=artist.name,
                    subtitle="Artist",
                    artwork_url=artist.thumbnail_url,
                    href=f"/library/artists/online/{artist.external_id}",
                )
            )

        return LibrarySearchResponse(query=query, results=results[:limit])

    async def preview_online_album(self, external_id: str) -> OnlineAlbumPreview:
        return await ytmusic_service.album(external_id)

    async def get_unified_album(self, public_id: str) -> UnifiedAlbumResponse:
        album = self.session.scalars(
            select(LibraryAlbum)
            .options(joinedload(LibraryAlbum.tracks).joinedload(LibraryTrack.song))
            .where(LibraryAlbum.public_id == public_id)
        ).unique().first()
        if album:
            await self._refresh_missing_album_durations([album])
            return self._stored_unified_album(album)
        preview = await self.preview_online_album(public_id)
        return self._preview_unified_album(preview)

    async def add_unified_album_to_library(self, public_id: str) -> UnifiedAlbumResponse:
        album = self.session.scalars(
            select(LibraryAlbum).where(LibraryAlbum.public_id == public_id)
        ).first()
        if album:
            album.is_in_library = True
            album.removed_at = None
            for track in album.tracks:
                track.is_in_library = True
                track.removed_at = None
            self.session.commit()
        else:
            await self.save_online_album(public_id)
        return await self.get_unified_album(public_id)

    async def remove_unified_album_from_library(self, public_id: str, *, delete_downloads: bool = False) -> UnifiedAlbumResponse:
        album = self._get_library_album_by_public_id(public_id)
        if self._active_album_job(album.id):
            self.cancel_album_download(album.id)
        self.remove_album(album.id, delete_downloads=delete_downloads)
        favorite = self.session.scalars(select(Favorite).where(Favorite.library_album_id == album.id)).first()
        if favorite:
            self.session.delete(favorite)
            self.session.commit()
        return await self.get_unified_album(public_id)

    async def set_unified_album_favorite(self, public_id: str, is_favorited: bool) -> UnifiedAlbumResponse:
        album = self._get_library_album_by_public_id(public_id)
        if not album.is_in_library:
            raise ResourceNotFoundError("Album must be in the library before it can be favorited", details={"album_id": public_id})
        favorite = self.session.scalars(select(Favorite).where(Favorite.library_album_id == album.id)).first()
        if is_favorited and not favorite:
            self.session.add(Favorite(library_album_id=album.id))
        elif not is_favorited and favorite:
            self.session.delete(favorite)
        self.session.commit()
        return await self.get_unified_album(public_id)

    async def download_unified_album(self, public_id: str, *, max_parallel: int | None = None) -> UnifiedAlbumResponse:
        album = self._get_library_album_by_public_id(public_id)
        if not album.is_in_library:
            raise ResourceNotFoundError("Album must be in the library before it can be downloaded", details={"album_id": public_id})
        self.create_album_download(album.id, max_parallel=max_parallel)
        return await self.get_unified_album(public_id)

    async def cancel_unified_album_download(self, public_id: str) -> UnifiedAlbumResponse:
        album = self._get_library_album_by_public_id(public_id)
        self.cancel_album_download(album.id)
        return await self.get_unified_album(public_id)

    async def remove_unified_album_download(self, public_id: str) -> UnifiedAlbumResponse:
        album = self._get_library_album_by_public_id(public_id)
        if self._active_album_job(album.id):
            self.cancel_album_download(album.id)
        else:
            self._delete_track_downloads_and_commit(list(album.tracks))
        return await self.get_unified_album(public_id)

    def _get_library_album_by_public_id(self, public_id: str) -> LibraryAlbum:
        album = self.session.scalars(
            select(LibraryAlbum)
            .options(joinedload(LibraryAlbum.tracks))
            .where(LibraryAlbum.public_id == public_id)
        ).unique().first()
        if not album:
            raise ResourceNotFoundError("Album not found in library", details={"album_id": public_id})
        return album

    def _active_album_job(self, album_id: int) -> AlbumDownloadJob | None:
        return self.session.scalars(
            select(AlbumDownloadJob)
            .where(
                AlbumDownloadJob.album_id == album_id,
                AlbumDownloadJob.status.in_([
                    DownloadStatus.QUEUED,
                    DownloadStatus.PREPARING,
                    DownloadStatus.DOWNLOADING,
                    DownloadStatus.PROCESSING,
                    DownloadStatus.PAUSED,
                ]),
            )
            .order_by(AlbumDownloadJob.created_at.desc())
        ).first()

    def _stored_unified_album(self, album: LibraryAlbum) -> UnifiedAlbumResponse:
        tracks = list(album.tracks)
        artwork_path, artwork_url = self._album_artwork(album, tracks)
        active_job = self._active_album_job(album.id)
        downloaded_count = sum(1 for track in tracks if self._track_download_available(track))
        track_responses = [self._unified_stored_track(track) for track in tracks]
        playable_count = sum(1 for track in track_responses if track.is_available)
        if active_job:
            download_state = active_job.status
            download_progress = active_job.progress
        elif tracks and downloaded_count == len(tracks):
            download_state = "downloaded"
            download_progress = 100
        elif downloaded_count:
            download_state = "partial"
            download_progress = int(downloaded_count / len(tracks) * 100) if tracks else 0
        else:
            download_state = "none"
            download_progress = None
        has_remote = any(track.source != "local" and (track.source_url or track.external_id) for track in tracks)
        in_library = album.is_in_library
        return UnifiedAlbumResponse(
            id=album.public_id,
            canonical_url=f"/albums/{album.public_id}",
            source=album.source,
            internal=UnifiedAlbumInternal(library_album_id=album.id, local_album_id=album.local_album_id),
            title=album.title,
            artist=UnifiedAlbumArtist(
                name=album.artist_name,
                id=album.artist_external_id,
                href=f"/library/artists/online/{album.artist_external_id}" if album.artist_external_id else None,
            ),
            year=album.year,
            artwork_url=self._preferred_artwork(artwork_path, artwork_url),
            description=album.description,
            track_count=len(tracks),
            duration_seconds=sum(track.duration_seconds or (track.song.duration_seconds if track.song else 0) or 0 for track in tracks) or None,
            state=UnifiedAlbumState(
                in_library=in_library,
                is_favorited=self._is_favorited("library_album", album.id),
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
                can_download=in_library and active_job is None and downloaded_count < len(tracks) and has_remote,
                can_cancel_download=active_job is not None,
                can_remove_download=downloaded_count > 0,
            ),
            tracks=track_responses,
        )

    def _preview_unified_album(self, preview: OnlineAlbumPreview) -> UnifiedAlbumResponse:
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
                stream_url=f"/api/v1/ytmusic/stream/{track.external_id}" if track.external_id else None,
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
                href=f"/library/artists/online/{preview.artist_external_id}" if preview.artist_external_id else None,
            ),
            year=preview.year,
            artwork_url=preview.artwork_url,
            description=preview.description,
            track_count=len(tracks),
            duration_seconds=sum(track.duration_seconds or 0 for track in tracks) or None,
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

    def _unified_stored_track(self, track: LibraryTrack) -> UnifiedAlbumTrackResponse:
        downloaded = self._track_download_available(track)
        can_stream = track.source != "local" and bool(track.external_id)
        available = downloaded or can_stream
        playback_source = "downloaded" if downloaded else "streaming" if can_stream else "unavailable"
        stream_url = (
            f"/api/v1/media/library-tracks/{track.id}"
            if downloaded
            else f"/api/v1/ytmusic/stream/{track.external_id}"
            if can_stream
            else None
        )
        return UnifiedAlbumTrackResponse(
            id=f"{track.source}:{track.external_id}",
            title=track.title,
            artist_name=track.artist_name,
            duration_seconds=track.duration_seconds or (track.song.duration_seconds if track.song else None),
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

    async def _refresh_missing_album_durations(self, albums: list[LibraryAlbum]) -> None:
        """Backfill old saved albums in one browse request per affected album."""
        pending = [
            album
            for album in albums
            if album.external_id and any(track.duration_seconds is None for track in album.tracks)
        ]
        if not pending:
            return

        previews = await asyncio.gather(
            *(self.preview_online_album(album.external_id) for album in pending),
            return_exceptions=True,
        )
        duration_by_external_id: dict[str, int] = {}
        for preview in previews:
            if isinstance(preview, BaseException):
                continue
            for track in preview.tracks:
                if track.duration_seconds and track.duration_seconds > 0:
                    duration_by_external_id[track.external_id] = track.duration_seconds
        if not duration_by_external_id:
            return

        stale_tracks = self.session.scalars(
            select(LibraryTrack).where(
                LibraryTrack.external_id.in_(duration_by_external_id),
                LibraryTrack.duration_seconds.is_(None),
            )
        ).all()
        for track in stale_tracks:
            track.duration_seconds = duration_by_external_id[track.external_id]

        stale_history = self.session.scalars(
            select(History).where(
                History.external_id.in_(duration_by_external_id),
                History.duration_seconds.is_(None),
            )
        ).all()
        for entry in stale_history:
            if entry.external_id:
                entry.duration_seconds = duration_by_external_id[entry.external_id]
        self.session.commit()

    async def save_online_album(self, external_id: str) -> LibraryAlbumDetailResponse:
        preview = await self.preview_online_album(external_id)
        album = self.session.scalars(
            select(LibraryAlbum).where(
                LibraryAlbum.source == preview.source,
                LibraryAlbum.external_id == preview.external_id,
            )
        ).first()

        if album is None:
            album = LibraryAlbum(
                public_id=preview.external_id,
                source=preview.source,
                external_id=preview.external_id,
                title=preview.title,
                artist_name=preview.artist_name,
                artist_external_id=preview.artist_external_id,
                year=preview.year,
                artwork_url=preview.artwork_url,
                description=preview.description,
            )
            self.session.add(album)
            self.session.flush()
        else:
            album.is_in_library = True
            album.removed_at = None
            album.title = preview.title
            album.artist_name = preview.artist_name
            album.artist_external_id = preview.artist_external_id
            album.year = preview.year
            album.artwork_url = preview.artwork_url
            album.description = preview.description

        existing_tracks = {
            track.external_id: track
            for track in self.session.scalars(
                select(LibraryTrack).where(LibraryTrack.album_id == album.id)
            )
        }
        incoming_ids: set[str] = set()
        seen_artist_ids: set[str] = set()

        for track_preview in preview.tracks:
            incoming_ids.add(track_preview.external_id)
            if (
                track_preview.artist_external_id
                and track_preview.artist_name
                and track_preview.artist_external_id not in seen_artist_ids
            ):
                seen_artist_ids.add(track_preview.artist_external_id)
                self._upsert_artist(
                    external_id=track_preview.artist_external_id,
                    name=track_preview.artist_name,
                    thumbnail_url=None,
                )
            track = existing_tracks.get(track_preview.external_id)
            if track is None:
                track = LibraryTrack(
                    source=track_preview.source,
                    external_id=track_preview.external_id,
                    album_id=album.id,
                    title=track_preview.title,
                    position=track_preview.position,
                )
                self.session.add(track)
            track.is_in_library = True
            track.removed_at = None
            track.artist_name = track_preview.artist_name
            track.artist_external_id = track_preview.artist_external_id
            track.album_title = track_preview.album_title or preview.title
            track.duration_seconds = track_preview.duration_seconds
            track.track_number = track_preview.track_number
            track.disc_number = track_preview.disc_number
            track.position = track_preview.position
            track.source_url = track_preview.source_url
            track.artwork_url = track_preview.artwork_url or preview.artwork_url
            track.explicit = track_preview.explicit

        for external_track_id, stale_track in existing_tracks.items():
            if external_track_id not in incoming_ids and not stale_track.is_downloaded:
                stale_track.is_in_library = False
                stale_track.removed_at = datetime.now(UTC)

        self.session.commit()
        self.session.refresh(album)
        return self.get_album(album.id)

    def album_statuses(self, external_ids: list[str]) -> AlbumStatusResponse:
        albums = list(
            self.session.scalars(
                select(LibraryAlbum)
                .options(joinedload(LibraryAlbum.tracks))
                .where(LibraryAlbum.source == "youtube", LibraryAlbum.external_id.in_(external_ids))
            ).unique()
        )
        by_external_id = {album.external_id: album for album in albums}
        statuses: list[AlbumStatusItem] = []
        for external_id in external_ids:
            album = by_external_id.get(external_id)
            if not album:
                statuses.append(
                    AlbumStatusItem(
                        external_id=external_id,
                        public_id=external_id,
                        canonical_url=f"/albums/{external_id}",
                    )
                )
                continue
            statuses.append(
                AlbumStatusItem(
                    external_id=external_id,
                    public_id=album.public_id,
                    canonical_url=f"/albums/{album.public_id}",
                    in_library=album.is_in_library,
                    library_album_id=album.id if album.is_in_library else None,
                    is_favorited=self._is_favorited("library_album", album.id),
                    download_state=self._download_state(album.tracks)[0],
                )
            )
        return AlbumStatusResponse(statuses=statuses)

    def track_statuses(self, external_ids: list[str]) -> TrackStatusResponse:
        requested = set(external_ids)
        downloaded: dict[str, tuple[str, int]] = {}
        changed = False
        tracks = self.session.scalars(
            select(LibraryTrack).where(
                LibraryTrack.source == "youtube",
                LibraryTrack.external_id.in_(requested),
                LibraryTrack.is_downloaded.is_(True),
            )
        ).all()
        for track in tracks:
            if self._track_download_available(track):
                downloaded[track.external_id] = ("library_track", track.id)
            else:
                track.is_downloaded = False
                track.relative_path = None
                changed = True

        songs = self.session.scalars(
            select(Song).where(Song.is_downloaded.is_(True), Song.source_url.isnot(None))
        ).all()
        for song in songs:
            external_id = self._youtube_video_id(song.source_url)
            if external_id not in requested:
                continue
            try:
                available = bool(song.relative_path and resolve_library_path(song.relative_path).is_file())
            except (OSError, ValueError):
                available = False
            if available:
                downloaded.setdefault(external_id, ("song", song.id))
            else:
                song.is_downloaded = False
                song.relative_path = None
                changed = True
        if changed:
            self.session.commit()
        return TrackStatusResponse(
            statuses=[
                TrackStatusItem(
                    external_id=external_id,
                    is_downloaded=external_id in downloaded,
                    download_source=downloaded[external_id][0] if external_id in downloaded else None,
                    download_id=downloaded[external_id][1] if external_id in downloaded else None,
                )
                for external_id in external_ids
            ]
        )

    @staticmethod
    def _youtube_video_id(source_url: str | None) -> str | None:
        if not source_url:
            return None
        parsed = urlparse(source_url)
        host = (parsed.hostname or "").lower()
        if host in {"youtu.be", "www.youtu.be"}:
            return parsed.path.strip("/").split("/")[0] or None
        if host == "youtube.com" or host.endswith(".youtube.com"):
            if parsed.path == "/watch":
                return (parse_qs(parsed.query).get("v") or [None])[0]
            if parsed.path.startswith(("/shorts/", "/embed/")):
                parts = parsed.path.strip("/").split("/")
                return parts[1] if len(parts) > 1 else None
        return None

    async def get_online_artist(self, external_id: str) -> LibraryArtistDetailResponse:
        artist = self.session.scalars(
            select(LibraryArtist).where(LibraryArtist.source == "youtube", LibraryArtist.external_id == external_id)
        ).first()
        artist_name = artist.name if artist else "Artist"

        albums = self.session.scalars(
            select(LibraryAlbum)
            .options(joinedload(LibraryAlbum.tracks))
            .where(or_(LibraryAlbum.artist_external_id == external_id, LibraryAlbum.artist_name == artist_name))
            .order_by(LibraryAlbum.added_at.desc())
            .limit(20)
        ).unique().all()
        await self._refresh_missing_album_durations(list(albums))
        tracks = self.session.scalars(
            select(LibraryTrack)
            .where(or_(LibraryTrack.artist_external_id == external_id, LibraryTrack.artist_name == artist_name))
            .order_by(LibraryTrack.created_at.desc())
            .limit(20)
        ).all()

        if not artist:
            try:
                online = await ytmusic_service.artist(external_id)
                artist_name = online.get("name") or artist_name
                artist = self._upsert_artist(
                    external_id=external_id,
                    name=artist_name,
                    thumbnail_url=online.get("thumbnail_url"),
                )
                top_tracks = []
                for index, item in enumerate(online.get("tracks", [])[:20]):
                    track = self.session.scalars(
                        select(LibraryTrack).where(LibraryTrack.source == "youtube", LibraryTrack.external_id == item.id)
                    ).first()
                    if not track:
                        track = LibraryTrack(source="youtube", external_id=item.id, title=item.title, position=index)
                        self.session.add(track)
                    track.artist_name = item.artists[0].name if item.artists else artist_name
                    track.artist_external_id = external_id
                    track.album_title = item.album.name if item.album else None
                    track.duration_seconds = item.duration_seconds
                    track.source_url = item.url
                    track.artwork_url = item.thumbnail
                    track.explicit = item.explicit
                    top_tracks.append(track)
                self.session.commit()
                albums = []
                tracks = top_tracks
            except Exception:
                self.session.rollback()
                artist = self._upsert_artist(external_id=external_id, name=artist_name, thumbnail_url=None)
                self.session.commit()
        if not artist.id:
            self.session.add(artist)
            self.session.commit()

        return LibraryArtistDetailResponse(
            id=artist.id,
            source=artist.source,
            external_id=artist.external_id,
            name=artist.name,
            description=artist.description,
            thumbnail_url=artist.thumbnail_url,
            album_count=len(albums),
            track_count=len(tracks),
            added_at=artist.added_at,
            albums=self._albums_to_response(albums),
            top_tracks=self._tracks_to_response(tracks),
        )

    def smart_collection(self, collection_id: str, *, limit: int = 50) -> SmartCollectionResponse:
        normalized = collection_id.strip().lower()
        if normalized in {"recently-added", "recent"}:
            tracks = self.session.scalars(
                select(LibraryTrack)
                .where(LibraryTrack.is_in_library.is_(True))
                .order_by(LibraryTrack.created_at.desc())
                .limit(limit)
            ).all()
            albums = self.session.scalars(
                select(LibraryAlbum)
                .options(joinedload(LibraryAlbum.tracks))
                .where(LibraryAlbum.is_in_library.is_(True))
                .order_by(LibraryAlbum.added_at.desc())
                .limit(20)
            ).unique().all()
            return SmartCollectionResponse(
                id="recently-added",
                title="Recently Added",
                description="Albums and tracks added to your library most recently.",
                tracks=self._tracks_to_response(tracks),
                albums=self._albums_to_response(albums),
            )
        if normalized == "downloaded":
            tracks = self.session.scalars(
                select(LibraryTrack).where(LibraryTrack.is_downloaded.is_(True)).order_by(LibraryTrack.updated_at.desc()).limit(limit)
            ).all()
            return SmartCollectionResponse(
                id="downloaded",
                title="Downloaded",
                description="Tracks with local audio files on this server.",
                tracks=self._tracks_to_response(tracks),
            )
        if normalized in {"streaming", "not-downloaded"}:
            tracks = self.session.scalars(
                select(LibraryTrack)
                .where(LibraryTrack.is_in_library.is_(True), LibraryTrack.is_downloaded.is_(False))
                .order_by(LibraryTrack.created_at.desc())
                .limit(limit)
            ).all()
            return SmartCollectionResponse(
                id="streaming",
                title="Streaming Only",
                description="Saved tracks that stream and cache on play.",
                tracks=self._tracks_to_response(tracks),
            )
        raise ResourceNotFoundError("Smart collection not found", details={"collection_id": collection_id})

    def add_tracks_to_playlist(self, playlist_id: int, track_ids: list[int], *, force: bool = False) -> int:
        playlist = self.session.get(Playlist, playlist_id)
        if not playlist:
            raise ResourceNotFoundError("Playlist not found", details={"playlist_id": playlist_id})

        unique_ids = list(dict.fromkeys(track_ids))
        tracks = list(self.session.scalars(select(LibraryTrack).where(LibraryTrack.id.in_(unique_ids))))
        found_ids = {track.id for track in tracks}
        missing_ids = [track_id for track_id in unique_ids if track_id not in found_ids]
        if missing_ids:
            raise ResourceNotFoundError("One or more library tracks were not found", details={"track_ids": missing_ids})
        existing_ids = set(self.session.scalars(
            select(PlaylistLibraryTrack.track_id).where(
                PlaylistLibraryTrack.playlist_id == playlist_id,
                PlaylistLibraryTrack.track_id.in_(unique_ids),
            )
        ))
        if existing_ids and not force:
            raise ConflictError(
                "One or more tracks are already in the playlist.",
                details={"track_ids": sorted(existing_ids)},
            )
        pending_ids = [track_id for track_id in unique_ids if track_id not in existing_ids]
        added = 0
        max_position = self.session.execute(
            select(
                func.max(
                    func.coalesce(select(func.max(PlaylistLibraryTrack.position)).where(PlaylistLibraryTrack.playlist_id == playlist_id).scalar_subquery(), -1),
                    func.coalesce(select(func.max(PlaylistSong.position)).where(PlaylistSong.playlist_id == playlist_id).scalar_subquery(), -1),
                )
            )
        ).scalar()
        next_position = max_position + 1

        for track_id in pending_ids:
            self.session.add(PlaylistLibraryTrack(playlist_id=playlist_id, track_id=track_id, position=next_position))
            next_position += 1
            added += 1

        self.session.commit()
        return added

    async def import_playlist_url(self, *, url: str, name: str | None = None, max_parallel: int | None = None) -> dict[str, int]:
        parsed = urlparse(url)
        host = (parsed.hostname or "").lower()
        if "spotify.com" in host:
            raise ResourceNotFoundError(
                "Spotify playlist import needs Spotify metadata credentials before tracks can be matched to YouTube Music."
            )
        playlist_id = self._youtube_playlist_id(url)
        if not playlist_id:
            raise ResourceNotFoundError("Could not find a YouTube Music playlist id in the URL.")

        browse_id = playlist_id if playlist_id.startswith("VL") else f"VL{playlist_id}"
        preview = await ytmusic_service.album(browse_id)
        playlist = Playlist(name=name or preview.title or "Imported Playlist", description=url)
        self.session.add(playlist)
        self.session.flush()

        saved_track_ids: list[int] = []
        for track_preview in preview.tracks:
            track = self.session.scalars(
                select(LibraryTrack).where(
                    LibraryTrack.source == track_preview.source,
                    LibraryTrack.external_id == track_preview.external_id,
                )
            ).first()
            if not track:
                track = LibraryTrack(
                    source=track_preview.source,
                    external_id=track_preview.external_id,
                    title=track_preview.title,
                    artist_name=track_preview.artist_name,
                    artist_external_id=track_preview.artist_external_id,
                    album_title=track_preview.album_title,
                    duration_seconds=track_preview.duration_seconds,
                    track_number=track_preview.track_number,
                    disc_number=track_preview.disc_number,
                    position=track_preview.position,
                    source_url=track_preview.source_url,
                    artwork_url=track_preview.artwork_url,
                    explicit=track_preview.explicit,
                )
                self.session.add(track)
                self.session.flush()
            saved_track_ids.append(track.id)

        self.session.commit()
        added = self.add_tracks_to_playlist(playlist.id, saved_track_ids, force=False)

        runtime = SettingsService(self.session)
        album_job = AlbumDownloadJob(
            album_id=self._ensure_import_album(preview).id,
            status=DownloadStatus.QUEUED,
            total_tracks=len(saved_track_ids),
            max_parallel=max_parallel or runtime.get_int("album_download_max_parallel", 5),
        )
        self.session.add(album_job)
        self.session.flush()
        for track_id in saved_track_ids:
            track = self.session.get(LibraryTrack, track_id)
            if not track or not track.source_url:
                continue
            download = DownloadJob(
                status=DownloadStatus.QUEUED,
                stage="Queued",
                source_url=track.source_url,
                video_id=track.external_id,
                title=track.title,
                artist=track.artist_name,
                album=track.album_title,
                thumbnail_url=track.artwork_url,
                search_query=f"playlist:{playlist_id}",
                audio_format=runtime.get_str("download_audio_format", "mp3"),
                overwrite_existing=runtime.get_bool("download_overwrite_existing", False),
            )
            self.session.add(download)
            self.session.flush()
            self.session.add(QueueItem(download_job=download, status=DownloadStatus.QUEUED, item_type="playlist_track"))
            self.session.add(AlbumDownloadItem(album_job_id=album_job.id, track_id=track.id, download_job_id=download.id))
        self.session.commit()
        return {"playlist_id": playlist.id, "tracks": added, "download_job_id": album_job.id}

    def _youtube_playlist_id(self, url: str) -> str | None:
        parsed = urlparse(url)
        host = (parsed.hostname or "").casefold().rstrip(".")
        if parsed.scheme != "https" or not (
            host == "youtube.com"
            or host.endswith(".youtube.com")
            or host == "youtu.be"
        ):
            return None
        query = parse_qs(parsed.query)
        playlist_id = (query.get("list") or [None])[0]
        if not playlist_id or not re.fullmatch(r"[A-Za-z0-9_-]{1,255}", playlist_id):
            return None
        return playlist_id

    def _ensure_import_album(self, preview: OnlineAlbumPreview) -> LibraryAlbum:
        album = self.session.scalars(
            select(LibraryAlbum).where(
                LibraryAlbum.source == preview.source,
                LibraryAlbum.external_id == preview.external_id,
            )
        ).first()
        if album:
            return album
        album = LibraryAlbum(
            public_id=preview.external_id,
            source=preview.source,
            external_id=preview.external_id,
            title=preview.title,
            artist_name=preview.artist_name,
            artist_external_id=preview.artist_external_id,
            year=preview.year,
            artwork_url=preview.artwork_url,
            description=preview.description,
        )
        self.session.add(album)
        self.session.flush()
        return album

    def create_album_download(self, album_id: int, *, max_parallel: int | None = None) -> AlbumDownloadJobResponse:
        album = self.session.scalars(
            select(LibraryAlbum)
            .options(joinedload(LibraryAlbum.tracks))
            .where(LibraryAlbum.id == album_id, LibraryAlbum.is_in_library.is_(True))
        ).unique().first()
        if not album:
            raise ResourceNotFoundError("Library album not found", details={"album_id": album_id})

        self._validate_album_downloads(album)
        existing_job = self.session.scalars(
            select(AlbumDownloadJob)
            .where(
                AlbumDownloadJob.album_id == album.id,
                AlbumDownloadJob.status.in_(
                    [
                        DownloadStatus.QUEUED,
                        DownloadStatus.PREPARING,
                        DownloadStatus.DOWNLOADING,
                        DownloadStatus.PROCESSING,
                        DownloadStatus.PAUSED,
                    ]
                ),
            )
            .order_by(AlbumDownloadJob.created_at.desc())
        ).first()
        if existing_job:
            return self._album_download_to_response(existing_job)
        pending_tracks = [track for track in album.tracks if not track.is_downloaded and track.source_url]
        runtime = SettingsService(self.session)
        parallel = max(1, min(max_parallel or runtime.get_int("album_download_max_parallel", 5), 8))
        album_job = AlbumDownloadJob(
            album_id=album.id,
            status=DownloadStatus.QUEUED,
            total_tracks=len(pending_tracks),
            max_parallel=parallel,
        )
        self.session.add(album_job)
        self.session.flush()

        for track in pending_tracks:
            download = DownloadJob(
                status=DownloadStatus.QUEUED,
                stage="Queued",
                source_url=track.source_url,
                video_id=track.external_id,
                title=track.title,
                artist=track.artist_name,
                album=album.title,
                thumbnail_url=album.artwork_url or track.artwork_url,
                search_query=f"album:{album.public_id}",
                audio_format=runtime.get_str("download_audio_format", "mp3"),
                overwrite_existing=runtime.get_bool("download_overwrite_existing", False),
            )
            self.session.add(download)
            self.session.flush()
            self.session.add(QueueItem(download_job=download, status=DownloadStatus.QUEUED, item_type="album_track"))
            self.session.add(
                AlbumDownloadItem(
                    album_job_id=album_job.id,
                    track_id=track.id,
                    download_job_id=download.id,
                    status=DownloadStatus.QUEUED,
                )
            )

        if not pending_tracks:
            album_job.status = DownloadStatus.COMPLETED
            album_job.progress = 100
            album_job.completed_at = datetime.now(UTC)

        self.session.commit()
        return self._album_download_to_response(album_job)

    def cancel_album_download(self, album_id: int) -> AlbumDownloadJobResponse:
        album_job = self.session.scalars(
            select(AlbumDownloadJob)
            .options(
                joinedload(AlbumDownloadJob.items).joinedload(AlbumDownloadItem.track),
                joinedload(AlbumDownloadJob.items).joinedload(AlbumDownloadItem.download_job),
            )
            .where(
                AlbumDownloadJob.album_id == album_id,
                AlbumDownloadJob.status.in_(
                    [
                        DownloadStatus.QUEUED,
                        DownloadStatus.PREPARING,
                        DownloadStatus.DOWNLOADING,
                        DownloadStatus.PROCESSING,
                        DownloadStatus.PAUSED,
                    ]
                ),
            )
            .order_by(AlbumDownloadJob.created_at.desc())
        ).unique().first()
        if not album_job:
            raise ResourceNotFoundError("Active album download not found", details={"album_id": album_id})

        now = datetime.now(UTC)
        tracks = []
        for item in album_job.items:
            tracks.append(item.track)
            item.status = DownloadStatus.CANCELLED
            item.error_message = "Album download cancelled"
            child = item.download_job
            if child and child.status not in {DownloadStatus.COMPLETED, DownloadStatus.FAILED, DownloadStatus.CANCELLED}:
                child.status = DownloadStatus.CANCELLED
                child.stage = "Cancelled"
                child.cancelled_at = now
                if child.queue_item:
                    child.queue_item.status = DownloadStatus.CANCELLED

        album_job.status = DownloadStatus.CANCELLED
        album_job.progress = 0
        album_job.completed_tracks = 0
        album_job.completed_at = now
        album_job.error_message = "Album download cancelled"
        self._delete_track_downloads_and_commit(tracks)
        return self._album_download_to_response(album_job)

    def remove_album(self, album_id: int, *, delete_downloads: bool = False) -> LibraryRemoveResponse:
        album = self.session.scalars(
            select(LibraryAlbum)
            .options(joinedload(LibraryAlbum.tracks))
            .where(LibraryAlbum.id == album_id)
        ).unique().first()
        if not album:
            raise ResourceNotFoundError("Library album not found", details={"album_id": album_id})
        now = datetime.now(UTC)
        tracks = list(album.tracks)
        album.is_in_library = False
        album.removed_at = now
        for track in tracks:
            track.is_in_library = False
            track.removed_at = now
        if delete_downloads:
            deleted_files = self._delete_track_downloads_and_commit(tracks)
        else:
            deleted_files = 0
            self.session.commit()
        return LibraryRemoveResponse(deleted_files=deleted_files)

    def remove_track(self, track_id: int, *, delete_downloads: bool = False) -> LibraryRemoveResponse:
        track = self.session.get(LibraryTrack, track_id)
        if not track:
            raise ResourceNotFoundError("Library track not found", details={"track_id": track_id})
        track.is_in_library = False
        track.removed_at = datetime.now(UTC)
        if delete_downloads:
            deleted_files = self._delete_track_downloads_and_commit([track])
        else:
            deleted_files = 0
            self.session.commit()
        return LibraryRemoveResponse(deleted_files=deleted_files)

    def remove_track_download(self, track_id: int) -> LibraryTrackDownloadRemoveResponse:
        track = self.session.get(LibraryTrack, track_id)
        if not track:
            raise ResourceNotFoundError("Library track not found", details={"track_id": track_id})
        file_deleted = self._delete_track_downloads_and_commit([track]) > 0
        return LibraryTrackDownloadRemoveResponse(
            track=self._track_to_response(track),
            file_deleted=file_deleted,
        )

    def _favorited_ids(self, field, entity_ids: list[int]) -> set[int]:
        ids = set(entity_ids)
        if not ids:
            return set()
        return {
            entity_id
            for entity_id in self.session.scalars(select(field).where(field.in_(ids)))
            if entity_id is not None
        }

    def _albums_to_response(self, albums) -> list[LibraryAlbumResponse]:
        album_list = list(albums)
        album_ids = [album.id for album in album_list if album.id]
        if album_ids:
            loaded = self.session.scalars(
                select(LibraryAlbum)
                .options(selectinload(LibraryAlbum.tracks).joinedload(LibraryTrack.song))
                .where(LibraryAlbum.id.in_(album_ids))
            ).unique()
            loaded_by_id = {album.id: album for album in loaded}
            album_list = [loaded_by_id.get(album.id, album) for album in album_list]
        favorite_ids = self._favorited_ids(Favorite.library_album_id, [album.id for album in album_list])
        return [
            self._album_to_response(album, is_favorited=album.id in favorite_ids)
            for album in album_list
        ]

    def _tracks_to_response(self, tracks) -> list[LibraryTrackResponse]:
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
        favorite_ids = self._favorited_ids(Favorite.library_track_id, [track.id for track in track_list])
        return [
            self._track_to_response(track, is_favorited=track.id in favorite_ids)
            for track in track_list
        ]

    def _album_to_response(
        self,
        album: LibraryAlbum,
        *,
        is_favorited: bool | None = None,
    ) -> LibraryAlbumResponse:
        tracks = list(album.tracks)
        artwork_path, artwork_url = self._album_artwork(album, tracks)
        download_state, downloaded_count = self._download_state(tracks)
        duration = sum(track.duration_seconds or (track.song.duration_seconds if track.song else 0) or 0 for track in tracks) or None
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
                self._is_favorited("library_album", album.id)
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

    def _album_detail_to_response(self, album: LibraryAlbum) -> LibraryAlbumDetailResponse:
        base = self._albums_to_response([album])[0]
        return LibraryAlbumDetailResponse(
            **base.model_dump(),
            tracks=self._tracks_to_response(album.tracks),
        )

    def _track_to_response(
        self,
        track: LibraryTrack,
        *,
        is_favorited: bool | None = None,
    ) -> LibraryTrackResponse:
        artwork_path = track.artwork_path or (track.song.artwork_path if track.song else None)
        artwork_url = track.artwork_url or (track.song.artwork_url if track.song else None)
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
            duration_seconds=track.duration_seconds or (track.song.duration_seconds if track.song else None),
            track_number=track.track_number,
            disc_number=track.disc_number,
            position=track.position,
            source_url=track.source_url,
            artwork_url=artwork_url,
            artwork_path=artwork_path,
            explicit=track.explicit,
            is_downloaded=self._track_download_available(track),
            is_favorited=(
                self._is_favorited("library_track", track.id)
                if is_favorited is None
                else is_favorited
            ),
            is_in_library=track.is_in_library,
            created_at=track.created_at,
            updated_at=track.updated_at,
        )

    @staticmethod
    def _album_artwork(
        album: LibraryAlbum,
        tracks: list[LibraryTrack] | None = None,
    ) -> tuple[str | None, str | None]:
        if album.artwork_path or album.artwork_url:
            return album.artwork_path, album.artwork_url
        for track in tracks if tracks is not None else album.tracks:
            artwork_path = track.artwork_path or (track.song.artwork_path if track.song else None)
            artwork_url = track.artwork_url or (track.song.artwork_url if track.song else None)
            if artwork_path or artwork_url:
                return artwork_path, artwork_url
        return None, None

    @staticmethod
    def _preferred_artwork(artwork_path: str | None, artwork_url: str | None) -> str | None:
        if not artwork_path:
            return artwork_url
        normalized = artwork_path.split("?", 1)[0]
        for prefix in ("/api/v1/media/artwork/", "/media/artwork/"):
            if not normalized.startswith(prefix):
                continue
            parts = PurePosixPath(normalized.removeprefix(prefix)).parts
            valid_filename = bool(parts and re.fullmatch(r"[a-f0-9]{32}(?:[a-f0-9]{32})?\.jpg", parts[-1]))
            if len(parts) == 3 and parts[0] == "cache" and parts[1] in {"thumb", "small", "medium", "large", "original"} and valid_filename:
                candidate = storage_manager.paths.artwork_cache / parts[1] / parts[2]
                return artwork_path if candidate.is_file() else artwork_url or artwork_path
            if len(parts) == 2 and parts[0] == "downloads" and valid_filename:
                candidate = storage_manager.paths.download_thumbnails / parts[1]
                return artwork_path if candidate.is_file() else artwork_url or artwork_path
        return artwork_url or artwork_path

    def _album_download_to_response(self, job: AlbumDownloadJob) -> AlbumDownloadJobResponse:
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

    def _upsert_artist(self, *, external_id: str, name: str, thumbnail_url: str | None) -> LibraryArtist:
        artist = self.session.scalars(
            select(LibraryArtist).where(
                LibraryArtist.source == "youtube",
                LibraryArtist.external_id == external_id,
            )
        ).first()
        if artist:
            artist.name = name
            if thumbnail_url:
                artist.thumbnail_url = thumbnail_url
            return artist
        artist = LibraryArtist(source="youtube", external_id=external_id, name=name, thumbnail_url=thumbnail_url)
        self.session.add(artist)
        self.session.flush()
        return artist

    def _validate_album_downloads(self, album: LibraryAlbum) -> None:
        changed = False
        for track in album.tracks:
            if self._validate_track_download(track):
                changed = True
        if changed:
            self.session.commit()

    def _validate_track_download(self, track: LibraryTrack) -> bool:
        if not track.is_downloaded:
            return False
        if not track.relative_path:
            track.is_downloaded = False
            track.relative_path = None
            return True
        try:
            path = resolve_library_path(track.relative_path)
            valid = path.exists() and path.is_file() and path.stat().st_size > 0
        except (OSError, ValueError):
            valid = False
        if valid:
            return False
        track.is_downloaded = False
        track.relative_path = None
        return True

    def _download_state(self, tracks: list[LibraryTrack]) -> tuple[str, int]:
        downloaded = sum(1 for track in tracks if self._track_download_available(track))
        if not tracks or downloaded == 0:
            return "none", downloaded
        if downloaded == len(tracks):
            return "downloaded", downloaded
        return "partial", downloaded

    @staticmethod
    def _track_download_available(track: LibraryTrack) -> bool:
        if not track.is_downloaded or not track.relative_path:
            return False
        try:
            path = resolve_library_path(track.relative_path)
            return path.is_file() and path.stat().st_size > 0
        except (OSError, ValueError):
            return False

    def _is_favorited(self, entity_type: str, entity_id: int) -> bool:
        field = Favorite.library_album_id if entity_type == "library_album" else Favorite.library_track_id
        return self.session.scalars(select(Favorite).where(field == entity_id)).first() is not None

    def _delete_track_downloads_and_commit(self, tracks: list[LibraryTrack]) -> int:
        """Atomically detach managed downloads, restoring files if the DB commit fails."""
        detached = 0
        selected_ids = {track.id for track in tracks}
        seen_paths: set[str] = set()
        staged: list[tuple[Path, Path]] = []
        with library_sync_guard():
            try:
                for track in tracks:
                    file_path = track.relative_path
                    if not file_path:
                        track.is_downloaded = False
                        continue
                    track.relative_path = None
                    track.is_downloaded = False
                    if file_path in seen_paths:
                        continue
                    seen_paths.add(file_path)
                    self._release_linked_song_reference(file_path, selected_ids)
                    if self._has_other_file_reference(file_path, selected_ids):
                        continue
                    try:
                        original = resolve_library_path(file_path)
                    except (OSError, ValueError):
                        logger.warning("Clearing an invalid managed download path from the database")
                        continue
                    if not original.exists():
                        detached += 1
                        continue
                    if not original.is_file():
                        raise OSError("The managed download path is not a regular file")
                    tombstone = original.with_name(f".{original.name}.aura-delete-{uuid4().hex}")
                    os.replace(original, tombstone)
                    staged.append((original, tombstone))
                    detached += 1
                self.session.commit()
            except Exception as exc:
                self.session.rollback()
                restoration_failed = False
                for original, tombstone in reversed(staged):
                    try:
                        if original.exists():
                            restoration_failed = True
                            logger.critical(
                                "Could not restore a staged music file because its original path was reused"
                            )
                        elif tombstone.exists():
                            os.replace(tombstone, original)
                        else:
                            restoration_failed = True
                            logger.critical("A staged music file disappeared before database rollback completed")
                    except OSError:
                        restoration_failed = True
                        logger.critical("Could not restore a staged music file after database rollback", exc_info=True)
                if restoration_failed:
                    raise ConflictError(
                        "Aura could not safely finish removing the download. Restart Aura before trying again."
                    ) from exc
                if isinstance(exc, OSError):
                    raise ConflictError(
                        "The download could not be removed because its file is in use or unavailable."
                    ) from exc
                raise

            for _original, tombstone in staged:
                try:
                    tombstone.unlink(missing_ok=True)
                except OSError:
                    logger.warning("A staged download will be cleaned up during the next library scan", exc_info=True)
        return detached

    def _release_linked_song_reference(self, file_path: str, selected_track_ids: set[int]) -> None:
        linked_song_ids = set(
            self.session.scalars(
                select(LibraryTrack.song_id).where(
                    LibraryTrack.id.in_(selected_track_ids),
                    LibraryTrack.song_id.isnot(None),
                )
            ).all()
        )
        for song_id in linked_song_ids:
            if song_id is None:
                continue
            still_used = self.session.scalars(
                select(LibraryTrack).where(
                    LibraryTrack.song_id == song_id,
                    LibraryTrack.relative_path == file_path,
                    LibraryTrack.id.notin_(selected_track_ids),
                )
            ).first()
            if still_used:
                continue
            song = self.session.get(Song, song_id)
            if song and song.relative_path == file_path:
                song.relative_path = None
                song.is_downloaded = False
        self.session.flush()

    def _has_other_file_reference(self, file_path: str, selected_track_ids: set[int]) -> bool:
        other_track = self.session.scalars(
            select(LibraryTrack).where(
                LibraryTrack.relative_path == file_path,
                LibraryTrack.id.notin_(selected_track_ids),
            )
        ).first()
        if other_track:
            return True
        return self.session.scalars(select(Song).where(Song.relative_path == file_path)).first() is not None
