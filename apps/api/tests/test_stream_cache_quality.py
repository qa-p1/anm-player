from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.models import Base, StreamCacheEntry
from app.services.stream_cache import StreamCacheService
from app.core.config import settings
from app.services.ytmusic_service import PlaybackData


def test_stream_cache_separates_quality_records_and_files(tmp_path) -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    with Session() as session:
        low = StreamCacheService(session, tmp_path, quality="low")
        high = StreamCacheService(session, tmp_path, quality="high")
        low_path = tmp_path / "low.webm"
        high_path = tmp_path / "high.webm"
        low_path.write_bytes(b"low")
        high_path.write_bytes(b"high")
        low._upsert_entry("video", low_path, "audio/webm", 3, None)
        high._upsert_entry("video", high_path, "audio/webm", 4, None)

        entries = list(session.scalars(select(StreamCacheEntry).order_by(StreamCacheEntry.quality)))

    assert [(entry.quality, entry.relative_path) for entry in entries] == [
        ("high", str(high_path.resolve())),
        ("low", str(low_path.resolve())),
    ]


class _OversizedResponse:
    headers = {"Content-Length": "5"}

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def read(self, _size):
        return b"12345"


class _OversizedOpener:
    def open(self, *_args, **_kwargs):
        return _OversizedResponse()


def test_stream_cache_rejects_oversized_response_and_cleans_partial(tmp_path, monkeypatch) -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    monkeypatch.setattr(settings, "stream_max_file_mb", 0)
    monkeypatch.setattr("app.services.stream_cache.build_opener", lambda: _OversizedOpener())
    playback = PlaybackData(
        video_id="video",
        title="Song",
        author="Artist",
        stream_url="https://example.com/audio",
        expires_in_seconds=60,
        client_name="test",
        format={"mimeType": "audio/webm"},
    )

    with Session() as session:
        service = StreamCacheService(session, tmp_path, quality="high")
        try:
            service._download_to_cache("video", playback)
        except ValueError:
            pass
        else:
            raise AssertionError("oversized stream was accepted")

    assert not list(tmp_path.glob("*.part"))
    assert not list(tmp_path.glob("*.webm"))
