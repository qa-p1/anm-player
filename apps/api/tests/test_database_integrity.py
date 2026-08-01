import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app.core.exceptions import ResourceNotFoundError
from app.database.session import engine
from app.models import Base, Favorite, Playlist, PlaylistSong, Song
from app.repositories.music import AlbumRepository, ArtistRepository, FavoriteRepository, HistoryRepository, PlaylistRepository, SongRepository
from app.schemas.music import FavoriteToggleRequest, PlaylistAddSongsRequest, PlaylistCreateRequest
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


def _catalog(session) -> CatalogService:
    return CatalogService(
        SongRepository(session),
        ArtistRepository(session),
        AlbumRepository(session),
        PlaylistRepository(session),
        FavoriteRepository(session),
        HistoryRepository(session),
    )


def test_favorite_has_exactly_one_unique_target() -> None:
    test_engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(test_engine)
    Session = sessionmaker(bind=test_engine, autoflush=False, expire_on_commit=False)
    with Session() as session:
        song = Song(title="Song")
        session.add(song)
        session.flush()
        session.add(Favorite())
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        session.add_all([Favorite(song_id=song.id), Favorite(song_id=song.id)])
        with pytest.raises(IntegrityError):
            session.commit()


def test_duplicate_playlist_name_is_stable_conflict() -> None:
    test_engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(test_engine)
    Session = sessionmaker(bind=test_engine, autoflush=False, expire_on_commit=False)
    with Session() as session:
        service = _catalog(session)
        service.create_playlist(PlaylistCreateRequest(name="Road trip"))
        from app.core.exceptions import ConflictError
        with pytest.raises(ConflictError):
            service.create_playlist(PlaylistCreateRequest(name="Road trip"))


def test_playlist_addition_prevalidates_entire_request() -> None:
    test_engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(test_engine)
    Session = sessionmaker(bind=test_engine, autoflush=False, expire_on_commit=False)
    with Session() as session:
        playlist = Playlist(name="Road trip")
        song = Song(title="Song")
        session.add_all([playlist, song])
        session.commit()

        with pytest.raises(ResourceNotFoundError):
            _catalog(session).add_songs_to_playlist(
                playlist.id,
                PlaylistAddSongsRequest(song_ids=[song.id, 999, song.id]),
            )

        assert session.query(PlaylistSong).count() == 0
