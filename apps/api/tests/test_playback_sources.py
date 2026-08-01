from datetime import UTC, datetime, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.v1.routes.ytmusic import stream
from app.models import Base, LibraryTrack, Song, StreamCacheEntry
from app.services.playback_sources import PlaybackSourceService
from app.services.stream_cache import StreamCacheService
from app.services.ytmusic_service import PlaybackData, ytmusic_service


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)()


def playback(video_id: str) -> PlaybackData:
    return PlaybackData(
        video_id=video_id,
        title="Track",
        author="Artist",
        stream_url="https://example.com/audio",
        expires_in_seconds=3600,
        client_name="test",
        format={"mimeType": "audio/webm"},
    )


def playback_service(session, music_root) -> PlaybackSourceService:
    return PlaybackSourceService(session, resolve_music_path=lambda value: music_root / str(value))


def test_downloaded_file_wins_over_cache_and_innertube(tmp_path, monkeypatch) -> None:
    audio_file = tmp_path / "Artist" / "track.mp3"
    audio_file.parent.mkdir(parents=True)
    audio_file.write_bytes(b"downloaded")

    with make_session() as session:
        session.add(
            LibraryTrack(
                source="youtube",
                external_id="video-id",
                title="Track",
                position=0,
                is_downloaded=True,
                relative_path="Artist/track.mp3",
            )
        )
        session.commit()
        monkeypatch.setattr(StreamCacheService, "get_cached_youtube_stream", lambda *args: (_ for _ in ()).throw(AssertionError("cache queried")))
        monkeypatch.setattr(ytmusic_service, "playback", lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("InnerTube queried")))

        resolved = playback_service(session, tmp_path).resolve_youtube("video-id")

    assert resolved.kind == "downloaded"
    assert resolved.path == audio_file


def test_cache_wins_over_innertube_when_download_is_absent(tmp_path, monkeypatch) -> None:
    cache_file = tmp_path / "cached.webm"
    cache_file.write_bytes(b"cached")
    monkeypatch.setattr(StreamCacheService, "get_cached_youtube_stream", lambda *args: (cache_file, "audio/webm"))
    monkeypatch.setattr(ytmusic_service, "playback", lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("InnerTube queried")))

    with make_session() as session:
        resolved = PlaybackSourceService(session).resolve_youtube("video-id")

    assert resolved.kind == "cache"
    assert resolved.path == cache_file


def test_legacy_downloaded_song_is_resolved_by_youtube_video_id(tmp_path, monkeypatch) -> None:
    audio_file = tmp_path / "Radiohead" / "OK Computer" / "track.mp3"
    audio_file.parent.mkdir(parents=True)
    audio_file.write_bytes(b"downloaded")

    with make_session() as session:
        session.add(
            Song(
                title="Track",
                source_url="https://music.youtube.com/watch?v=ok-computer-video",
                is_downloaded=True,
                relative_path="Radiohead/OK Computer/track.mp3",
            )
        )
        session.commit()
        monkeypatch.setattr(StreamCacheService, "get_cached_youtube_stream", lambda *args: (_ for _ in ()).throw(AssertionError("cache queried")))
        resolved = playback_service(session, tmp_path).resolve_youtube("ok-computer-video")

    assert resolved.kind == "downloaded"
    assert resolved.path == audio_file


def test_youtube_stream_route_serves_downloaded_file_before_proxying(tmp_path, monkeypatch) -> None:
    audio_file = tmp_path / "Artist" / "track.mp3"
    audio_file.parent.mkdir(parents=True)
    audio_file.write_bytes(b"downloaded")

    with make_session() as session:
        session.add(
            LibraryTrack(
                source="youtube",
                external_id="video-id",
                title="Track",
                position=0,
                is_downloaded=True,
                relative_path="Artist/track.mp3",
            )
        )
        session.commit()
        original_resolve = PlaybackSourceService.resolve_youtube
        monkeypatch.setattr(
            PlaybackSourceService,
            "resolve_youtube",
            lambda _self, value: original_resolve(playback_service(session, tmp_path), value),
        )
        response = stream("video-id", session, None)

    assert response.path == str(audio_file)
    assert response.headers["x-anm-player-playback-source"] == "downloaded"


def test_innertube_is_used_only_after_download_and_cache_miss(monkeypatch) -> None:
    calls = []
    monkeypatch.setattr(StreamCacheService, "get_cached_youtube_stream", lambda *args: None)
    monkeypatch.setattr(StreamCacheService, "start_background_cache", lambda *args, **kwargs: calls.append("cache"))
    monkeypatch.setattr(ytmusic_service, "playback", lambda video_id, quality: calls.append((video_id, quality)) or playback(video_id))

    with make_session() as session:
        resolved = PlaybackSourceService(session).resolve_youtube("video-id")

    assert resolved.kind == "streaming"
    assert resolved.playback.video_id == "video-id"
    assert calls == [("video-id", "high"), "cache"]


def test_missing_download_is_invalidated_before_falling_back(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(StreamCacheService, "get_cached_youtube_stream", lambda *args: None)
    monkeypatch.setattr(StreamCacheService, "start_background_cache", lambda *args, **kwargs: None)
    monkeypatch.setattr(ytmusic_service, "playback", lambda video_id, quality: playback(video_id))

    with make_session() as session:
        track = LibraryTrack(
            source="youtube",
            external_id="video-id",
            title="Track",
            position=0,
            is_downloaded=True,
            relative_path="missing.mp3",
        )
        session.add(track)
        session.commit()
        resolved = playback_service(session, tmp_path).resolve_youtube("video-id")
        session.refresh(track)

        assert resolved.kind == "streaming"
        assert track.is_downloaded is False
        assert track.relative_path is None


def test_real_cache_entry_is_selected_after_download_miss(tmp_path, monkeypatch) -> None:
    cache_file = tmp_path / "cached.webm"
    cache_file.write_bytes(b"cached")

    with make_session() as session:
        session.add(
            StreamCacheEntry(
                source="youtube",
                external_id="video-id",
                relative_path=str(cache_file),
                quality="high",
                content_type="audio/webm",
                expires_at=datetime.now(UTC).replace(tzinfo=None) + timedelta(hours=1),
            )
        )
        session.commit()
        # Managed stream-cache paths use the storage root, so this test patches
        # only the cache lookup's file validation boundary.
        monkeypatch.setattr(StreamCacheService, "_cached_file", lambda self, entry: (cache_file, "audio/webm") if entry else None)
        resolved = PlaybackSourceService(session).resolve_youtube("video-id")

    assert resolved.kind == "cache"
