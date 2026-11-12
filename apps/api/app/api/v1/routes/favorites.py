from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.deps import get_catalog_service
from app.schemas.music import FavoritesResponse, FavoriteToggleRequest, PlaylistAddOnlineTrackRequest
from app.services.playlists import upsert_online_track
from app.services.catalog import CatalogService

router = APIRouter()


@router.get("", response_model=FavoritesResponse, summary="List favorites across all entity types")
def list_favorites(service: Annotated[CatalogService, Depends(get_catalog_service)]) -> FavoritesResponse:
    return service.list_favorites()


@router.post("/toggle", response_model=dict[str, bool], summary="Toggle favorite")
def toggle_favorite(
    service: Annotated[CatalogService, Depends(get_catalog_service)],
    request: FavoriteToggleRequest,
) -> dict[str, bool]:
    is_favorited = service.toggle_favorite(request)
    return {"is_favorited": is_favorited}


@router.post("/online-track", response_model=dict[str, bool | int], summary="Like or unlike a YouTube Music song")
def toggle_online_track_favorite(
    service: Annotated[CatalogService, Depends(get_catalog_service)],
    request: PlaylistAddOnlineTrackRequest,
) -> dict[str, bool | int]:
    """Liking a song you've only streamed saves it to your library first."""
    track = upsert_online_track(service.session, request)
    service.session.flush()
    is_favorited = service.toggle_favorite(FavoriteToggleRequest(entity_type="library_track", entity_id=track.id))
    return {"is_favorited": is_favorited, "track_id": track.id}
