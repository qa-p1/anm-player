import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.core.exceptions import ResourceNotFoundError
from app.database.session import engine
from app.models import Base
from app.repositories.music import AlbumRepository, ArtistRepository, FavoriteRepository, HistoryRepository, PlaylistRepository, SongRepository
from app.schemas.music import FavoriteToggleRequest
from app.services.catalog import CatalogService


def test_application_sqlite_engine_enables_foreign_keys() -> None:
    with engine.connect() as connection:
        enabled = connection.scalar(text("PRAGMA foreign_keys"))

    assert enabled == 1


def test_favorite_target_must_exist() -> None:
    test_engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(test_engine)
    Session = sessionmaker(bind=test_engine, autoflush=False, expire_on_commit=False)

    with Session() as session:
        service = CatalogService(
            SongRepository(session),
            ArtistRepository(session),
            AlbumRepository(session),
            PlaylistRepository(session),
            FavoriteRepository(session),
            HistoryRepository(session),
        )

        with pytest.raises(ResourceNotFoundError):
            service.toggle_favorite(FavoriteToggleRequest(entity_type="song", entity_id=999))
