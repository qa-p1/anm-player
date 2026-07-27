from __future__ import annotations

import mimetypes
from dataclasses import dataclass
from pathlib import Path
from collections.abc import Callable
from typing import Literal
from urllib.parse import parse_qs, urlparse

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import LibraryTrack, Song
from app.services.file_paths import resolve_library_path
from app.services.settings import SettingsService
from app.services.stream_cache import StreamCacheService
from app.services.ytmusic_service import PlaybackData, ytmusic_service


PlaybackSourceKind = Literal["downloaded", "cache", "streaming"]


@dataclass(slots=True)
class ResolvedPlaybackSource:
    kind: PlaybackSourceKind
    media_type: str
    path: Path | None = None
    playback: PlaybackData | None = None


class PlaybackSourceService:
    """Single source of truth for online playback-source priority."""

    def __init__(
        self,
        session: Session,
        *,
        resolve_music_path: Callable[[str | Path], Path] = resolve_library_path,
    ) -> None:
        self.session = session
        self.resolve_music_path = resolve_music_path

    def resolve_youtube(self, video_id: str) -> ResolvedPlaybackSource:
        downloaded = self._downloaded_youtube(video_id)
        if downloaded:
            return downloaded

        quality = SettingsService(self.session).get_str("stream_quality", "high")
        cache = StreamCacheService(self.session, quality=quality)
        cached = cache.get_cached_youtube_stream(video_id)
        if cached:
            path, media_type = cached
            return ResolvedPlaybackSource(kind="cache", path=path, media_type=media_type)

        playback = ytmusic_service.playback(video_id, quality=quality)
        StreamCacheService.start_background_cache(video_id, playback, quality=quality)
        return ResolvedPlaybackSource(
            kind="streaming",
            media_type=StreamCacheService.content_type_for_playback(playback),
            playback=playback,
        )

    def _downloaded_youtube(self, video_id: str) -> ResolvedPlaybackSource | None:
        changed = False
        tracks = self.session.scalars(
            select(LibraryTrack).where(
                LibraryTrack.source == "youtube",
                LibraryTrack.external_id == video_id,
                LibraryTrack.is_downloaded.is_(True),
            )
        ).all()
        for track in tracks:
            resolved = self._validated_file(track.relative_path)
            if resolved:
                return resolved
            track.is_downloaded = False
            track.relative_path = None
            changed = True

        songs = self.session.scalars(
            select(Song).where(
                Song.is_downloaded.is_(True),
                Song.source_url.isnot(None),
                Song.source_url.contains(video_id),
            )
        ).all()
        for song in songs:
            if self._youtube_video_id(song.source_url) != video_id:
                continue
            resolved = self._validated_file(song.relative_path)
            if resolved:
                if changed:
                    self.session.commit()
                return resolved
            song.is_downloaded = False
            song.relative_path = None
            changed = True

        if changed:
            self.session.commit()
        return None

    def _validated_file(self, relative_path: str | None) -> ResolvedPlaybackSource | None:
        if not relative_path:
            return None
        try:
            path = self.resolve_music_path(relative_path)
            available = path.is_file()
        except (OSError, ValueError):
            return None
        if not available:
            return None
        return ResolvedPlaybackSource(
            kind="downloaded",
            path=path,
            media_type=mimetypes.guess_type(path.name)[0] or "application/octet-stream",
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
