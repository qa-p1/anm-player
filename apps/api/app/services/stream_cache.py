from __future__ import annotations

import hashlib
import logging
import threading
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.request import Request, build_opener

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import StreamCacheEntry
from app.core.config import settings
from app.services.settings import SettingsService
from app.services.ytmusic_service import PlaybackData, ytmusic_service
from app.storage import storage_manager

logger = logging.getLogger(__name__)


_cache_locks_guard = threading.Lock()
_cache_locks = tuple(threading.Lock() for _ in range(64))
_background_cache_active: set[str] = set()
_download_slots = threading.BoundedSemaphore(settings.stream_fetch_max_concurrency)


class StreamCacheService:
    def __init__(self, session: Session, cache_dir: str | Path | None = None, *, quality: str | None = None) -> None:
        self.session = session
        self._quality = quality
        self._managed_cache = cache_dir is None
        self.cache_dir = Path(cache_dir or storage_manager.paths.stream_cache)
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    @property
    def quality(self) -> str:
        return self._quality or SettingsService(self.session).get_str("stream_quality", "high")

    def get_cached_youtube_stream(self, video_id: str) -> tuple[Path, str] | None:
        try:
            self.clear_expired(limit=25)
        except SQLAlchemyError:
            logger.warning("failed to clear expired stream cache entries", exc_info=True)
            self.session.rollback()

        existing = self._entry(video_id)
        cached = self._cached_file(existing)
        if cached:
            self._touch_entry(existing)
        return cached

    def cache_youtube_stream(self, video_id: str, playback: PlaybackData | None = None) -> tuple[Path, str]:
        quality = self.quality
        lock = self._lock_for(f"{video_id}:{quality}")
        with lock:
            existing = self._entry(video_id)
            cached = self._cached_file(existing)
            if cached:
                self._touch_entry(existing)
                return cached

            resolved = playback or ytmusic_service.playback(video_id, quality=quality)
            cache_path, content_type, size = self._download_to_cache(video_id, resolved)
            self._upsert_entry(video_id, cache_path, content_type, size, existing)
            self._enforce_budget(protected_video_id=video_id)
            return cache_path, content_type

    @classmethod
    def start_background_cache(cls, video_id: str, playback: PlaybackData, *, quality: str = "high") -> None:
        active_key = f"{video_id}:{quality}"
        with _cache_locks_guard:
            if active_key in _background_cache_active:
                return
            _background_cache_active.add(active_key)

        def worker() -> None:
            from app.database.session import SessionLocal
            from app.storage.coordinator import storage_coordinator

            try:
                with storage_coordinator.filesystem_write():
                    with SessionLocal() as session:
                        cls(session, quality=quality).cache_youtube_stream(video_id, playback)
            except Exception:
                logger.warning("background stream cache failed", extra={"video_id": video_id}, exc_info=True)
            finally:
                with _cache_locks_guard:
                    _background_cache_active.discard(active_key)

        threading.Thread(target=worker, name=f"stream-cache-{video_id}", daemon=True).start()

    def clear_expired(self, *, limit: int = 100) -> int:
        now = self._now()
        entries = list(
            self.session.scalars(
                select(StreamCacheEntry)
                .where(StreamCacheEntry.expires_at <= now)
                .order_by(StreamCacheEntry.expires_at.asc())
                .limit(limit)
            )
        )
        removed = 0
        for entry in entries:
            try:
                self._resolve_cache_path(entry.relative_path).unlink(missing_ok=True)
            except ValueError:
                logger.warning("discarded an expired stream cache entry with an invalid path")
            except OSError:
                logger.warning("failed to delete expired stream cache file", extra={"relative_path": entry.relative_path})
                continue
            self.session.delete(entry)
            removed += 1
        if removed:
            self.session.commit()
        return removed

    def _entry(self, video_id: str) -> StreamCacheEntry | None:
        return self.session.scalars(
            select(StreamCacheEntry).where(
                StreamCacheEntry.source == "youtube",
                StreamCacheEntry.external_id == video_id,
                StreamCacheEntry.quality == self.quality,
            )
        ).first()

    def _retention_days(self) -> int:
        return SettingsService(self.session).get_int("stream_cache_retention_days", 30)

    def _cached_file(self, entry: StreamCacheEntry | None) -> tuple[Path, str] | None:
        if not entry:
            return None
        try:
            cache_path = self._resolve_cache_path(entry.relative_path)
            available = cache_path.is_file()
        except (OSError, ValueError):
            logger.warning(
                "ignored invalid stream cache entry",
                extra={"external_id": entry.external_id},
            )
            return None
        if not available or not self._is_future(entry.expires_at):
            return None
        return cache_path, entry.content_type

    def _touch_entry(self, entry: StreamCacheEntry) -> None:
        now = self._now()
        entry.last_accessed_at = now
        entry.expires_at = now + timedelta(days=self._retention_days())
        try:
            self.session.commit()
        except SQLAlchemyError:
            logger.warning("failed to update stream cache access time", extra={"external_id": entry.external_id}, exc_info=True)
            self.session.rollback()

    def _upsert_entry(
        self,
        video_id: str,
        cache_path: Path,
        content_type: str,
        size: int,
        existing: StreamCacheEntry | None,
    ) -> None:
        now = self._now()
        stored_path = (
            storage_manager.paths.store_stream(cache_path)
            if self._managed_cache
            else str(cache_path.resolve())
        )
        if existing is None:
            existing = StreamCacheEntry(
                source="youtube",
                external_id=video_id,
                relative_path=stored_path,
                quality=self.quality,
                content_type=content_type,
                size_bytes=size,
                expires_at=now + timedelta(days=self._retention_days()),
                last_accessed_at=now,
            )
            self.session.add(existing)
        else:
            existing.relative_path = stored_path
            existing.content_type = content_type
            existing.size_bytes = size
            existing.expires_at = now + timedelta(days=self._retention_days())
            existing.last_accessed_at = now
        self.session.commit()

    def _resolve_cache_path(self, cache_path: str) -> Path:
        if self._managed_cache:
            return storage_manager.paths.stream_file(cache_path)
        path = Path(cache_path).resolve()
        path.relative_to(self.cache_dir.resolve())
        return path

    def _is_future(self, value: datetime) -> bool:
        expires_at = value
        if expires_at.tzinfo is not None:
            expires_at = expires_at.astimezone(UTC).replace(tzinfo=None)
        return expires_at > self._now()

    def _now(self) -> datetime:
        return datetime.now(UTC).replace(tzinfo=None)

    @staticmethod
    def _lock_for(video_id: str) -> threading.Lock:
        index = int(hashlib.sha256(video_id.encode("utf-8")).hexdigest()[:8], 16)
        return _cache_locks[index % len(_cache_locks)]

    def _download_to_cache(self, video_id: str, playback: PlaybackData) -> tuple[Path, str, int]:
        content_type = self._content_type(playback)
        suffix = ".m4a" if content_type == "audio/mp4" else ".webm"
        filename = f"{hashlib.sha256(f'{video_id}:{self.quality}'.encode()).hexdigest()}{suffix}"
        target = self.cache_dir / filename
        temp = self.cache_dir / f"{filename}.part"
        temp.unlink(missing_ok=True)

        max_bytes = settings.stream_max_file_mb * 1024 * 1024
        request = Request(playback.stream_url, headers=playback.request_headers, method="GET")
        opener = build_opener()
        _download_slots.acquire()
        try:
            with opener.open(request, timeout=60) as response, temp.open("wb") as output:
                content_length = response.headers.get("Content-Length")
                if content_length:
                    try:
                        declared_size = int(content_length)
                    except ValueError:
                        declared_size = None
                    if declared_size is not None and declared_size > max_bytes:
                        raise ValueError("Stream exceeds the configured file-size limit")
                size = 0
                while True:
                    chunk = response.read(256 * 1024)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > max_bytes:
                        raise ValueError("Stream exceeds the configured file-size limit")
                    output.write(chunk)
            temp.replace(target)
            return target, content_type, target.stat().st_size
        finally:
            temp.unlink(missing_ok=True)
            _download_slots.release()

    def _enforce_budget(self, *, protected_video_id: str) -> None:
        budget = settings.stream_cache_budget_mb * 1024 * 1024
        entries = list(self.session.scalars(select(StreamCacheEntry).order_by(StreamCacheEntry.last_accessed_at.asc())))
        total = sum(entry.size_bytes for entry in entries)
        for entry in entries:
            if total <= budget:
                break
            if entry.external_id == protected_video_id:
                continue
            try:
                self._resolve_cache_path(entry.relative_path).unlink(missing_ok=True)
            except ValueError:
                logger.warning("discarded invalid stream cache entry", extra={"external_id": entry.external_id})
                total -= entry.size_bytes
                self.session.delete(entry)
                continue
            except OSError:
                logger.warning("failed to evict stream cache file", extra={"external_id": entry.external_id})
                continue
            total -= entry.size_bytes
            self.session.delete(entry)
        self.session.commit()

    def _content_type(self, playback: PlaybackData) -> str:
        return self.content_type_for_playback(playback)

    @staticmethod
    def content_type_for_playback(playback: PlaybackData) -> str:
        mime_type = str((playback.format or {}).get("mimeType") or "")
        if "audio/mp4" in mime_type or "mp4a" in mime_type:
            return "audio/mp4"
        return "audio/webm"
