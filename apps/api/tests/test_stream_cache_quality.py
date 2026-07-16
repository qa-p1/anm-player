from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.models import Base, StreamCacheEntry
from app.services.stream_cache import StreamCacheService


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
