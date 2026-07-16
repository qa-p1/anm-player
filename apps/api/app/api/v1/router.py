from fastapi import APIRouter

from app.api.v1.routes import (
    advanced_search,
    albums,
    artists,
    discovery,
    download_events,
    downloads,
    favorites,
    health,
    history,
    library,
    lyrics,
    media,
    metadata,
    playlists,
    queue,
    recommendations,
    search,
    settings,
    songs,
    ytmusic,
)

api_v1_router = APIRouter()
api_v1_router.include_router(health.router, prefix="/health", tags=["health"])
api_v1_router.include_router(search.router, prefix="/search", tags=["search"])
api_v1_router.include_router(library.router, prefix="/library", tags=["library"])
api_v1_router.include_router(downloads.router, prefix="/downloads", tags=["downloads"])
api_v1_router.include_router(download_events.router, tags=["downloads"])
api_v1_router.include_router(settings.router, prefix="/settings", tags=["settings"])
api_v1_router.include_router(playlists.router, prefix="/playlists", tags=["playlists"])
api_v1_router.include_router(artists.router, prefix="/artists", tags=["artists"])
api_v1_router.include_router(albums.router, prefix="/albums", tags=["albums"])
api_v1_router.include_router(songs.router, prefix="/songs", tags=["songs"])
api_v1_router.include_router(queue.router, prefix="/queue", tags=["queue"])
api_v1_router.include_router(favorites.router, prefix="/favorites", tags=["favorites"])
api_v1_router.include_router(history.router, prefix="/history", tags=["history"])
api_v1_router.include_router(media.router, prefix="/media", tags=["media"])
api_v1_router.include_router(recommendations.router, prefix="/recommendations", tags=["recommendations"])
api_v1_router.include_router(advanced_search.router, prefix="/advanced-search", tags=["advanced-search"])
api_v1_router.include_router(metadata.router, prefix="/metadata", tags=["metadata"])
api_v1_router.include_router(lyrics.router, prefix="/lyrics", tags=["lyrics"])
api_v1_router.include_router(discovery.router, prefix="/discovery", tags=["discovery"])
api_v1_router.include_router(ytmusic.router, prefix="/ytmusic", tags=["ytmusic"])
