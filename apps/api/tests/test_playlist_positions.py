from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.models import Base, LibraryTrack, Playlist, PlaylistLibraryTrack, Song
from app.models.playlist import PlaylistSong
from app.repositories.music import (
    AlbumRepository,
    ArtistRepository,
    FavoriteRepository,
    HistoryRepository,
    PlaylistRepository,
    SongRepository,
)
from app.schemas.music import PlaylistAddOnlineTrackRequest
from app.services.catalog import CatalogService
from app.services.library_albums import LibraryAlbumService


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)()


def test_local_playlist_second_song_uses_position_one() -> None:
    with make_session() as session:
        playlist = Playlist(name="Local")
        songs = [Song(title="One"), Song(title="Two")]
        session.add_all([playlist, *songs])
        session.flush()
        repository = PlaylistRepository(session)

        repository.add_song(playlist.id, songs[0].id)
        session.flush()
        repository.add_song(playlist.id, songs[1].id)
        session.commit()

        positions = session.scalars(
            select(PlaylistSong.position).order_by(PlaylistSong.position)
        ).all()

    assert positions == [0, 1]


def test_online_playlist_second_track_uses_position_one() -> None:
    with make_session() as session:
        playlist = Playlist(name="Online")
        session.add(playlist)
        session.flush()
        service = CatalogService(
            SongRepository(session),
            ArtistRepository(session),
            AlbumRepository(session),
            PlaylistRepository(session),
            FavoriteRepository(session),
            HistoryRepository(session),
        )

        for index in (1, 2):
            service.add_online_track_to_playlist(
                playlist.id,
                PlaylistAddOnlineTrackRequest(
                    external_id=f"video-{index}",
                    title=f"Track {index}",
                ),
            )

        positions = session.scalars(
            select(PlaylistLibraryTrack.position).order_by(PlaylistLibraryTrack.position)
        ).all()

    assert positions == [0, 1]


def test_saved_library_playlist_second_track_uses_position_one() -> None:
    with make_session() as session:
        playlist = Playlist(name="Saved")
        tracks = [
            LibraryTrack(external_id=f"track-{index}", title=f"Track {index}", position=index)
            for index in (1, 2)
        ]
        session.add_all([playlist, *tracks])
        session.flush()
        service = LibraryAlbumService(session)

        service.add_tracks_to_playlist(playlist.id, [tracks[0].id])
        service.add_tracks_to_playlist(playlist.id, [tracks[1].id])

        positions = session.scalars(
            select(PlaylistLibraryTrack.position).order_by(PlaylistLibraryTrack.position)
        ).all()

    assert positions == [0, 1]
