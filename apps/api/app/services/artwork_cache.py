"""Validated, bounded artwork caching."""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import secrets
import threading
import warnings
from io import BytesIO
from pathlib import Path
from urllib.parse import urljoin, urlsplit

import httpx
from PIL import Image

from app.core.config import settings
from app.storage import storage_manager

logger = logging.getLogger(__name__)

_url_locks = tuple(threading.Lock() for _ in range(64))
_download_slots = threading.BoundedSemaphore(settings.artwork_max_concurrency)
_eviction_lock = threading.Lock()


def _safe_url_host(url: str) -> str | None:
    try:
        return urlsplit(url).hostname
    except ValueError:
        return None


async def _acquire_cancel_safe(primitive) -> None:
    acquisition = asyncio.create_task(asyncio.to_thread(primitive.acquire))
    try:
        await asyncio.shield(acquisition)
    except asyncio.CancelledError:
        await acquisition
        primitive.release()
        raise


async def _run_thread_cancel_safe(function, *args) -> None:
    work = asyncio.create_task(asyncio.to_thread(function, *args))
    try:
        await asyncio.shield(work)
    except asyncio.CancelledError:
        await work
        raise


class ArtworkCacheService:
    """Download provider artwork only after validating and decoding it."""

    MAX_CACHE_FILES = 1000
    MAX_CACHE_BYTES = 512 * 1024 * 1024
    ALLOWED_REMOTE_HOSTS = ("googleusercontent.com", "ggpht.com", "ytimg.com")
    ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}

    def __init__(self, cache_dir: str | Path | None = None) -> None:
        self.cache_dir = Path(cache_dir or storage_manager.paths.artwork_cache)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.sizes = {"thumb": 150, "small": 300, "medium": 500, "large": 1000}
        for size_name in (*self.sizes, "original"):
            (self.cache_dir / size_name).mkdir(exist_ok=True)

    @property
    def max_download_bytes(self) -> int:
        return settings.artwork_max_response_mb * 1024 * 1024

    def get_cache_path(self, url: str, size: str = "medium") -> Path:
        url_hash = hashlib.sha256(url.encode("utf-8")).hexdigest()
        return self.cache_dir / size / f"{url_hash}.jpg"

    def is_allowed_remote_url(self, url: str) -> bool:
        try:
            parsed = urlsplit(url)
            hostname = (parsed.hostname or "").rstrip(".").lower()
            if parsed.scheme != "https" or not hostname or parsed.username or parsed.password:
                return False
            if parsed.port not in (None, 443):
                return False
        except ValueError:
            return False
        return any(hostname == host or hostname.endswith(f".{host}") for host in self.ALLOWED_REMOTE_HOSTS)

    async def download_and_cache(self, url: str, optimize: bool = True) -> Path | None:
        if not self.is_allowed_remote_url(url):
            logger.warning("blocked disallowed artwork URL", extra={"host": _safe_url_host(url)})
            return None
        cached = self.get_cached_artwork(url, "medium")
        if cached:
            return cached

        lock = self._lock_for(url)
        lock_acquired = False
        slot_acquired = False
        try:
            await _acquire_cancel_safe(lock)
            lock_acquired = True
            cached = self.get_cached_artwork(url, "medium")
            if cached:
                return cached
            await _acquire_cancel_safe(_download_slots)
            slot_acquired = True
            content = await self._download(url)
            if content is None:
                return None
            await _run_thread_cancel_safe(self._publish_validated_image, content, url, optimize)
            medium_path = self.get_cache_path(url, "medium")
            if not medium_path.is_file():
                return None
            await _run_thread_cancel_safe(self._evict_cache)
            return medium_path if medium_path.is_file() else None
        except Exception:
            logger.warning("failed to cache artwork", extra={"host": _safe_url_host(url)}, exc_info=True)
            return None
        finally:
            if slot_acquired:
                _download_slots.release()
            if lock_acquired:
                lock.release()

    async def _download(self, url: str) -> bytes | None:
        timeout = httpx.Timeout(10.0, connect=3.0)
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
            current_url = url
            for _redirect in range(4):
                if not self.is_allowed_remote_url(current_url):
                    return None
                async with client.stream("GET", current_url) as response:
                    if response.status_code in {301, 302, 303, 307, 308}:
                        location = response.headers.get("location")
                        if not location:
                            return None
                        current_url = urljoin(current_url, location)
                        continue

                    response.raise_for_status()
                    if not response.headers.get("content-type", "").casefold().startswith("image/"):
                        return None
                    content_length = response.headers.get("content-length")
                    if content_length:
                        try:
                            if int(content_length) > self.max_download_bytes:
                                return None
                        except ValueError:
                            return None
                    content = bytearray()
                    async for chunk in response.aiter_bytes():
                        content.extend(chunk)
                        if len(content) > self.max_download_bytes:
                            return None
                    return bytes(content)
            return None

    def _publish_validated_image(self, content: bytes, url: str, optimize: bool) -> None:
        temporary: list[Path] = []
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(BytesIO(content)) as source:
                    if source.format not in self.ALLOWED_FORMATS:
                        raise ValueError("Unsupported artwork format")
                    if source.width * source.height > settings.artwork_max_pixels:
                        raise ValueError("Artwork dimensions exceed the configured limit")
                    source.load()
                    base_image = source.convert("RGB")

            original = self.get_cache_path(url, "original")
            original_temp = self._temporary_path(original)
            temporary.append(original_temp)
            base_image.save(original_temp, "JPEG", quality=92, optimize=True, progressive=True)

            sizes = self.sizes if optimize else {"medium": self.sizes["medium"]}
            publications: list[tuple[Path, Path]] = [(original_temp, original)]
            for size_name, max_size in sizes.items():
                target = self.get_cache_path(url, size_name)
                temp = self._temporary_path(target)
                temporary.append(temp)
                resized = base_image.copy()
                try:
                    resized.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
                    resized.save(temp, "JPEG", quality=85, optimize=True, progressive=True)
                finally:
                    resized.close()
                publications.append((temp, target))
            base_image.close()

            for temp, target in publications:
                os.replace(temp, target)
                temporary.remove(temp)
        finally:
            for temp in temporary:
                temp.unlink(missing_ok=True)

    async def _create_sizes(self, source_path: Path, original_url: str) -> None:
        """Compatibility helper used by characterization tests."""
        content = await asyncio.to_thread(source_path.read_bytes)
        await _run_thread_cancel_safe(self._publish_validated_image, content, original_url, True)

    def get_cached_artwork(self, url: str, size: str = "medium") -> Path | None:
        cache_path = self.get_cache_path(url, size)
        if not cache_path.is_file():
            return None
        try:
            os.utime(cache_path)
        except OSError:
            pass
        return cache_path

    def _evict_cache(self) -> None:
        with _eviction_lock:
            entries: list[tuple[float, int, Path]] = []
            for path in self.cache_dir.rglob("*.jpg"):
                try:
                    stat = path.stat()
                except OSError:
                    continue
                entries.append((stat.st_mtime, stat.st_size, path))
            entries.sort(key=lambda entry: entry[0])
            total_bytes = sum(entry[1] for entry in entries)
            max_bytes = self.MAX_CACHE_BYTES
            try:
                from app.database.session import SessionLocal
                from app.services.settings import SettingsService

                with SessionLocal() as session:
                    max_bytes = SettingsService(session).get_int("artwork_cache_limit_mb", 512) * 1024 * 1024
            except Exception:
                logger.debug("using default artwork cache limit", exc_info=True)
            while entries and (len(entries) > self.MAX_CACHE_FILES or total_bytes > max_bytes):
                _modified, size, oldest = entries.pop(0)
                try:
                    oldest.unlink()
                    total_bytes -= size
                except OSError:
                    continue

    def public_path(self, cached_path: Path) -> str:
        relative = cached_path.relative_to(self.cache_dir)
        return f"/api/v1/media/artwork/cache/{relative.as_posix()}"

    @staticmethod
    def _temporary_path(target: Path) -> Path:
        return target.with_name(f".{target.name}.{secrets.token_hex(8)}.tmp")

    @staticmethod
    def _lock_for(url: str) -> threading.Lock:
        index = int(hashlib.sha256(url.encode("utf-8")).hexdigest()[:8], 16) % len(_url_locks)
        return _url_locks[index]
