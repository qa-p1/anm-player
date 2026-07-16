import asyncio

from app.services.ytmusic_service.service import InnertubeSearchResult, YouTubeMusicService


class FakeSearchClient:
    def __init__(self) -> None:
        self.calls = 0

    async def search_async(self, query, *, params=None, continuation=None):
        self.calls += 1
        return InnertubeSearchResult(items=[], continuation="next")


def test_search_results_are_cached_by_query_filter_and_continuation() -> None:
    service = YouTubeMusicService()
    fake_client = FakeSearchClient()
    service.client = fake_client

    first = asyncio.run(service.search("Example", filter_name="songs"))
    second = asyncio.run(service.search(" example ", filter_name="songs"))
    continuation = asyncio.run(service.search("Example", filter_name="songs", continuation="next"))

    assert first == second
    assert continuation.continuation == "next"
    assert fake_client.calls == 2
