import asyncio

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.models import AlbumDownloadItem, Base, DownloadJob, History, LibraryAlbum, LibraryTrack, Song
from app.schemas.library import OnlineAlbumPreview, OnlineAlbumTrackPreview
from app.services.library_albums import LibraryAlbumService


class FakeLibraryAlbumService(LibraryAlbumService):
    def __init__(self, session, previews: dict[str, OnlineAlbumPreview]) -> None:
        super().__init__(session)
        self.previews = previews

    async def preview_online_album(self, external_id: str) -> OnlineAlbumPreview:
        return self.previews[external_id]


def test_save_online_albums_allows_same_provider_track_in_multiple_albums() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)

    shared_track = {
        "external_id": "shared-video-id",
        "title": "Shared Song",
        "artist_name": "Artist",
        "artist_external_id": "artist-id",
        "duration_seconds": 180,
        "track_number": 1,
        "disc_number": 1,
        "position": 0,
        "source_url": "https://music.youtube.com/watch?v=shared-video-id",
    }
    previews = {
        "album-a": OnlineAlbumPreview(
            external_id="album-a",
            title="Album A",
            artist_name="Artist",
            artist_external_id="artist-id",
            tracks=[OnlineAlbumTrackPreview(album_title="Album A", **shared_track)],
        ),
        "album-b": OnlineAlbumPreview(
            external_id="album-b",
            title="Album B",
            artist_name="Artist",
            artist_external_id="artist-id",
            tracks=[OnlineAlbumTrackPreview(album_title="Album B", **shared_track)],
        ),
    }

    with Session() as session:
        service = FakeLibraryAlbumService(session, previews)

        album_a = asyncio.run(service.save_online_album("album-a"))
        album_b = asyncio.run(service.save_online_album("album-b"))

        tracks = session.scalars(select(LibraryTrack).where(LibraryTrack.external_id == "shared-video-id")).all()

    assert album_a.track_count == 1
    assert album_b.track_count == 1
    assert len(tracks) == 2
    assert {track.album_title for track in tracks} == {"Album A", "Album B"}


def test_remove_album_hides_it_without_deleting_download_state() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)

    preview = OnlineAlbumPreview(
        external_id="album-a",
        title="Album A",
        artist_name="Artist",
        tracks=[
            OnlineAlbumTrackPreview(
                external_id="track-a",
                title="Song A",
                artist_name="Artist",
                album_title="Album A",
                position=0,
                source_url="https://music.youtube.com/watch?v=track-a",
            )
        ],
    )

    with Session() as session:
        service = FakeLibraryAlbumService(session, {"album-a": preview})
        album = asyncio.run(service.save_online_album("album-a"))
        track = session.get(LibraryTrack, album.tracks[0].id)
        assert track
        track.is_downloaded = True
        track.file_path = "Artist/Album A/Song A.mp3"
        session.commit()

        service.remove_album(album.id, delete_downloads=False)
        albums = service.list_albums()
        refreshed_track = session.get(LibraryTrack, track.id)

    assert albums == []
    assert refreshed_track is not None
    assert refreshed_track.is_downloaded is True
    assert refreshed_track.file_path == "Artist/Album A/Song A.mp3"


def test_save_online_album_reactivates_removed_album() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)

    preview = OnlineAlbumPreview(
        external_id="album-a",
        title="Album A",
        artist_name="Artist",
        tracks=[
            OnlineAlbumTrackPreview(
                external_id="track-a",
                title="Song A",
                artist_name="Artist",
                album_title="Album A",
                position=0,
            )
        ],
    )

    with Session() as session:
        service = FakeLibraryAlbumService(session, {"album-a": preview})
        album = asyncio.run(service.save_online_album("album-a"))
        service.remove_album(album.id, delete_downloads=False)

        reactivated = asyncio.run(service.save_online_album("album-a"))

    assert reactivated.id == album.id
    assert reactivated.is_in_library is True
    assert reactivated.track_count == 1


def test_remove_track_download_releases_linked_song_and_deletes_file(music_directory) -> None:
    audio_file = music_directory / "Artist" / "song.mp3"
    audio_file.parent.mkdir(parents=True)
    audio_file.write_bytes(b"audio")
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)

    with Session() as session:
        song = Song(title="Song", source_url="https://example/track", file_path="Artist/song.mp3", is_downloaded=True)
        session.add(song)
        session.flush()
        track = LibraryTrack(
            external_id="track",
            title="Song",
            position=0,
            source_url=song.source_url,
            song_id=song.id,
            file_path=song.file_path,
            is_downloaded=True,
        )
        session.add(track)
        session.commit()

        result = LibraryAlbumService(session).remove_track_download(track.id)
        session.refresh(song)

    assert result.file_deleted is True
    assert result.track.is_downloaded is False
    assert audio_file.exists() is False
    assert song.file_path is None
    assert song.is_downloaded is False


