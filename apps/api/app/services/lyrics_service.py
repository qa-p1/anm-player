"""
Lyrics service.

Extracts lyrics from audio files and provides lyrics API.
"""

import logging
import asyncio
import json
import re
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from sqlalchemy.orm import Session

from app.models import Song
from app.services.file_paths import resolve_library_path
from app.services.tagging import AudioTaggingService
from app.services.lyrics_cache import (
    LYRICS_STATUS_CACHED,
    LYRICS_STATUS_MISSING,
    LYRICS_STATUS_NOT_FOUND,
    LyricsCacheResult,
    LyricsCacheService,
)
from app.core.youtube import youtube_video_id
from app.services.ytmusic_service import ytmusic_service

logger = logging.getLogger(__name__)


class LyricsService:
    """Service for managing song lyrics."""
    
    def __init__(self, session: Session) -> None:
        self.session = session
        self.cache = LyricsCacheService(session)

    def get_song_lyrics(self, song_id: int) -> LyricsCacheResult:
        song = self.session.get(Song, song_id)
        if not song:
            return LyricsCacheResult(lyrics=None, status=LYRICS_STATUS_MISSING)

        result = self.cache.get("local_song", str(song_id))
        if result.status != LYRICS_STATUS_MISSING:
            return result

        legacy = self.extract_lyrics(song_id)
        if legacy:
            provider = "manual" if song.lyrics else "embedded"
            return self.cache.save_cached("local_song", str(song_id), legacy, provider=provider, song_id=song_id)
        return result

    def get_youtube_lyrics(self, video_id: str) -> LyricsCacheResult:
        return self.cache.get("youtube", video_id)
    
    def extract_lyrics(self, song_id: int) -> str | None:
        """
        Extract lyrics from song file tags.
        
        Supports:
        - ID3 USLT (MP3)
        - Vorbis LYRICS (OGG, FLAC)
        - MP4 ©lyr (M4A)
        """
        song = self.session.get(Song, song_id)
        if not song:
            return None

        if song.lyrics:
            return song.lyrics
        if not song.relative_path:
            return None
        
        try:
            file_path = resolve_library_path(song.relative_path)
        except (OSError, ValueError):
            logger.warning("Rejected invalid managed lyrics path for song %s", song_id)
            return None
        if not file_path.exists():
            logger.warning("Lyrics source file not found for song %s", song_id)
            return None
        
        try:
            lyrics = AudioTaggingService().read_lyrics(file_path)
        except Exception as exc:
            logger.warning("Failed to extract lyrics for song %s: %s", song_id, exc)
            return None
        if lyrics:
            logger.debug("Extracted embedded lyrics for song %s", song_id)
        return lyrics

    def save_lyrics(self, song_id: int, lyrics: str) -> bool:
        """
        Save lyrics to song file tags.
        
        Returns True if successful.
        """
        song = self.session.get(Song, song_id)
        if not song:
            return False

        song.lyrics = lyrics
        self.session.commit()

        if not song.relative_path:
            return True
        
        try:
            file_path = resolve_library_path(song.relative_path)
        except (OSError, ValueError):
            logger.warning("Rejected invalid managed lyrics path for song %s", song_id)
            return False
        if not file_path.exists():
            return False

        # The database copy is authoritative; embedding is best-effort.
        if AudioTaggingService().write_lyrics(file_path, lyrics):
            logger.info("Saved lyrics for song %s", song_id)
        return True

    def save_song_lyrics(self, song_id: int, lyrics: str) -> LyricsCacheResult | None:
        if not self.save_lyrics(song_id, lyrics):
            return None
        return self.cache.save_cached("local_song", str(song_id), lyrics, provider="manual", song_id=song_id)

    async def fetch_and_save_lyrics(self, song_id: int, *, force: bool = False, embed: bool = True) -> LyricsCacheResult:
        song = self.session.get(Song, song_id)
        if not song:
            return LyricsCacheResult(lyrics=None, status=LYRICS_STATUS_MISSING)

        lock = self.cache.lock_for("local_song", str(song_id))
        await asyncio.to_thread(lock.acquire)
        try:
            if not force:
                cached = self.get_song_lyrics(song_id)
                if cached.status in {LYRICS_STATUS_CACHED, LYRICS_STATUS_NOT_FOUND}:
                    return cached

            existing = self.extract_lyrics(song_id)
            if existing:
                provider = "manual" if song.lyrics else "embedded"
                return self.cache.save_cached("local_song", str(song_id), existing, provider=provider, song_id=song_id)

            try:
                video_id = self._video_id_from_url(song.source_url)
                innertube_lyrics: str | None = None
                if video_id:
                    innertube_lyrics = await ytmusic_service.lyrics(video_id)
                    if innertube_lyrics and self._has_lrc_timestamps(innertube_lyrics):
                        if embed:
                            self.save_lyrics(song_id, innertube_lyrics)
                        return self.cache.save_cached(
                            "local_song",
                            str(song_id),
                            innertube_lyrics,
                            provider="ytmusic",
                            song_id=song_id,
                        )

                lyrics = await asyncio.to_thread(
                    self._fetch_lrclib,
                    title=song.title,
                    artist=song.artist.name if song.artist else None,
                    album=song.album.title if song.album else None,
                    duration=song.duration_seconds,
                )
                if lyrics:
                    if embed:
                        self.save_lyrics(song_id, lyrics)
                    return self.cache.save_cached("local_song", str(song_id), lyrics, provider="lrclib", song_id=song_id)
                if innertube_lyrics:
                    if embed:
                        self.save_lyrics(song_id, innertube_lyrics)
                    return self.cache.save_cached("local_song", str(song_id), innertube_lyrics, provider="ytmusic", song_id=song_id)
                return self.cache.save_not_found("local_song", str(song_id), provider="provider", song_id=song_id)
            except TimeoutError:
                logger.info("lyrics lookup timed out", extra={"song_id": song_id})
                return self.cache.save_error("local_song", str(song_id), error_code="timeout", provider="provider", song_id=song_id)
            except OSError as exc:
                logger.info("lyrics lookup offline/network failure", extra={"song_id": song_id, "error": str(exc)})
                return self.cache.save_error("local_song", str(song_id), error_code="offline", provider="provider", song_id=song_id)
            except Exception as exc:
                logger.warning("lyrics lookup failed", extra={"song_id": song_id, "error": str(exc)}, exc_info=True)
                return self.cache.save_error("local_song", str(song_id), error_code="provider_error", provider="provider", song_id=song_id)
        finally:
            lock.release()

    async def fetch_online_lyrics(
        self,
        *,
        video_id: str,
        title: str | None = None,
        artist: str | None = None,
        album: str | None = None,
        duration: int | None = None,
        force: bool = False,
    ) -> LyricsCacheResult:
        lock = self.cache.lock_for("youtube", video_id)
        await asyncio.to_thread(lock.acquire)
        try:
            if not force:
                cached = self.cache.get("youtube", video_id)
                if cached.status in {LYRICS_STATUS_CACHED, LYRICS_STATUS_NOT_FOUND}:
                    return cached
            try:
                lyrics = await ytmusic_service.lyrics(video_id)
                if lyrics and self._has_lrc_timestamps(lyrics):
                    return self.cache.save_cached("youtube", video_id, lyrics, provider="ytmusic")

                lrclib_lyrics = await asyncio.to_thread(self._fetch_lrclib, title=title, artist=artist, album=album, duration=duration)
                if lrclib_lyrics:
                    return self.cache.save_cached("youtube", video_id, lrclib_lyrics, provider="lrclib")
                if lyrics:
                    return self.cache.save_cached("youtube", video_id, lyrics, provider="ytmusic")
                return self.cache.save_not_found("youtube", video_id, provider="provider")
            except TimeoutError:
                logger.info("online lyrics lookup timed out", extra={"video_id": video_id})
                return self.cache.save_error("youtube", video_id, error_code="timeout", provider="provider")
            except OSError as exc:
                logger.info("online lyrics lookup offline/network failure", extra={"video_id": video_id, "error": str(exc)})
                return self.cache.save_error("youtube", video_id, error_code="offline", provider="provider")
            except Exception as exc:
                logger.warning("online lyrics lookup failed", extra={"video_id": video_id, "error": str(exc)}, exc_info=True)
                return self.cache.save_error("youtube", video_id, error_code="provider_error", provider="provider")
        finally:
            lock.release()

    def _fetch_lrclib(
        self,
        *,
        title: str | None,
        artist: str | None,
        album: str | None,
        duration: int | None,
    ) -> str | None:
        """Exact match first, then without the album (YouTube album names rarely
        match), then LRCLIB's search, preferring synced lyrics of the same length."""
        if not title or not artist:
            return None
        track = self._clean_title(title)
        exact: dict[str, str] = {"track_name": track, "artist_name": artist}
        if duration:
            exact["duration"] = str(int(duration))
        attempts = [{**exact, "album_name": album}] if album else []
        attempts.append(exact)
        for params in attempts:
            payload = self._lrclib_request("get", params)
            lyrics = self._lyrics_from(payload) if isinstance(payload, dict) else None
            if lyrics:
                return lyrics
        results = self._lrclib_request("search", {"track_name": track, "artist_name": artist})
        if not isinstance(results, list):
            return None

        def rank(item: dict) -> tuple[bool, bool, float]:
            length = item.get("duration")
            gap = abs(float(length) - duration) if duration and isinstance(length, (int, float)) else 0.0
            return (gap <= 3, bool(item.get("syncedLyrics")), -gap)

        candidates = [item for item in results if isinstance(item, dict) and self._lyrics_from(item)]
        if duration:
            candidates = [item for item in candidates if not isinstance(item.get("duration"), (int, float)) or abs(item["duration"] - duration) <= 10]
        return self._lyrics_from(max(candidates, key=rank)) if candidates else None

    def _lrclib_request(self, endpoint: str, params: dict[str, str]) -> object:
        request = Request(
            f"https://lrclib.net/api/{endpoint}?{urlencode(params)}",
            headers={"Accept": "application/json", "User-Agent": "ANMPlayer/1.1 (local music app)"},
            method="GET",
        )
        try:
            with urlopen(request, timeout=15) as response:
                return json.loads(response.read().decode("utf-8"))
        except Exception as exc:
            logger.info("LRCLIB lyrics lookup failed", extra={"endpoint": endpoint, "error": str(exc)})
            return None

    @staticmethod
    def _lyrics_from(payload: dict) -> str | None:
        for key in ("syncedLyrics", "plainLyrics"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return None

    def _video_id_from_url(self, source_url: str | None) -> str | None:
        return youtube_video_id(source_url, allow_bare_id=True)

    def _clean_title(self, title: str) -> str:
        return re.sub(r"\s+\((official|lyrics?|audio|video|visualizer)[^)]*\)\s*$", "", title, flags=re.IGNORECASE).strip()

    def _has_lrc_timestamps(self, lyrics: str) -> bool:
        return bool(re.search(r"^\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]", lyrics, flags=re.MULTILINE))
