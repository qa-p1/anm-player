from typing import Annotated

from fastapi import Depends, Header, HTTPException, Query, status
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
    LibraryService,
    PlaceholderService,
    QueueService,
    SearchService,
    SettingsService,
)
from app.services.recommendations import RecommendationService
from app.services.advanced_search import AdvancedSearchService
from app.services.metadata.service import MetadataEnrichmentService

DbSession = Annotated[Session, Depends(get_session)]
LimitQuery = Annotated[int, Query(ge=1, le=100, description="Maximum number of records to return.")]
OffsetQuery = Annotated[int, Query(ge=0, description="Number of records to skip.")]


def require_operator(
    authorization: Annotated[str | None, Header()] = None,
    access_token: Annotated[str | None, Query(include_in_schema=False)] = None,
) -> None:
    """Require the configured single-operator token for privileged routes."""
    configured_token = settings.api_access_token
    if not configured_token:
        if settings.api_env.casefold() in {"development", "dev", "local", "test"}:
            return
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Privileged API routes require API_ACCESS_TOKEN to be configured",
        )

    supplied_token = access_token
    if authorization and authorization.lower().startswith("bearer "):
        supplied_token = authorization[7:].strip()
    if not supplied_token or not compare_digest(supplied_token, configured_token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing operator token",
            headers={"WWW-Authenticate": "Bearer"},
        )


def get_placeholder_service() -> PlaceholderService:
    return PlaceholderService()


def get_health_service() -> HealthService:
    return HealthService()


def get_settings_service(session: DbSession) -> SettingsService:
    return SettingsService(session)


def get_search_service() -> SearchService:
    return SearchService()


def get_catalog_service(session: DbSession) -> CatalogService:
    return CatalogService(
        songs=SongRepository(session),
        artists=ArtistRepository(session),
        albums=AlbumRepository(session),
        playlists=PlaylistRepository(session),
        favorites=FavoriteRepository(session),
        history=HistoryRepository(session),
    )


def get_library_service(session: DbSession) -> LibraryService:
    return LibraryService(
        songs=SongRepository(session),
        artists=ArtistRepository(session),
        albums=AlbumRepository(session),
        playlists=PlaylistRepository(session),
        downloads=DownloadJobRepository(session),
        queue_items=QueueItemRepository(session),
    )


def get_library_album_service(session: DbSession) -> LibraryAlbumService:
    return LibraryAlbumService(session)


def get_download_service(session: DbSession) -> DownloadService:
    return DownloadService(downloads=DownloadJobRepository(session), queue_items=QueueItemRepository(session))


def get_queue_service(session: DbSession) -> QueueService:
    return QueueService(queue_items=QueueItemRepository(session))


def get_recommendation_service(session: DbSession) -> RecommendationService:
    return RecommendationService(session)


def get_advanced_search_service(session: DbSession) -> AdvancedSearchService:
    return AdvancedSearchService(session)


def get_metadata_service(session: DbSession) -> MetadataEnrichmentService:
    return MetadataEnrichmentService(session)