def test_remove_track_download_keeps_file_still_used_by_another_track(music_directory) -> None:
    audio_file = music_directory / "shared.mp3"
    audio_file.write_bytes(b"audio")
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)

    with Session() as session:
        song = Song(title="Song", file_path="shared.mp3", is_downloaded=True)
        session.add(song)
        session.flush()
        tracks = [
            LibraryTrack(
                external_id=f"track-{index}",
                title="Song",
                position=index,
                song_id=song.id,
                file_path="shared.mp3",
                is_downloaded=True,
            )
            for index in range(2)
        ]
        session.add_all(tracks)
        session.commit()

        result = LibraryAlbumService(session).remove_track_download(tracks[0].id)
        session.refresh(song)

    assert result.file_deleted is False
    assert audio_file.exists() is True
    assert song.file_path == "shared.mp3"
    assert song.is_downloaded is True


def test_library_track_duration_falls_back_to_linked_downloaded_song() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)

    with Session() as session:
        song = Song(title="Song", duration_seconds=247, is_downloaded=True, file_path="song.mp3")
        session.add(song)
        session.flush()
        track = LibraryTrack(
            external_id="duration-track",
            title="Song",
            position=0,
            song_id=song.id,
            duration_seconds=None,
            is_downloaded=True,
            file_path="song.mp3",
        )
        session.add(track)
        session.commit()

        response = LibraryAlbumService(session)._track_to_response(track)

    assert response.duration_seconds == 247


def test_saved_album_repairs_missing_track_and_history_durations() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    preview = OnlineAlbumPreview(
        external_id="album-duration",
        title="Album",
        tracks=[
            OnlineAlbumTrackPreview(
                external_id="track-duration",
                title="Track",
                duration_seconds=214,
                position=0,
            )
        ],
    )

    with Session() as session:
        service = FakeLibraryAlbumService(session, {"album-duration": preview})
        saved = asyncio.run(service.save_online_album("album-duration"))
        track = session.get(LibraryTrack, saved.tracks[0].id)
        assert track is not None
        track.duration_seconds = None
        history = History(source="youtube", external_id="track-duration", title="Track", duration_seconds=None)
        session.add(history)
        session.commit()

        refreshed = asyncio.run(service.get_unified_album("album-duration"))
        session.refresh(history)

    assert refreshed.tracks[0].duration_seconds == 214
    assert history.duration_seconds == 214


def test_concurrent_album_download_request_reuses_active_job() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    preview = OnlineAlbumPreview(
        external_id="album-download",
        title="Album",
        artist_name="Artist",
        tracks=[
            OnlineAlbumTrackPreview(
                external_id="track-download",
                title="Track",
                artist_name="Artist",
                album_title="Album",
                position=0,
                source_url="https://music.youtube.com/watch?v=track-download",
            )
        ],
    )

    with Session() as session:
        service = FakeLibraryAlbumService(session, {"album-download": preview})
        album = asyncio.run(service.save_online_album("album-download"))

        first = service.create_album_download(album.id)
        second = service.create_album_download(album.id)

        downloads = session.scalars(select(DownloadJob)).all()
        items = session.scalars(select(AlbumDownloadItem)).all()

    assert second.id == first.id
    assert len(downloads) == 1
    assert len(items) == 1


def test_cancel_album_download_cancels_children_and_removes_partial_files(music_directory) -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    preview = OnlineAlbumPreview(
        external_id="cancel-album",
        title="Cancel Album",
        artist_name="Artist",
        tracks=[
            OnlineAlbumTrackPreview(
                external_id="cancel-track",
                title="Track",
                artist_name="Artist",
                album_title="Cancel Album",
                position=0,
                source_url="https://music.youtube.com/watch?v=cancel-track",
            )
        ],
    )

    with Session() as session:
        service = FakeLibraryAlbumService(session, {"cancel-album": preview})
        album = asyncio.run(service.save_online_album("cancel-album"))
        service.create_album_download(album.id)
        track = session.get(LibraryTrack, album.tracks[0].id)
        audio_file = music_directory / "Artist" / "partial.mp3"
        audio_file.parent.mkdir(parents=True)
        audio_file.write_bytes(b"audio")
        track.file_path = "Artist/partial.mp3"
        track.is_downloaded = True
        session.commit()

        cancelled = service.cancel_album_download(album.id)
        child = session.scalars(select(DownloadJob).where(DownloadJob.search_query == "album:cancel-album")).one()

    assert cancelled.status == "cancelled"
    assert child.status == "cancelled"
    assert track.is_downloaded is False
    assert track.file_path is None
    assert audio_file.exists() is False


def test_unified_online_album_keeps_public_id_across_library_and_favorite_states() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    preview = OnlineAlbumPreview(
        external_id="MPRE-unified",
        title="Unified Album",
        artist_name="Artist",
        tracks=[
            OnlineAlbumTrackPreview(
                external_id="video-unified",
                title="Track",
                artist_name="Artist",
                album_title="Unified Album",
                position=0,
                source_url="https://music.youtube.com/watch?v=video-unified",
            )
        ],
    )

    with Session() as session:
        service = FakeLibraryAlbumService(session, {"MPRE-unified": preview})
        online = asyncio.run(service.get_unified_album("MPRE-unified"))
        saved = asyncio.run(service.add_unified_album_to_library("MPRE-unified"))
        favorited = asyncio.run(service.set_unified_album_favorite("MPRE-unified", True))

    assert online.id == saved.id == favorited.id == "MPRE-unified"
    assert online.canonical_url == saved.canonical_url == "/albums/MPRE-unified"
    assert online.state.in_library is False
    assert saved.state.in_library is True
    assert favorited.state.is_favorited is True


