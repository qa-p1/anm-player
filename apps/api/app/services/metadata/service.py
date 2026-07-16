"""
Metadata Enrichment Service.

Orchestrates metadata fetching from multiple providers and
applies enrichment to songs in the library.
"""

import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Album, Artist, Song
from app.services.artwork_cache import ArtworkCacheService
from app.services.file_paths import resolve_library_path
from app.services.metadata.base import MetadataProvider, MetadataResult
from app.services.metadata.youtube_provider import YouTubeMusicMetadataProvider
from app.services.tagging import AudioTagData, AudioTaggingService
from app.services.settings import SettingsService
from app.storage import storage_manager

logger = logging.getLogger(__name__)


class MetadataEnrichmentService:
    """
    Service for enriching song metadata from external providers.
    
    External provider enrichment is disabled. YouTube Music browse and download
    data is the app's active metadata source.
    """
    
    def __init__(self, session: Session) -> None:
        self.session = session
        self.tagging = AudioTaggingService()
        self.artwork_cache = ArtworkCacheService(storage_manager.paths.artwork_cache)
        self.providers: list[MetadataProvider] = [YouTubeMusicMetadataProvider()]
    
    async def enrich_song(self, song_id: int, provider_name: str | None = None) -> Song | None:
        """
        Enrich a single song with metadata from providers.
        
        Args:
            song_id: ID of song to enrich
            provider_name: Specific provider to use (None = try all)
            
        Returns:
            Updated song or None if not found
        """
        song = self.session.get(Song, song_id)
        if not song:
            logger.warning(f"Song {song_id} not found")
            return None
        
        logger.info(f"Enriching song {song_id}: {song.title} by {song.artist.name if song.artist else 'Unknown'}")
        
        # Select providers
        providers = [p for p in self.providers if p.name == provider_name] if provider_name else self.providers
        
        if not providers:
            logger.warning(f"No providers available for {provider_name}")
            return song
        
        # Search all providers
        all_results: list[MetadataResult] = []
        for provider in providers:
            try:
                results = await provider.search(
                    title=song.title,
                    artist=song.artist.name if song.artist else None,
                    album=song.album.title if song.album else None,
                    duration_ms=song.duration_seconds * 1000 if song.duration_seconds else None,
                    limit=3,
                )
                all_results.extend(results)
                logger.info(f"Provider {provider.name} returned {len(results)} results")
            except Exception as exc:
                logger.error(f"Provider {provider.name} failed: {exc}")
                continue
        
        if not all_results:
            logger.warning(f"No metadata found for song {song_id}")
            return song
        
        # Select best result by confidence
        all_results.sort(key=lambda r: r.confidence, reverse=True)
        best_result = all_results[0]
        
        logger.info(f"Best match: {best_result.title} by {best_result.artist} (confidence: {best_result.confidence:.2f})")
        
        # Apply metadata to song
        await self._apply_metadata(song, best_result)
        
        self.session.commit()
        return song
    
    async def enrich_album(self, album_id: int) -> Album | None:
        """
        Enrich all songs in an album.
        
        Args:
            album_id: ID of album to enrich
            
        Returns:
            Updated album or None if not found
        """
        album = self.session.get(Album, album_id)
        if not album:
            logger.warning(f"Album {album_id} not found")
            return None
        
        logger.info(f"Enriching album {album_id}: {album.title}")
        
        for song in album.songs:
            if song.is_downloaded:
                try:
                    await self.enrich_song(song.id)
                except Exception as exc:
                    logger.error(f"Failed to enrich song {song.id}: {exc}")
                    continue
        
        return album
    
    async def search_metadata(
        self,
        *,
        title: str | None = None,
        artist: str | None = None,
        album: str | None = None,
        duration_ms: int | None = None,
        provider_name: str | None = None,
        limit: int = 5,
    ) -> list[MetadataResult]:
        """
        Search for metadata without applying to database.
        
        Useful for preview before enrichment.
        
        Args:
            title: Song title
            artist: Artist name
            album: Album title
            duration_ms: Duration in milliseconds
            provider_name: Specific provider to use
            limit: Maximum results
            
        Returns:
            List of metadata results sorted by confidence
        """
        providers = [p for p in self.providers if p.name == provider_name] if provider_name else self.providers
        
        all_results: list[MetadataResult] = []
        for provider in providers:
            try:
                results = await provider.search(
                    title=title,
                    artist=artist,
                    album=album,
                    duration_ms=duration_ms,
                    limit=limit,
                )
                all_results.extend(results)
            except Exception as exc:
                logger.error(f"Provider {provider.name} failed: {exc}")
                continue
        
        # Sort by confidence and limit
        all_results.sort(key=lambda r: r.confidence, reverse=True)
        return all_results[:limit]
    
    async def _apply_metadata(self, song: Song, metadata: MetadataResult) -> None:
        """
        Apply metadata to song and related entities.
        
        Updates:
        - Song metadata (track number, ISRC, etc.)
        - Artist information
        - Album information
        - Artwork (if available)
        """
        # Update song
        if metadata.title:
            song.title = metadata.title
        if metadata.track_number:
            song.track_number = metadata.track_number
        if metadata.disc_number:
            song.disc_number = metadata.disc_number

        if metadata.artist:
            artist = self._get_or_create_artist(metadata.artist)
            song.artist_id = artist.id

        # Update album
        if metadata.album:
            album_artist_id = song.artist_id
            album = self._get_or_create_album(metadata.album, album_artist_id)
            song.album_id = album.id
        else:
            album = song.album

        if album and metadata.year and (not album.year or album.year == 0):
            album.year = metadata.year
        
        # Fetch and store artwork
        if album and metadata.provider_release_id and not album.artwork_path:
            await self._fetch_artwork(album, metadata.provider_release_id)

        if song.relative_path:
            self.tagging.write_tags(
                resolve_library_path(song.relative_path),
                AudioTagData(
                    title=song.title,
                    artist=metadata.artist or (song.artist.name if song.artist else None),
                    album=metadata.album or (album.title if album else None),
                    album_artist=metadata.album_artist,
                    track_number=song.track_number,
                    disc_number=song.disc_number,
                    year=metadata.year or (album.year if album else None),
                    genre=metadata.genre,
                    isrc=metadata.isrc,
                ),
            )

        logger.info(f"Applied metadata to song {song.id}")

    def _get_or_create_artist(self, name: str) -> Artist:
        artist = self.session.scalars(select(Artist).where(Artist.name == name)).first()
        if artist:
            return artist
        artist = Artist(name=name)
        self.session.add(artist)
        self.session.flush()
        return artist

    def _get_or_create_album(self, title: str, artist_id: int | None) -> Album:
        album = self.session.scalars(
            select(Album).where(Album.title == title, Album.artist_id == artist_id)
        ).first()
        if album:
            return album
        album = Album(title=title, artist_id=artist_id)
        self.session.add(album)
        self.session.flush()
        return album
    
    async def _fetch_artwork(self, album: Album, release_id: str) -> None:
        """
        Fetch artwork from provider and store URL.
        
        In a full implementation, this would:
        1. Download the image
        2. Store it in the artwork cache
        3. Update the album.artwork_path
        
        For now, we store the URL directly.
        """
        for provider in self.providers:
            try:
                artwork_url = await provider.get_artwork(release_id)
                if artwork_url:
                    album.artwork_url = artwork_url
                    if SettingsService(self.session).get_bool("download_artwork", True):
                        cached_path = await self.artwork_cache.download_and_cache(artwork_url)
                        album.artwork_path = self.artwork_cache.public_path(cached_path) if cached_path else None
                    logger.info(f"Set artwork URL for album {album.id}")
                    break
            except Exception as exc:
                logger.error(f"Failed to fetch artwork: {exc}")
    
    async def close(self) -> None:
        """Close all provider connections."""
        for provider in self.providers:
            if hasattr(provider, 'close'):
                await provider.close()
