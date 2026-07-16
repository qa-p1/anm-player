from typing import Annotated

from fastapi import APIRouter, Depends, status

from app.api.deps import LimitQuery, OffsetQuery, get_catalog_service
from app.schemas.music import HistoryCreateRequest, HistoryResponse
from app.services import CatalogService

router = APIRouter()


@router.post("", response_model=HistoryResponse, status_code=status.HTTP_201_CREATED, summary="Add history entry")
def add_history(
    service: Annotated[CatalogService, Depends(get_catalog_service)],
    request: HistoryCreateRequest,
) -> HistoryResponse:
    return service.add_history(request)


@router.get("", response_model=list[HistoryResponse], summary="List history")
def list_history(
    service: Annotated[CatalogService, Depends(get_catalog_service)],
    limit: LimitQuery = 50,
    offset: OffsetQuery = 0,
) -> list[HistoryResponse]:
    return service.list_history(limit=limit, offset=offset)


@router.get("/recently-played", response_model=list[HistoryResponse], summary="List mixed recently played items")
def recently_played_history(
    service: Annotated[CatalogService, Depends(get_catalog_service)],
    limit: LimitQuery = 50,
) -> list[HistoryResponse]:
    return service.get_recent_history(limit=limit)


@router.get("/most-played", response_model=list[HistoryResponse], summary="List mixed most played items")
def most_played_history(
    service: Annotated[CatalogService, Depends(get_catalog_service)],
    limit: LimitQuery = 50,
) -> list[HistoryResponse]:
    return service.get_most_played_history(limit=limit)
