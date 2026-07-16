from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.deps import get_catalog_service
from app.schemas.music import FavoriteToggleRequest, FavoritesResponse
from app.services import CatalogService

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
