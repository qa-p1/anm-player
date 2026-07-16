from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.models import Album, Artist, Base, History, LibraryTrack, Playlist, Song
from app.repositories.music import AlbumRepository, ArtistRepository, FavoriteRepository, HistoryRepository, PlaylistRepository, SongRepository
from app.services.catalog import CatalogService
from app.services.library_albums import LibraryAlbumService


def make_service(session) -> CatalogService:
    return CatalogService(
        SongRepository(session), ArtistRepository(session), AlbumRepository(session),
        PlaylistRepository(session), FavoriteRepository(session), HistoryRepository(session),
    )


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)()


def test_album_and_artist_details_exclude_missing_downloaded_files(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "music_directory", tmp_path)
    (tmp_path / "valid.mp3").write_bytes(b"audio")
    with make_session() as session:
        artist = Artist(name="Artist")
        session.add(artist)
        session.flush()
        album = Album(title="Album", artist_id=artist.id)
        session.add(album)
        session.flush()
        session.add_all([
            Song(title="Valid", artist_id=artist.id, album_id=album.id, file_path="valid.mp3", is_downloaded=True),
            Song(title="Missing", artist_id=artist.id, album_id=album.id, file_path="missing.mp3", is_downloaded=True),
        ])
        session.commit()
        service = make_service(session)

        album_response = service.get_album(album.id)
        artist_response = service.get_artist(artist.id)

    assert [song.title for song in album_response.songs] == ["Valid"]
    assert [song.title for song in artist_response.top_songs] == ["Valid"]


def test_playlist_marks_only_broken_download_as_streaming_and_merges_positions(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "music_directory", tmp_path)
    with make_session() as session:
        playlist = Playlist(name="Mixed")
        song = Song(title="Broken", source_url="https://music.youtube.com/watch?v=broken", file_path="missing.mp3", is_downloaded=True)
        track = LibraryTrack(external_id="online", title="Online", position=0)
        session.add_all([playlist, song, track])
        session.flush()
        PlaylistRepository(session).add_song(playlist.id, song.id)
        session.flush()
        LibraryAlbumService(session).add_tracks_to_playlist(playlist.id, [track.id])

        response = make_service(session).get_playlist(playlist.id)

    assert response.song_count == 2
    assert [item.position for item in response.items] == [0, 1]
    assert response.items[0].song is not None
    assert response.items[0].song.is_downloaded is False
    assert "file_path" not in response.items[0].song.model_dump()


def test_most_played_local_songs_counts_only_play_events() -> None:
    with make_session() as session:
        inflated = Song(title="Skipped Often")
        actually_played = Song(title="Played Twice")
        session.add_all([inflated, actually_played])
        session.flush()
        session.add(History(song_id=inflated.id, event_type="played"))
        session.add_all([History(song_id=inflated.id, event_type="skipped") for _ in range(5)])
        session.add_all([History(song_id=actually_played.id, event_type="played") for _ in range(2)])
        session.commit()

        results = HistoryRepository(session).get_most_played_songs()

    assert [song.title for song in results[:2]] == ["Played Twice", "Skipped Often"]
