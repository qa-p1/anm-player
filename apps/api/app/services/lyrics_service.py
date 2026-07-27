"""
Lyrics service.

Extracts lyrics from audio files and provides lyrics API.
"""

import logging
import asyncio
import json
import re
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import Request, urlopen

from mutagen import File as MutagenFile
from sqlalchemy.orm import Session

from app.models import Song
from app.services.file_paths import resolve_library_path
from app.services.lyrics_cache import (
    LYRICS_STATUS_CACHED,
    LYRICS_STATUS_MISSING,
    LYRICS_STATUS_NOT_FOUND,
    LyricsCacheResult,
    LyricsCacheService,
)
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
            logger.warning(f"File not found: {file_path}")
            return None
        
        try:
            audio_file = MutagenFile(file_path)
            if not audio_file:
                return None
            
            # Try different tag formats
            lyrics = None
            
            # ID3 (MP3)
            if hasattr(audio_file, "tags") and audio_file.tags:
                # USLT frame (Unsynchronized Lyrics)
                uslt_frames = audio_file.tags.getall("USLT")
                if uslt_frames:
                    lyrics = str(uslt_frames[0].text)
            
            # Vorbis comments (OGG, FLAC)
            if not lyrics and hasattr(audio_file, "get"):
                lyrics = audio_file.get("LYRICS", [None])[0]
                if not lyrics:
                    lyrics = audio_file.get("UNSYNCEDLYRICS", [None])[0]
            
            # MP4 (M4A)
            if not lyrics and hasattr(audio_file, "tags") and hasattr(audio_file.tags, "get"):
                lyrics = audio_file.tags.get("©lyr", [None])[0]
            
            if lyrics:
                logger.info(f"Extracted lyrics for song {song_id}")
                return str(lyrics).strip()
            
            logger.info(f"No lyrics found for song {song_id}")
            return None
            
        except Exception as exc:
            logger.error(f"Failed to extract lyrics for song {song_id}: {exc}")
            return None
    
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
        
        try:
            audio_file = MutagenFile(file_path)
            if not audio_file:
                return True
            
            # Save based on file type
            if hasattr(audio_file, "tags"):
                # ID3 (MP3)
                from mutagen.id3 import ID3, ID3NoHeaderError, USLT
                try:
                    tags = ID3(file_path)
                except ID3NoHeaderError:
                    tags = ID3()
                tags.delall("USLT")
                tags.add(USLT(encoding=3, lang="eng", desc="", text=lyrics))
                tags.save(file_path)
            elif hasattr(audio_file, "__setitem__"):
                # Vorbis (OGG, FLAC)
                audio_file["LYRICS"] = lyrics
                audio_file.save()
            
            logger.info(f"Saved lyrics for song {song_id}")
            return True
            
        except Exception as exc:
            logger.error(f"Failed to save lyrics for song {song_id}: {exc}")
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

                lyrics = self._fetch_lrclib(
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

                lrclib_lyrics = self._fetch_lrclib(title=title, artist=artist, album=album, duration=duration)
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
        if not title or not artist:
            return None

        params: dict[str, str] = {
            "track_name": self._clean_title(title),
            "artist_name": artist,
        }
        if album:
            params["album_name"] = album
        if duration:
            params["duration"] = str(int(duration))

        request = Request(
            f"https://lrclib.net/api/get?{urlencode(params)}",
            headers={
                "Accept": "application/json",
                "User-Agent": "AuraMusic/0.1 (local music app)",
            },
            method="GET",
        )
        try:
            with urlopen(request, timeout=15) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except Exception as exc:
            logger.info("LRCLIB lyrics lookup failed", extra={"title": title, "artist": artist, "error": str(exc)})
            return None

        synced = payload.get("syncedLyrics")
        if isinstance(synced, str) and synced.strip():
            return synced.strip()
        plain = payload.get("plainLyrics")
        if isinstance(plain, str) and plain.strip():
            return plain.strip()
        return None

    def _video_id_from_url(self, source_url: str | None) -> str | None:
        if not source_url:
            return None
        parsed = urlparse(source_url)
        if parsed.hostname in {"youtu.be", "www.youtu.be"}:
            return parsed.path.strip("/") or None
        query = parse_qs(parsed.query)
        video_id = (query.get("v") or [None])[0]
        if video_id:
            return video_id
        match = re.search(r"^[A-Za-z0-9_-]{11}$", source_url)
        return source_url if match else None

    def _clean_title(self, title: str) -> str:
        return re.sub(r"\s+\((official|lyrics?|audio|video|visualizer).+?\)\s*$", "", title, flags=re.IGNORECASE).strip()

    def _has_lrc_timestamps(self, lyrics: str) -> bool:
        return bool(re.search(r"^\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]", lyrics, flags=re.MULTILINE))
