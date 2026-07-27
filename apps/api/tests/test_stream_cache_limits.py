from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import app.services.stream_cache as stream_module
from app.core.config import settings
from app.models import Base, StreamCacheEntry
from app.services.stream_cache import StreamCacheService
from app.services.ytmusic_service import PlaybackData


def make_session_factory():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class ChunkedResponse:
    headers = {"Content-Length": "10"}

    def __init__(self) -> None:
        self.chunks = [b"hello", b"world", b""]

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, _size: int) -> bytes:
        return self.chunks.pop(0)


class RecordingOpener:
    def __init__(self) -> None:
        self.requests = []

    def open(self, request, *, timeout: int):
        assert timeout == 60
        self.requests.append(request)
        return ChunkedResponse()


def playback(mime_type: str = "audio/mp4; codecs=mp4a.40.2") -> PlaybackData:
    return PlaybackData(
        video_id="video-id",
        title="Song",
        author="Artist",
        stream_url="https://example.com/audio",
        expires_in_seconds=60,
        client_name="test",
        format={"mimeType": mime_type},
        request_headers={"X-Test": "header"},
    )


def test_stream_download_cache_hit_touch_and_content_type(tmp_path, monkeypatch) -> None:
    Session = make_session_factory()
    opener = RecordingOpener()
    monkeypatch.setattr(stream_module, "build_opener", lambda: opener)
    monkeypatch.setattr(settings, "stream_max_file_mb", 1)
    monkeypatch.setattr(settings, "stream_cache_budget_mb", 1)

    with Session() as session:
        service = StreamCacheService(session, tmp_path, quality="high")
        first_path, first_type = service.cache_youtube_stream("video-id", playback())
        first_access = service._entry("video-id").last_accessed_at
        second_path, second_type = service.cache_youtube_stream("video-id", playback())
        cached = service.get_cached_youtube_stream("video-id")

        assert first_path == second_path
        assert first_path.read_bytes() == b"helloworld"
        assert first_type == second_type == "audio/mp4"
        assert cached == (first_path, "audio/mp4")
        assert service._entry("video-id").last_accessed_at >= first_access
        assert len(opener.requests) == 1
        assert opener.requests[0].headers["X-test"] == "header"
        assert StreamCacheService.content_type_for_playback(playback("audio/webm")) == "audio/webm"


def test_clear_expired_removes_files_rows_and_honors_limit(tmp_path) -> None:
    Session = make_session_factory()
    now = datetime.now(UTC).replace(tzinfo=None)
    with Session() as session:
        service = StreamCacheService(session, tmp_path, quality="high")
        for index in range(2):
            path = tmp_path / f"expired-{index}.webm"
            path.write_bytes(b"old")
            session.add(
                StreamCacheEntry(
                    source="youtube",
                    external_id=f"expired-{index}",
                    relative_path=str(path.resolve()),
                    quality="high",
                    content_type="audio/webm",
                    size_bytes=3,
                    expires_at=now - timedelta(days=1),
                    last_accessed_at=now - timedelta(days=2),
                )
            )
        session.commit()

        assert service.clear_expired(limit=1) == 1
        assert session.query(StreamCacheEntry).count() == 1
        assert service.clear_expired() == 1
        assert session.query(StreamCacheEntry).count() == 0
        assert not list(tmp_path.glob("expired-*.webm"))


def test_budget_evicts_oldest_unprotected_entry(tmp_path, monkeypatch) -> None:
    Session = make_session_factory()
    now = datetime.now(UTC).replace(tzinfo=None)
    monkeypatch.setattr(settings, "stream_cache_budget_mb", 0)
    with Session() as session:
        service = StreamCacheService(session, tmp_path, quality="high")
        for index, external_id in enumerate(("old", "protected")):
            path = tmp_path / f"{external_id}.webm"
            path.write_bytes(b"data")
            session.add(
                StreamCacheEntry(
                    source="youtube",
                    external_id=external_id,
                    relative_path=str(path.resolve()),
                    quality="high",
                    content_type="audio/webm",
                    size_bytes=4,
                    expires_at=now + timedelta(days=1),
                    last_accessed_at=now + timedelta(seconds=index),
                )
            )
        session.commit()

        service._enforce_budget(protected_video_id="protected")

        assert session.query(StreamCacheEntry).filter_by(external_id="old").first() is None
        assert not (tmp_path / "old.webm").exists()
        assert (tmp_path / "protected.webm").is_file()


def test_external_cache_path_must_remain_contained(tmp_path) -> None:
    Session = make_session_factory()
    with Session() as session:
        service = StreamCacheService(session, tmp_path / "cache", quality="high")
        with pytest.raises(ValueError):
            service._resolve_cache_path(str(tmp_path / "outside.webm"))
