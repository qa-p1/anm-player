"""
Artwork caching service.

Downloads, stores, and serves album artwork with optimization.
"""

import hashlib
import logging
import shutil
from pathlib import Path
from urllib.parse import urlsplit

import httpx

from app.storage import storage_manager

try:
    from PIL import Image
except ModuleNotFoundError:  # pragma: no cover - depends on optional runtime package
    Image = None

logger = logging.getLogger(__name__)


class ArtworkCacheService:
    """Service for managing artwork cache."""

    MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024
    MAX_CACHE_FILES = 1000
    MAX_CACHE_BYTES = 512 * 1024 * 1024
    ALLOWED_REMOTE_HOSTS = (
        "googleusercontent.com",
        "ggpht.com",
        "ytimg.com",
    )
    
    def __init__(self, cache_dir: str | Path | None = None) -> None:
        self.cache_dir = Path(cache_dir or storage_manager.paths.artwork_cache)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        
        # Create size directories
        self.sizes = {
            "thumb": 150,
            "small": 300,
            "medium": 500,
            "large": 1000,
        }
        
        for size_name in self.sizes:
            (self.cache_dir / size_name).mkdir(exist_ok=True)
    
    def get_cache_path(self, url: str, size: str = "medium") -> Path:
        """Get cache file path for a URL."""
        url_hash = hashlib.md5(url.encode()).hexdigest()
        return self.cache_dir / size / f"{url_hash}.jpg"

    def is_allowed_remote_url(self, url: str) -> bool:
        """Allow HTTPS artwork only from the configured provider image hosts."""
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
        """
        Download artwork and cache it in multiple sizes.
        
        Returns path to medium-sized cached image.
        """
        try:
            if not self.is_allowed_remote_url(url):
                logger.warning(f"Blocked disallowed artwork URL: {url}")
                return None
            cached = self.get_cached_artwork(url, "medium")
            if cached:
                return cached

            timeout = httpx.Timeout(10.0, connect=3.0)
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
                async with client.stream("GET", url) as response:
                    response.raise_for_status()
                    content_type = response.headers.get("content-type", "")
                    if not content_type.startswith("image/"):
                        logger.warning(f"Artwork URL did not return an image: {url}")
                        return None
                    content_length = response.headers.get("content-length")
                    if content_length and int(content_length) > self.MAX_DOWNLOAD_BYTES:
                        logger.warning(f"Artwork response exceeded size limit: {url}")
                        return None
                    content = bytearray()
                    async for chunk in response.aiter_bytes():
                        content.extend(chunk)
                        if len(content) > self.MAX_DOWNLOAD_BYTES:
                            logger.warning(f"Artwork response exceeded size limit: {url}")
                            return None
                
                # Save original
                original_path = self.cache_dir / "original" / f"{hashlib.md5(url.encode()).hexdigest()}.jpg"
                original_path.parent.mkdir(exist_ok=True)
                original_path.write_bytes(content)
                
                if optimize and Image is not None:
                    # Create optimized versions
                    await self._create_sizes(original_path, url)

                medium_path = self.get_cache_path(url, "medium")
                if not medium_path.exists():
                    shutil.copyfile(original_path, medium_path)

                self._evict_cache()

                return medium_path
                
        except Exception as exc:
            logger.error(f"Failed to download artwork from {url}: {exc}")
            return None
    
    async def _create_sizes(self, source_path: Path, original_url: str) -> None:
        """Create multiple size versions of artwork."""
        if Image is None:
            return

        try:
            with Image.open(source_path) as source:
                base_image = source.convert("RGB") if source.mode != "RGB" else source.copy()
                
                for size_name, max_size in self.sizes.items():
                    cache_path = self.get_cache_path(original_url, size_name)
                    resized = base_image.copy()
                    resized.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
                    resized.save(
                        cache_path,
                        "JPEG",
                        quality=85,
                        optimize=True,
                        progressive=True,
                    )
                    resized.close()
                base_image.close()
                    
        except Exception as exc:
            logger.error(f"Failed to create size versions: {exc}")
    
    def get_cached_artwork(self, url: str, size: str = "medium") -> Path | None:
        """Get cached artwork if it exists."""
        cache_path = self.get_cache_path(url, size)
        return cache_path if cache_path.exists() else None
    
    def clear_cache(self) -> int:
        """Clear all cached artwork. Returns number of files deleted."""
        count = 0
        for path in self.cache_dir.rglob("*.jpg"):
            path.unlink()
            count += 1
        return count
    
    def get_cache_size(self) -> int:
        """Get total cache size in bytes."""
        return sum(f.stat().st_size for f in self.cache_dir.rglob("*.jpg"))

    def _evict_cache(self) -> None:
        files = sorted(self.cache_dir.rglob("*.jpg"), key=lambda path: path.stat().st_mtime)
        total_bytes = sum(path.stat().st_size for path in files)
        max_bytes = self.MAX_CACHE_BYTES
        try:
            from app.database.session import SessionLocal
            from app.services.settings import SettingsService

            with SessionLocal() as session:
                max_bytes = SettingsService(session).get_int("artwork_cache_limit_mb", 512) * 1024 * 1024
        except Exception:
            logger.debug("using default artwork cache limit", exc_info=True)
        while files and (len(files) > self.MAX_CACHE_FILES or total_bytes > max_bytes):
            oldest = files.pop(0)
            try:
                size = oldest.stat().st_size
                oldest.unlink()
                total_bytes -= size
            except OSError:
                continue

    def public_path(self, cached_path: Path) -> str:
        """Return an API path for a cached artwork file."""
        relative = cached_path.relative_to(self.cache_dir)
        return f"/media/artwork/cache/{relative.as_posix()}"
