import asyncio
import threading
from collections import Counter
from types import SimpleNamespace

import pytest

from app.schemas.library import OnlineAlbumPreview, OnlineAlbumTrackPreview
from app.services.ytmusic_service import YouTubeMusicService
from app.services.ytmusic_service import service as service_module


def preview(browse_id: str) -> OnlineAlbumPreview:
    return OnlineAlbumPreview(
        external_id=browse_id,
        title="Album",
        tracks=[OnlineAlbumTrackPreview(external_id="video", title="Song", position=0)],
    )


def service_with_loader():
    instance = YouTubeMusicService()
    calls = Counter()

    def load(browse_id):
        calls[browse_id] += 1
        return preview(browse_id)

    instance._album_sync = load
    return instance, calls


def test_album_preview_coalesces_requests_and_returns_independent_copies():
    instance, calls = service_with_loader()

    async def fetch():
        return await asyncio.gather(instance.album("album"), instance.album("album"))

    first, second = asyncio.run(fetch())
    assert calls["album"] == 1
    first.tracks[0].title = "Changed"
    assert second.tracks[0].title == "Song"
    assert asyncio.run(instance.album("album")).tracks[0].title == "Song"
    assert calls["album"] == 1


def test_album_preview_expiry_and_bounded_eviction_refetch_provider(monkeypatch):
    instance, calls = service_with_loader()
    clock = [10.0]
    monkeypatch.setattr(
        service_module, "time", SimpleNamespace(monotonic=lambda: clock[0])
    )
    instance.album_cache_ttl_seconds = 5
    instance.album_cache_max_entries = 2
    asyncio.run(instance.album("one"))
    clock[0] = 16.0
    asyncio.run(instance.album("one"))
    assert calls["one"] == 2
    asyncio.run(instance.album("two"))
    asyncio.run(instance.album("three"))
    asyncio.run(instance.album("one"))
    assert calls["one"] == 3


def test_album_preview_failures_are_not_cached():
    instance, calls = service_with_loader()
    original_load = instance._album_sync
    attempts = []

    def fail_once(browse_id):
        attempts.append(browse_id)
        if len(attempts) == 1:
            raise RuntimeError("Provider unavailable")
        return original_load(browse_id)

    instance._album_sync = fail_once
    with pytest.raises(RuntimeError, match="Provider unavailable"):
        asyncio.run(instance.album("album"))
    assert asyncio.run(instance.album("album")).title == "Album"
    assert attempts == ["album", "album"] and calls["album"] == 1


def test_cancelled_album_caller_cannot_cancel_another_waiter():
    instance = YouTubeMusicService()
    started = threading.Event()
    release = threading.Event()
    calls = []

    def load(browse_id):
        calls.append(browse_id)
        started.set()
        assert release.wait(timeout=5)
        return preview(browse_id)

    instance._album_sync = load

    async def fetch():
        first = asyncio.create_task(instance.album("album"))
        second = asyncio.create_task(instance.album("album"))
        try:
            assert await asyncio.to_thread(started.wait, 5)
            first.cancel()
            with pytest.raises(asyncio.CancelledError):
                await first
        finally:
            release.set()
        return await second

    assert asyncio.run(fetch()).title == "Album"
    assert calls == ["album"]


def test_cancelled_album_listener_does_not_log_a_later_provider_failure():
    instance = YouTubeMusicService()

    async def fetch():
        release = asyncio.Event()
        errors = []
        asyncio.get_running_loop().set_exception_handler(
            lambda _loop, context: errors.append(context)
        )

        async def failing_loader(_browse_id):
            await release.wait()
            raise RuntimeError("Provider unavailable")

        instance._load_album_preview = failing_loader
        first = asyncio.create_task(instance.album("album"))
        second = asyncio.create_task(instance.album("album"))
        await asyncio.sleep(0)
        first.cancel()
        with pytest.raises(asyncio.CancelledError):
            await first
        release.set()
        with pytest.raises(RuntimeError, match="Provider unavailable"):
            await second
        await asyncio.sleep(0)
        assert not errors

    asyncio.run(fetch())
