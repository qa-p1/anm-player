from app.core.config import settings
from app.schemas.health import AppInfoResponse, HealthResponse, StorageInfo, VersionResponse
from app.storage import storage_manager


class HealthService:
    def health(self) -> HealthResponse:
        return HealthResponse(status="ok", service="aura-api")

    def version(self) -> VersionResponse:
        return VersionResponse(
            name=settings.app_name,
            version=settings.app_version,
            environment=settings.api_env,
        )

    def info(self) -> AppInfoResponse:
        return AppInfoResponse(
            name=settings.app_name,
            version=settings.app_version,
            environment=settings.api_env,
            api_prefix=settings.api_prefix,
            database="sqlite" if settings.is_sqlite else "external",
            storage=StorageInfo(data_root=str(storage_manager.paths.root)),
        )
