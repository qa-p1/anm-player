from app.services.ytmusic_service import PlaybackData
from app.services.ytmusic_service.service import YouTubeMusicService


class CountingClient:
    def __init__(self, expires_in_seconds: int = 21_600) -> None:
        self.calls: list[tuple[str, str]] = []
        self.expires_in_seconds = expires_in_seconds

    def playback(self, video_id: str, *, quality: str = "auto") -> PlaybackData:
        self.calls.append((video_id, quality))
        return PlaybackData(
            video_id=video_id,
            title=None,
            author=None,
            stream_url=f"https://example.invalid/{video_id}/{len(self.calls)}",
            expires_in_seconds=self.expires_in_seconds,
            client_name="test",
            format={},
        )


def make_service(client: CountingClient) -> YouTubeMusicService:
    service = YouTubeMusicService()
    service.client = client
    return service


def test_repeated_range_requests_reuse_one_resolution_per_quality() -> None:
    client = CountingClient()
    service = make_service(client)

    first = service.playback("video", quality="high")
    assert service.playback("video", quality="high") is first
    service.playback("video", quality="low")

    assert client.calls == [("video", "high"), ("video", "low")]


def test_urls_close_to_expiry_are_not_cached() -> None:
    client = CountingClient(expires_in_seconds=300)
    service = make_service(client)

    service.playback("video")
    service.playback("video")

    assert len(client.calls) == 2


def test_invalidation_forces_a_fresh_resolution() -> None:
    client = CountingClient()
    service = make_service(client)

    first = service.playback("video")
    service.invalidate_playback("video")
    second = service.playback("video")

    assert first.stream_url != second.stream_url
    assert len(client.calls) == 2


def test_cache_is_bounded() -> None:
    client = CountingClient()
    service = make_service(client)
    service.playback_cache_max_entries = 3

    for index in range(10):
        service.playback(f"video-{index}")

    assert len(service._playback_cache) <= 3
