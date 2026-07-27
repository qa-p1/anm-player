from typing import Annotated

from fastapi import Depends, Header, HTTPException, Path, Query, Request, WebSocket, status
from secrets import compare_digest
from sqlalchemy.orm import Session

from app.database.session import get_session
from app.core.config import settings
from app.repositories.music import (
    AlbumRepository,
    ArtistRepository,
    DownloadJobRepository,
    FavoriteRepository,
    HistoryRepository,
    PlaylistRepository,
    QueueItemRepository,
    SongRepository,
)
from app.services import (
    CatalogService,
    DownloadService,
    HealthService,
    LibraryAlbumService,
    SettingsService,
)
from app.services.advanced_search import AdvancedSearchService
from app.services.metadata.service import MetadataEnrichmentService

DbSession = Annotated[Session, Depends(get_session)]
LimitQuery = Annotated[int, Query(ge=1, le=100, description="Maximum number of records to return.")]
OffsetQuery = Annotated[int, Query(ge=0, description="Number of records to skip.")]
ResourceId = Annotated[
    int,
    Path(ge=1, le=2_147_483_647, description="Positive database resource identifier."),
]
ProviderId = Annotated[
    str,
    Path(min_length=1, max_length=255, pattern=r"^[A-Za-z0-9_-]+$"),
]


def require_operator(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    """Require the configured single-operator token for privileged routes."""
    _verify_operator(authorization=authorization, client_host=request.client.host if request.client else None)


def require_websocket_operator(websocket: WebSocket) -> None:
    """Authenticate a WebSocket before accepting its handshake."""
    client_host = websocket.client.host if websocket.client else None
    _verify_operator(authorization=websocket.headers.get("authorization"), client_host=client_host)


def _verify_operator(*, authorization: str | None, client_host: str | None) -> None:
    configured_token = settings.api_access_token
    if not configured_token:
        if settings.api_env == "test":
            return
        if settings.api_env == "development" and _is_loopback(client_host):
            return
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Privileged API routes require API_ACCESS_TOKEN to be configured",
        )

    supplied_token = None
    if authorization and authorization.lower().startswith("bearer "):
        supplied_token = authorization[7:].strip()
    if not supplied_token or not compare_digest(supplied_token, configured_token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing operator token",
            headers={"WWW-Authenticate": "Bearer"},
        )


def _is_loopback(host: str | None) -> bool:
    return host in {"127.0.0.1", "::1", "localhost"}


def get_health_service() -> HealthService:
    return HealthService()


def get_settings_service(session: DbSession) -> SettingsService:
    return SettingsService(session)


def get_catalog_service(session: DbSession) -> CatalogService:
    return CatalogService(
        songs=SongRepository(session),
        artists=ArtistRepository(session),
        albums=AlbumRepository(session),
        playlists=PlaylistRepository(session),
        favorites=FavoriteRepository(session),
        history=HistoryRepository(session),
    )


def get_library_album_service(session: DbSession) -> LibraryAlbumService:
    return LibraryAlbumService(session)


def get_download_service(session: DbSession) -> DownloadService:
    return DownloadService(downloads=DownloadJobRepository(session), queue_items=QueueItemRepository(session))


def get_advanced_search_service(session: DbSession) -> AdvancedSearchService:
    return AdvancedSearchService(session)


def get_metadata_service(session: DbSession) -> MetadataEnrichmentService:
    return MetadataEnrichmentService(session)
