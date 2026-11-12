import asyncio

from app.services.ytmusic_service import YouTubeMusicService
from app.services.ytmusic_service.models import InnertubeSearchResult


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
    continuation = asyncio.run(
        service.search("Example", filter_name="songs", continuation="next")
    )

    assert first == second
    assert continuation.continuation == "next"
    assert fake_client.calls == 2


def test_full_search_cache_drops_only_the_oldest_entry() -> None:
    service = YouTubeMusicService()
    fake_client = FakeSearchClient()
    service.client = fake_client
    for index in range(257):
        asyncio.run(service.search(f"query {index}", filter_name="songs"))
    assert len(service._search_cache) == 256
    asyncio.run(service.search("query 256", filter_name="songs"))
    asyncio.run(service.search("query 0", filter_name="songs"))
    assert fake_client.calls == 258


def test_search_does_not_wait_behind_slow_page_loads() -> None:
    from app.api.v1.routes import ytmusic

    async def scenario() -> float:
        loop = asyncio.get_running_loop()
        never = loop.create_future()
        blockers = [asyncio.create_task(ytmusic._limited_upstream(never)) for _ in range(8)]
        await asyncio.sleep(0)
        started = loop.time()
        await ytmusic._limited_upstream(asyncio.sleep(0, result="done"), ytmusic._search_limit)
        elapsed = loop.time() - started
        for blocker in blockers:
            blocker.cancel()
        await asyncio.gather(*blockers, return_exceptions=True)
        return elapsed

    assert asyncio.run(scenario()) < 0.5
