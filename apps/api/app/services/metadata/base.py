"""
Base classes for metadata providers.

Defines the interface that all metadata providers must implement.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any


@dataclass
class MetadataResult:
    """Result from metadata provider lookup."""
    
    title: str | None = None
    artist: str | None = None
    album: str | None = None
    album_artist: str | None = None
    
    track_number: int | None = None
    disc_number: int | None = None
    total_tracks: int | None = None
    total_discs: int | None = None
    
    year: int | None = None
    release_date: str | None = None
    label: str | None = None
    catalog_number: str | None = None
    
    genre: list[str] | None = None
    style: list[str] | None = None
    
    composer: str | None = None
    conductor: str | None = None
    
    isrc: str | None = None
    provider_track_id: str | None = None
    provider_release_id: str | None = None
    provider_artist_id: str | None = None
    
    artwork_url: str | None = None
    artwork_urls: dict[str, str] | None = None  # quality -> url mapping
    
    duration_ms: int | None = None
    language: str | None = None
    country: str | None = None
    
    provider: str | None = None
    confidence: float = 0.0  # 0.0 to 1.0
    raw_data: dict[str, Any] | None = None


class MetadataProvider(ABC):
    """Abstract base class for metadata providers."""
    
    @property
    @abstractmethod
    def name(self) -> str:
        """Provider name."""
        pass
    
    @abstractmethod
    async def search(
        self,
        *,
        title: str | None = None,
        artist: str | None = None,
        album: str | None = None,
        duration_ms: int | None = None,
        isrc: str | None = None,
        limit: int = 5,
    ) -> list[MetadataResult]:
        """
        Search for metadata matching the given criteria.
        
        Args:
            title: Song title
            artist: Artist name
            album: Album title
            duration_ms: Track duration in milliseconds (for matching)
            isrc: International Standard Recording Code
            limit: Maximum number of results to return
            
        Returns:
            List of metadata results, sorted by confidence score
        """
        pass
    
    @abstractmethod
    async def get_artwork(self, identifier: str) -> str | None:
        """
        Fetch artwork URL for a given identifier.
        
        Args:
            identifier: Provider-specific ID
            
        Returns:
            URL to high-quality artwork or None
        """
        pass
