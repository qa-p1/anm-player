import asyncio
from io import BytesIO

import pytest

import app.database.session as database_session
import app.services.artwork_cache as artwork_module
from app.services.artwork_cache import ArtworkCacheService, Image


@pytest.mark.skipif(Image is None, reason="Pillow is optional")
def test_each_artwork_size_is_generated_from_the_original(tmp_path) -> None:
    source = tmp_path / "source.jpg"
    Image.new("RGB", (1200, 1200), "red").save(source)
    service = ArtworkCacheService(tmp_path / "cache")

    asyncio.run(service._create_sizes(source, "https://i.ytimg.com/image.jpg"))

    with Image.open(service.get_cache_path("https://i.ytimg.com/image.jpg", "thumb")) as thumb:
        assert thumb.width == 150
    with Image.open(service.get_cache_path("https://i.ytimg.com/image.jpg", "large")) as large:
        assert large.width == 1000


def _image_bytes(size=(64, 64)) -> bytes:
    output = BytesIO()
    Image.new("RGB", size, "red").save(output, "PNG")
    return output.getvalue()


def test_cache_filename_is_sha256_and_cached_value_must_be_a_file(tmp_path) -> None:
    service = ArtworkCacheService(tmp_path / "cache")
    path = service.get_cache_path("https://i.ytimg.com/image.jpg")

    assert len(path.stem) == 64
    assert set(path.stem) <= set("0123456789abcdef")
    path.mkdir()
    assert service.get_cached_artwork("https://i.ytimg.com/image.jpg") is None


def test_invalid_image_is_never_published(tmp_path, monkeypatch) -> None:
    service = ArtworkCacheService(tmp_path / "cache")

    async def invalid_download(_url: str) -> bytes:
        return b"not-an-image"

    monkeypatch.setattr(service, "_download", invalid_download)
    result = asyncio.run(service.download_and_cache("https://i.ytimg.com/image.jpg"))

    assert result is None
    assert list((tmp_path / "cache").rglob("*.jpg")) == []
    assert list((tmp_path / "cache").rglob("*.tmp")) == []


def test_concurrent_requests_publish_one_artwork(tmp_path, monkeypatch) -> None:
    service = ArtworkCacheService(tmp_path / "cache")
    calls = 0

    async def download(_url: str) -> bytes:
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.01)
        return _image_bytes()

    async def exercise():
        return await asyncio.gather(*[
            service.download_and_cache("https://i.ytimg.com/image.jpg")
            for _ in range(4)
        ])

    monkeypatch.setattr(service, "_download", download)
    results = asyncio.run(exercise())

    assert calls == 1
    assert all(path == results[0] for path in results)
    assert results[0] is not None and results[0].is_file()


def test_artwork_url_allowlist_cached_shortcut_and_public_path(tmp_path) -> None:
    service = ArtworkCacheService(tmp_path / "cache")
    assert service.max_download_bytes > 0
    assert service.is_allowed_remote_url("https://i.ytimg.com/image.jpg") is True
    assert service.is_allowed_remote_url("https://sub.googleusercontent.com/image") is True
    assert service.is_allowed_remote_url("http://i.ytimg.com/image.jpg") is False
    assert service.is_allowed_remote_url("https://user:pass@i.ytimg.com/image.jpg") is False
    assert service.is_allowed_remote_url("https://i.ytimg.com:444/image.jpg") is False
    assert service.is_allowed_remote_url("https://example.com/image.jpg") is False

    cached = service.get_cache_path("https://i.ytimg.com/image.jpg")
    cached.write_bytes(b"cached")
    assert asyncio.run(service.download_and_cache("https://i.ytimg.com/image.jpg")) == cached
    assert asyncio.run(service.download_and_cache("https://example.com/image.jpg")) is None
    assert service.public_path(cached).startswith("/api/v1/media/artwork/cache/")


class FakeStreamResponse:
    def __init__(
        self,
        *,
        status_code=200,
        content_type="image/png",
        content_length="4",
        chunks=None,
        location=None,
    ) -> None:
        self.status_code = status_code
        self.headers = {"content-type": content_type, "content-length": content_length}
        if location is not None:
            self.headers["location"] = location
        self.chunks = chunks or [b"test"]

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False

    def raise_for_status(self) -> None:
        return None

    async def aiter_bytes(self):
        for chunk in self.chunks:
            yield chunk


class FakeAsyncClient:
    response = FakeStreamResponse()
    responses = None

    def __init__(self, **_kwargs) -> None:
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False

    def stream(self, method, url):
        assert method == "GET" and url.startswith("https://")
        if self.responses:
            return self.responses.pop(0)
        return self.response


def test_bounded_artwork_download_validates_headers_and_body(tmp_path, monkeypatch) -> None:
    service = ArtworkCacheService(tmp_path / "cache")
    monkeypatch.setattr(artwork_module.httpx, "AsyncClient", FakeAsyncClient)

    FakeAsyncClient.response = FakeStreamResponse()
    assert asyncio.run(service._download("https://i.ytimg.com/image.jpg")) == b"test"

    FakeAsyncClient.response = FakeStreamResponse(content_type="text/html")
    assert asyncio.run(service._download("https://i.ytimg.com/image.jpg")) is None

    FakeAsyncClient.response = FakeStreamResponse(content_length="not-a-number")
    assert asyncio.run(service._download("https://i.ytimg.com/image.jpg")) is None


def test_artwork_redirects_remain_allowlisted_and_size_bounded(tmp_path, monkeypatch) -> None:
    service = ArtworkCacheService(tmp_path / "cache")
    monkeypatch.setattr(artwork_module.httpx, "AsyncClient", FakeAsyncClient)
    monkeypatch.setattr(artwork_module.settings, "artwork_max_response_mb", 1)

    FakeAsyncClient.responses = [
        FakeStreamResponse(status_code=302, location="https://images.googleusercontent.com/final.jpg"),
        FakeStreamResponse(chunks=[b"safe"]),
    ]
    assert asyncio.run(service._download("https://i.ytimg.com/image.jpg")) == b"safe"

    FakeAsyncClient.responses = [FakeStreamResponse(status_code=302, location="https://example.com/private")]
    assert asyncio.run(service._download("https://i.ytimg.com/image.jpg")) is None

    FakeAsyncClient.responses = [FakeStreamResponse(status_code=302, location=None)]
    assert asyncio.run(service._download("https://i.ytimg.com/image.jpg")) is None

    FakeAsyncClient.responses = [FakeStreamResponse(content_length=str(1024 * 1024 + 1))]
    assert asyncio.run(service._download("https://i.ytimg.com/image.jpg")) is None

    FakeAsyncClient.responses = [FakeStreamResponse(content_length="", chunks=[b"x" * (1024 * 1024), b"x"])]
    assert asyncio.run(service._download("https://i.ytimg.com/image.jpg")) is None
    FakeAsyncClient.responses = None


def test_artwork_eviction_removes_oldest_file(tmp_path, monkeypatch) -> None:
    service = ArtworkCacheService(tmp_path / "cache")
    service.MAX_CACHE_FILES = 1
    oldest = service.cache_dir / "original" / "old.jpg"
    newest = service.cache_dir / "original" / "new.jpg"
    oldest.write_bytes(b"old")
    newest.write_bytes(b"new")
    oldest.touch()
    newest.touch()
    monkeypatch.setattr(
        database_session,
        "SessionLocal",
        lambda: (_ for _ in ()).throw(RuntimeError("no database")),
    )

    service._evict_cache()

    assert sum(path.is_file() for path in service.cache_dir.rglob("*.jpg")) == 1
