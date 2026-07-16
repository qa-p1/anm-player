from app.schemas.music import SearchResult
from app.services.search_ranking import SearchRankingService


def test_ranking_prefers_official_music_results() -> None:
    ranking = SearchRankingService()
    unofficial = SearchResult(
        video_id="1",
        title="Example Song fan upload",
        artist="Someone",
        channel="Random Channel",
        duration=240,
        url="https://example.com/1",
    )
    official = SearchResult(
        video_id="2",
        title="Example Song Official Music Video",
        artist="Example Artist",
        channel="Example Artist VEVO",
        duration=240,
        view_count=5_000_000,
        url="https://example.com/2",
    )

    results = ranking.rank([unofficial, official], "example song")

    assert results[0].video_id == "2"
