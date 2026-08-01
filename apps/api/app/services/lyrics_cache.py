from __future__ import annotations

import hashlib
import logging
import threading
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.models import LyricsCacheEntry
from app.storage import storage_manager

logger = logging.getLogger(__name__)

LYRICS_STATUS_CACHED = "cached"
LYRICS_STATUS_MISSING = "missing"
LYRICS_STATUS_NOT_FOUND = "not_found"
LYRICS_STATUS_OFFLINE = "offline"
LYRICS_STATUS_ERROR = "error"

_lyrics_locks = tuple(threading.Lock() for _ in range(64))


@dataclass
class LyricsCacheResult:
    lyrics: str | None
    status: str
    source: str | None = None
    format: str | None = None
    error_code: str | None = None
    fetched_at: datetime | None = None

    @property
    def has_lyrics(self) -> bool:
        return bool(self.lyrics)


class LyricsCacheService:
    def __init__(self, session: Session, cache_dir: str | Path | None = None) -> None:
        self.session = session
        self._managed_cache = cache_dir is None
        self.cache_dir = Path(cache_dir or storage_manager.paths.lyrics_cache)
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def get(self, source: str, external_id: str) -> LyricsCacheResult:
        entry = self._entry(source, external_id)
        if not entry:
            return LyricsCacheResult(lyrics=None, status=LYRICS_STATUS_MISSING)

        if entry.status == LYRICS_STATUS_NOT_FOUND:
            self._touch(entry)
            return LyricsCacheResult(
                lyrics=None,
                status=LYRICS_STATUS_NOT_FOUND,
                source=entry.provider,
                format=entry.format,
                error_code=entry.error_code,
                fetched_at=entry.last_fetched_at,
            )

        if entry.status == LYRICS_STATUS_ERROR:
            self._touch(entry)
            return LyricsCacheResult(
                lyrics=None,
                status=entry.error_code or LYRICS_STATUS_ERROR,
                source=entry.provider,
                format=entry.format,
                error_code=entry.error_code,
                fetched_at=entry.last_fetched_at,
            )

        text = self._read_cached_file(entry)
        if text is None:
            return LyricsCacheResult(lyrics=None, status=LYRICS_STATUS_MISSING)

        self._touch(entry)
        return LyricsCacheResult(
            lyrics=text,
            status=LYRICS_STATUS_CACHED,
            source=entry.provider,
            format=entry.format,
            error_code=entry.error_code,
            fetched_at=entry.last_fetched_at,
        )

    def save_cached(
        self,
        source: str,
        external_id: str,
        lyrics: str,
        *,
        provider: str,
        song_id: int | None = None,
    ) -> LyricsCacheResult:
        cleaned = lyrics.strip()
        if not cleaned:
            return self.save_not_found(source, external_id, provider=provider, song_id=song_id)

        lyric_format = "lrc" if self.has_lrc_timestamps(cleaned) else "plain"
        cache_path = self._write_file(source, external_id, cleaned, lyric_format)
        now = self._now()
        entry = self._entry(source, external_id)
        if entry is None:
            entry = LyricsCacheEntry(source=source, external_id=external_id)
            self.session.add(entry)
        entry.song_id = song_id
        entry.relative_path = (
            storage_manager.paths.store_lyrics(cache_path)
            if self._managed_cache
            else str(cache_path.resolve())
        )
        entry.format = lyric_format
        entry.provider = provider
        entry.status = LYRICS_STATUS_CACHED
        entry.error_code = None
        entry.last_fetched_at = now
        entry.last_accessed_at = now
        self._commit()
        return LyricsCacheResult(
            lyrics=cleaned,
            status=LYRICS_STATUS_CACHED,
            source=provider,
            format=lyric_format,
            fetched_at=now,
        )

    def save_not_found(
        self,
        source: str,
        external_id: str,
        *,
        provider: str | None = None,
        song_id: int | None = None,
    ) -> LyricsCacheResult:
        now = self._now()
        entry = self._entry(source, external_id)
        if entry is None:
            entry = LyricsCacheEntry(source=source, external_id=external_id)
            self.session.add(entry)
        self._delete_cache_file(entry)
        entry.song_id = song_id
        entry.relative_path = None
        entry.format = None
        entry.provider = provider
        entry.status = LYRICS_STATUS_NOT_FOUND
        entry.error_code = None
        entry.last_fetched_at = now
        entry.last_accessed_at = now
        self._commit()
        return LyricsCacheResult(lyrics=None, status=LYRICS_STATUS_NOT_FOUND, source=provider, fetched_at=now)

    def save_error(
        self,
        source: str,
        external_id: str,
        *,
        error_code: str,
        provider: str | None = None,
        song_id: int | None = None,
    ) -> LyricsCacheResult:
        now = self._now()
        entry = self._entry(source, external_id)
        if entry is None:
            entry = LyricsCacheEntry(source=source, external_id=external_id)
            self.session.add(entry)
        entry.song_id = song_id
        entry.provider = provider
        entry.status = LYRICS_STATUS_ERROR
        entry.error_code = error_code
        entry.last_fetched_at = now
        entry.last_accessed_at = now
        self._commit()
        return LyricsCacheResult(lyrics=None, status=error_code, source=provider, error_code=error_code, fetched_at=now)

    def lock_for(self, source: str, external_id: str) -> threading.Lock:
        key = f"{source}:{external_id}"
        index = int(hashlib.sha256(key.encode("utf-8")).hexdigest()[:8], 16)
        return _lyrics_locks[index % len(_lyrics_locks)]

    def _entry(self, source: str, external_id: str) -> LyricsCacheEntry | None:
        return self.session.scalars(
            select(LyricsCacheEntry).where(
                LyricsCacheEntry.source == source,
                LyricsCacheEntry.external_id == external_id,
            )
        ).first()

    def _read_cached_file(self, entry: LyricsCacheEntry) -> str | None:
        if entry.status != LYRICS_STATUS_CACHED or not entry.relative_path:
            return None
        cache_path = self._resolve_cache_path(entry.relative_path)
        if cache_path is None:
            return None
        try:
            if not cache_path.is_file() or cache_path.stat().st_size <= 0:
                return None
            text = cache_path.read_text(encoding="utf-8").strip()
        except (OSError, UnicodeDecodeError):
            logger.warning("invalid lyrics cache file", extra={"cache_path": str(cache_path)}, exc_info=True)
            return None
        return text or None

    def _write_file(self, source: str, external_id: str, lyrics: str, lyric_format: str) -> Path:
        suffix = ".lrc" if lyric_format == "lrc" else ".txt"
        filename = f"{hashlib.sha256(f'{source}:{external_id}'.encode()).hexdigest()}{suffix}"
        target = self.cache_dir / filename
        temp = self.cache_dir / f"{filename}.part"
        temp.unlink(missing_ok=True)
        try:
            temp.write_text(lyrics, encoding="utf-8")
            if temp.stat().st_size <= 0:
                raise ValueError("Lyrics cache file was empty.")
            temp.replace(target)
        finally:
            temp.unlink(missing_ok=True)
        return target

    def _resolve_cache_path(self, cache_path: str) -> Path | None:
        try:
            path = (
                storage_manager.paths.lyrics_file(cache_path)
                if self._managed_cache
                else Path(cache_path).resolve()
            )
            path.resolve(strict=False).relative_to(self.cache_dir.resolve())
        except (ValueError, TypeError):
            logger.warning("lyrics cache path escaped cache directory", extra={"cache_path": cache_path})
            return None
        return path

    def _delete_cache_file(self, entry: LyricsCacheEntry) -> None:
        if not entry.relative_path:
            return
        path = self._resolve_cache_path(entry.relative_path)
        if path:
            try:
                path.unlink(missing_ok=True)
            except OSError:
                logger.warning("failed to delete stale lyrics cache file", extra={"cache_path": str(path)})

    def _touch(self, entry: LyricsCacheEntry) -> None:
        entry.last_accessed_at = self._now()
        self._commit()

    def _commit(self) -> None:
        try:
            self.session.commit()
        except SQLAlchemyError:
            self.session.rollback()
            raise

    def _now(self) -> datetime:
        return datetime.now(UTC).replace(tzinfo=None)

    @staticmethod
    def has_lrc_timestamps(lyrics: str) -> bool:
        import re

        return bool(re.search(r"^\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]", lyrics, flags=re.MULTILINE))
