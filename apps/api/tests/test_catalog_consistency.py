from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from app.models import (
    Album,
    Artist,
    Base,
    Favorite,
    History,
    LibraryAlbum,
    LibraryTrack,
    Playlist,
    PlaylistLibraryTrack,
    PlaylistSong,
    Song,
)
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


def test_album_and_artist_details_exclude_missing_downloaded_files(music_directory) -> None:
    (music_directory / "valid.mp3").write_bytes(b"audio")
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


def test_playlist_marks_only_broken_download_as_streaming_and_merges_positions(music_directory) -> None:
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

        results = HistoryRepository(session).get_most_played_history()

        assert [entry.song.title for entry in results[:2]] == ["Played Twice", "Skipped Often"]


def _statement_count(engine, operation) -> int:
    statements = 0

    def count_statement(*_args) -> None:
        nonlocal statements
        statements += 1

    event.listen(engine, "before_cursor_execute", count_statement)
    try:
        operation()
    finally:
        event.remove(engine, "before_cursor_execute", count_statement)
    return statements


def _song_list_query_count(song_count: int) -> tuple[int, list]:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    with Session() as session:
        artist = Artist(name="Artist")
        album = Album(title="Album", artist=artist)
        session.add_all([artist, album])
        session.flush()
        canonical = LibraryAlbum(
            public_id="album-public",
            local_album_id=album.id,
            source="youtube",
            external_id="album-online",
            title="Album",
        )
        songs = [
            Song(
                title=f"Song {index}",
                artist=artist,
                album=album,
                file_path=f"song-{index}.mp3",
                is_downloaded=True,
            )
            for index in range(song_count)
        ]
        session.add_all([canonical, *songs])
        session.flush()
        session.add_all(Favorite(song_id=song.id) for song in songs)
        session.commit()
        service = make_service(session)
        responses = []
        count = _statement_count(engine, lambda: responses.extend(service.list_songs(limit=50)))
    engine.dispose()
    return count, responses


def test_song_response_adapters_bulk_load_favorites_and_public_ids() -> None:
    one_count, one = _song_list_query_count(1)
    many_count, many = _song_list_query_count(12)

    assert many_count == one_count
    assert all(song.is_favorited for song in many)
    assert all(song.album_public_id == "album-public" for song in many)


def _playlist_list_query_count(playlist_count: int) -> tuple[int, list]:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    with Session() as session:
        for index in range(playlist_count):
            playlist = Playlist(name=f"Playlist {index}")
            song = Song(title=f"Song {index}", duration_seconds=60)
            track = LibraryTrack(
                source="youtube",
                external_id=f"track-{index}",
                title=f"Online {index}",
                duration_seconds=90,
                position=0,
            )
            session.add_all([playlist, song, track])
            session.flush()
            session.add_all(
                [
                    PlaylistSong(playlist_id=playlist.id, song_id=song.id, position=0),
                    PlaylistLibraryTrack(playlist_id=playlist.id, track_id=track.id, position=1),
                ]
            )
        session.commit()
        service = make_service(session)
        responses = []
        count = _statement_count(engine, lambda: responses.extend(service.list_playlists(limit=50)))
    engine.dispose()
    return count, responses


def test_playlist_listing_bulk_loads_online_tracks() -> None:
    one_count, _ = _playlist_list_query_count(1)
    many_count, many = _playlist_list_query_count(12)

    assert many_count == one_count
    assert all(playlist.song_count == 2 for playlist in many)
    assert all(playlist.duration_seconds == 150 for playlist in many)


def _favorites_query_count(entity_count: int) -> tuple[int, object]:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    with Session() as session:
        for index in range(entity_count):
            artist = Artist(name=f"Artist {index}")
            album = Album(title=f"Album {index}", artist=artist)
            song = Song(title=f"Song {index}", artist=artist, album=album)
            playlist = Playlist(name=f"Playlist {index}")
            library_album = LibraryAlbum(
                public_id=f"album-{index}",
                local_album_id=None,
                source="youtube",
                external_id=f"online-album-{index}",
                title=f"Online Album {index}",
            )
            library_track = LibraryTrack(
                album=library_album,
                source="youtube",
                external_id=f"online-track-{index}",
                title=f"Online Track {index}",
                position=0,
            )
            session.add_all([artist, album, song, playlist, library_album, library_track])
            session.flush()
            library_album.local_album_id = album.id
            session.add_all(
                [
                    PlaylistSong(playlist_id=playlist.id, song_id=song.id, position=0),
                    PlaylistLibraryTrack(playlist_id=playlist.id, track_id=library_track.id, position=1),
                    Favorite(song_id=song.id),
                    Favorite(artist_id=artist.id),
                    Favorite(album_id=album.id),
                    Favorite(playlist_id=playlist.id),
                    Favorite(library_album_id=library_album.id),
                    Favorite(library_track_id=library_track.id),
                ]
            )
        session.commit()
        service = make_service(session)
        result = None

        def list_favorites() -> None:
            nonlocal result
            result = service.list_favorites()

        count = _statement_count(engine, list_favorites)
    engine.dispose()
    return count, result


def test_combined_favorites_query_count_does_not_scale_with_results() -> None:
    one_count, _ = _favorites_query_count(1)
    many_count, many = _favorites_query_count(8)

    assert many_count == one_count
    assert len(many.songs) == 8
    assert len(many.artists) == 8
    assert len(many.albums) == 8
    assert len(many.playlists) == 8
    assert len(many.library_albums) == 8
    assert len(many.library_tracks) == 8
