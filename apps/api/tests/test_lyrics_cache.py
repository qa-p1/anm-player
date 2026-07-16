from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models import Base
from app.services.lyrics_cache import LyricsCacheService


def test_lyrics_cache_hit_requires_db_row_and_file(tmp_path) -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)

    with Session() as session:
        service = LyricsCacheService(session, cache_dir=tmp_path)
        saved = service.save_cached("youtube", "video-id", "[00:01.00]Hello", provider="lrclib")

        cached = service.get("youtube", "video-id")

    assert saved.status == "cached"
    assert cached.lyrics == "[00:01.00]Hello"
    assert cached.format == "lrc"


def test_lyrics_cache_treats_empty_file_as_missing(tmp_path) -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)

    with Session() as session:
        service = LyricsCacheService(session, cache_dir=tmp_path)
        service.save_cached("youtube", "video-id", "Plain lyrics", provider="manual")
        entry = service._entry("youtube", "video-id")
        assert entry and entry.cache_path
        (tmp_path / "empty.txt").write_text("", encoding="utf-8")
        entry.cache_path = str(tmp_path / "empty.txt")
        session.commit()

        cached = service.get("youtube", "video-id")

    assert cached.status == "missing"
    assert cached.lyrics is None


def test_lyrics_cache_negative_result_is_reused(tmp_path) -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)

    with Session() as session:
        service = LyricsCacheService(session, cache_dir=tmp_path)
        service.save_not_found("youtube", "video-id", provider="provider")

        cached = service.get("youtube", "video-id")

    assert cached.status == "not_found"
    assert cached.lyrics is None
