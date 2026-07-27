from fastapi import APIRouter, Depends

from app.api.deps import require_operator

from app.api.v1.routes import (
    advanced_search,
    albums,
    artists,
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
    settings,
    songs,
    ytmusic,
)

api_v1_router = APIRouter()
protected_router = APIRouter(dependencies=[Depends(require_operator)])
api_v1_router.include_router(health.router, prefix="/health", tags=["health"])
protected_router.include_router(library.router, prefix="/library", tags=["library"])
protected_router.include_router(downloads.router, prefix="/downloads", tags=["downloads"])
protected_router.include_router(settings.router, prefix="/settings", tags=["settings"])
protected_router.include_router(playlists.router, prefix="/playlists", tags=["playlists"])
protected_router.include_router(artists.router, prefix="/artists", tags=["artists"])
protected_router.include_router(albums.router, prefix="/albums", tags=["albums"])
protected_router.include_router(songs.router, prefix="/songs", tags=["songs"])
protected_router.include_router(favorites.router, prefix="/favorites", tags=["favorites"])
protected_router.include_router(history.router, prefix="/history", tags=["history"])
protected_router.include_router(media.router, prefix="/media", tags=["media"])
protected_router.include_router(advanced_search.router, prefix="/advanced-search", tags=["advanced-search"])
protected_router.include_router(metadata.router, prefix="/metadata", tags=["metadata"])
protected_router.include_router(lyrics.router, prefix="/lyrics", tags=["lyrics"])
protected_router.include_router(ytmusic.router, prefix="/ytmusic", tags=["ytmusic"])
api_v1_router.include_router(protected_router)
api_v1_router.include_router(download_events.router, tags=["downloads"])
