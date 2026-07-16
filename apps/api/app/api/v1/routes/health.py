from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.deps import get_health_service
from app.schemas.health import AppInfoResponse, HealthResponse, VersionResponse
from app.services import HealthService

router = APIRouter()


@router.get("", response_model=HealthResponse, summary="Health check")
def health_check(service: Annotated[HealthService, Depends(get_health_service)]) -> HealthResponse:
    return service.health()


@router.get("/version", response_model=VersionResponse, summary="Application version")
def version(service: Annotated[HealthService, Depends(get_health_service)]) -> VersionResponse:
    return service.version()


@router.get("/info", response_model=AppInfoResponse, summary="Application and storage information")
def app_info(service: Annotated[HealthService, Depends(get_health_service)]) -> AppInfoResponse:
    return service.info()