def test_deleting_unified_album_download_keeps_library_membership(music_directory) -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    preview = OnlineAlbumPreview(
        external_id="downloaded-unified",
        title="Album",
        tracks=[OnlineAlbumTrackPreview(external_id="track", title="Track", position=0)],
    )

    with Session() as session:
        service = FakeLibraryAlbumService(session, {"downloaded-unified": preview})
        saved = asyncio.run(service.save_online_album("downloaded-unified"))
        track = session.get(LibraryTrack, saved.tracks[0].id)
        audio_file = music_directory / "downloaded.mp3"
        audio_file.write_bytes(b"audio")
        track.file_path = "downloaded.mp3"
        track.is_downloaded = True
        session.commit()

        response = asyncio.run(service.remove_unified_album_download("downloaded-unified"))

    assert response.state.in_library is True
    assert response.state.download == "none"
    assert audio_file.exists() is False


def test_track_status_detects_standalone_downloaded_youtube_song(music_directory) -> None:
    audio_file = music_directory / "downloaded.mp3"
    audio_file.write_bytes(b"audio")
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)

    with Session() as session:
        session.add(
            Song(
                title="Downloaded",
                source_url="https://music.youtube.com/watch?v=downloaded-video",
                file_path="downloaded.mp3",
                is_downloaded=True,
            )
        )
        session.commit()
        statuses = LibraryAlbumService(session).track_statuses(["downloaded-video", "online-video"])

    assert statuses.statuses[0].is_downloaded is True
    assert statuses.statuses[1].is_downloaded is False


def test_album_read_reports_missing_media_without_mutating_database(music_directory) -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)

    with Session() as session:
        album = LibraryAlbum(
            public_id="missing-media",
            source="youtube",
            external_id="missing-media",
            title="Missing Media",
            is_in_library=True,
        )
        track = LibraryTrack(
            album=album,
            source="youtube",
            external_id="missing-track",
            title="Missing Track",
            position=0,
            file_path="missing.mp3",
            is_downloaded=True,
            is_in_library=True,
        )
        session.add_all([album, track])
        session.commit()

        response = LibraryAlbumService(session).get_album(album.id)
        session.refresh(track)

    assert response.download_state == "none"
    assert response.tracks[0].is_downloaded is False
    assert track.is_downloaded is True
    assert track.file_path == "missing.mp3"


def test_downloaded_unified_track_stream_url_matches_a_real_media_route(music_directory) -> None:
    from starlette.routing import Match

    from app.main import app

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    preview = OnlineAlbumPreview(
        external_id="stream-url-album",
        title="Album",
        tracks=[OnlineAlbumTrackPreview(external_id="track", title="Track", position=0)],
    )

    with Session() as session:
        service = FakeLibraryAlbumService(session, {"stream-url-album": preview})
        saved = asyncio.run(service.save_online_album("stream-url-album"))
        track = session.get(LibraryTrack, saved.tracks[0].id)
        (music_directory / "downloaded.mp3").write_bytes(b"audio")
        track.file_path = "downloaded.mp3"
        track.is_downloaded = True
        session.commit()

        response = asyncio.run(service.get_unified_album("stream-url-album"))

    stream_url = response.tracks[0].stream_url
    assert stream_url == f"/api/v1/media/library-tracks/{track.id}/stream"
    scope = {"type": "http", "path": stream_url, "method": "GET", "root_path": ""}
    assert any(route.matches(scope)[0] == Match.FULL for route in app.router.routes)


def test_importing_the_same_playlist_twice_creates_distinct_playlists(monkeypatch) -> None:
    import app.services.library_albums as library_albums_module
    from app.models import Playlist

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    preview = OnlineAlbumPreview(
        external_id="VLPLimport",
        title="Road Trip",
        tracks=[
            OnlineAlbumTrackPreview(
                external_id="video-1",
                title="Song",
                position=0,
                source_url="https://music.youtube.com/watch?v=video-1",
            )
        ],
    )

    async def fake_album(_browse_id: str) -> OnlineAlbumPreview:
        return preview

    monkeypatch.setattr(library_albums_module.ytmusic_service, "album", fake_album)
    url = "https://music.youtube.com/playlist?list=PLimport"
    with Session() as session:
        service = LibraryAlbumService(session)
        first = asyncio.run(service.import_playlist_url(url=url))
        second = asyncio.run(service.import_playlist_url(url=url))

        names = [session.get(Playlist, result["playlist_id"]).name for result in (first, second)]

    assert names == ["Road Trip", "Road Trip (2)"]
