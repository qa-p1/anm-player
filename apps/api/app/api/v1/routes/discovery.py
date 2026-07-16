"""
Discovery routes for global music exploration.

Provides trending music, new releases, and genre-based discovery
using YouTube Music as the data source.
"""

from fastapi import APIRouter, Depends, HTTPException

from app.services.discovery_service import DiscoveryService

router = APIRouter()


def get_discovery_service() -> DiscoveryService:
    """Dependency to get discovery service instance."""
    return DiscoveryService()


@router.get("/trending")
async def get_trending(
    limit: int = 20,
    service: DiscoveryService = Depends(get_discovery_service),
) -> dict:
    """
    Get trending albums (recently released, popular content).
    
    Returns albums from the last 6 months.
    """
    try:
        items = await service.get_trending(limit=limit)
        return {
            "section": "trending",
            "title": "Trending Now",
            "items": items,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch trending: {exc}")


@router.get("/new-releases")
async def get_new_releases(
    limit: int = 20,
    service: DiscoveryService = Depends(get_discovery_service),
) -> dict:
    """
    Get newly released albums (last 30 days).
    """
    try:
        items = await service.get_new_releases(limit=limit)
        return {
            "section": "new-releases",
            "title": "New Releases",
            "items": items,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch new releases: {exc}")


@router.get("/featured")
async def get_featured(
    limit: int = 10,
    service: DiscoveryService = Depends(get_discovery_service),
) -> dict:
    """
    Get featured/editorial picks (high-profile recent releases).
    """
    try:
        items = await service.get_featured_albums(limit=limit)
        return {
            "section": "featured",
            "title": "Featured Albums",
            "items": items,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch featured: {exc}")


@router.get("/genres")
async def get_genres(
    service: DiscoveryService = Depends(get_discovery_service),
) -> dict:
    """
    Get list of available genres for browsing.
    """
    try:
        genres = await service.get_genres()
        return {
            "genres": genres,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch genres: {exc}")


@router.get("/genres/{genre}")
async def get_genre_albums(
    genre: str,
    limit: int = 20,
    service: DiscoveryService = Depends(get_discovery_service),
) -> dict:
    """
    Get popular albums by genre.
    """
    try:
        items = await service.get_popular_by_genre(genre, limit=limit)
        return {
            "section": "genre",
            "genre": genre,
            "title": f"{genre.title()} Music",
            "items": items,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch genre albums: {exc}")


@router.get("/home")
async def get_home_discovery(
    service: DiscoveryService = Depends(get_discovery_service),
) -> dict:
    """
    Get all discovery content for home page in one request.
    
    Returns:
    - Featured albums (hero section)
    - Trending albums
    - New releases
    - Popular genres
    """
    try:
        import asyncio
        
        # Fetch all data in parallel
        featured_task = service.get_featured_albums(limit=6)
        trending_task = service.get_trending(limit=12)
        new_releases_task = service.get_new_releases(limit=12)
        genres_task = service.get_genres()
        
        featured, trending, new_releases, genres = await asyncio.gather(
            featured_task,
            trending_task,
            new_releases_task,
            genres_task,
        )
        
        return {
            "featured": {
                "title": "Featured Albums",
                "items": featured,
            },
            "trending": {
                "title": "Trending Now",
                "items": trending,
            },
            "new_releases": {
                "title": "New Releases",
                "items": new_releases,
            },
            "genres": genres[:6],  # Top 6 genres for quick access
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch home discovery: {exc}")
