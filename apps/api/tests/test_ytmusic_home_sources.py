import asyncio

from app.schemas.ytmusic import OnlineHomeResponse, OnlineHomeSection
from app.services.ytmusic_service.service import (
    WEB,
    AlbumRef,
    HomePage,
    HomeSection,
    InnerTubeSession,
    YTItem,
    YouTubeMusicService,
    _extract_explore_albums,
    _extract_related_browse_id,
    _extract_video_charts_section,
    _normalize_chart_browse_id,
    _parse_chart_tracks,
    _select_chart_playlist,
    _select_related_song_items,
)


def song(video_id: str, title: str | None = None) -> YTItem:
    return YTItem(
        kind="song",
        id=video_id,
        title=title or video_id,
        endpoint={"watchEndpoint": {"videoId": video_id}},
    )


def album(browse_id: str, title: str | None = None) -> YTItem:
    return YTItem(
        kind="album",
        id=browse_id,
        title=title or browse_id,
        album=AlbumRef(name=title or browse_id, id=browse_id),
        endpoint={"browseEndpoint": {"browseId": browse_id}},
    )


def two_row(title: str, browse_id: str) -> dict:
    return {
        "musicTwoRowItemRenderer": {
            "title": {"runs": [{"text": title}]},
            "navigationEndpoint": {"browseEndpoint": {"browseId": browse_id}},
        }
    }


def responsive(video_id: str, title: str) -> dict:
    return {
        "musicResponsiveListItemRenderer": {
            "flexColumns": [
                {"musicResponsiveListItemFlexColumnRenderer": {"text": {"runs": [{"text": title}]}}}
            ],
            "navigationEndpoint": {"watchEndpoint": {"videoId": video_id}},
        }
    }


def shelf(title: str, contents: list[dict], *, carousel: bool = True) -> dict:
    key = "musicCarouselShelfRenderer" if carousel else "musicShelfRenderer"
    return {
        key: {
            "header": {
                "musicCarouselShelfBasicHeaderRenderer": {
                    "title": {"runs": [{"text": title}]}
                }
            },
            "contents": contents,
        }
    }


class RecordingSession(InnerTubeSession):
    def __init__(self) -> None:
        super().__init__()
        self.body = None

    def post(self, path, body, *, client, set_login=False, query=None):
        self.body = body
        return {}


def test_browse_includes_form_data_selected_values() -> None:
    session = RecordingSession()
    session.browse(client=WEB, browse_id="FEmusic_charts", form_data={"selectedValues": ["ZZ"]})
    assert session.body["formData"] == {"selectedValues": ["ZZ"]}


def test_global_chart_selection_prefers_daily_global_over_top_100() -> None:
    raw = shelf(
        "Video charts",
        [
            two_row("Top 100 Music Videos Global", "VLtop"),
            two_row("Daily Top Music Videos Global", "VLdaily"),
        ],
    )
    section = _extract_video_charts_section(raw)
    selected = _select_chart_playlist(section, (("daily top music videos", "global"), ("top 100 music videos", "global")))
    assert selected.title == "Daily Top Music Videos Global"


def test_india_chart_selection_prefers_trending_20_india() -> None:
    section = _extract_video_charts_section(
        shelf(
            "Video charts",
            [
                two_row("Daily Top Music Videos India", "VLdaily"),
                two_row("Trending 20 India", "VLtrending"),
            ],
        )
    )
    selected = _select_chart_playlist(
        section,
        (("trending 20", "india"), ("daily top music videos", "india"), ("top 100 music videos", "india")),
    )
    assert selected.title == "Trending 20 India"


def test_chart_playlist_id_is_not_double_prefixed() -> None:
    assert _normalize_chart_browse_id("VLPL123") == "VLPL123"
    assert _normalize_chart_browse_id("PL123") == "VLPL123"


def test_chart_tracks_preserve_order_and_deduplicate_video_ids() -> None:
    raw = {"contents": [responsive("one", "One"), two_row("An album", "MPREbAlbum"), responsive("two", "Two"), responsive("one", "One again")]}
    assert [item.id for item in _parse_chart_tracks(raw)] == ["one", "two"]


def test_chart_tracks_retain_regional_titles_without_filtering() -> None:
    raw = {"contents": [responsive("hindi", "Hindi Hit"), responsive("punjabi", "Punjabi Hit")]}
    assert [item.id for item in _parse_chart_tracks(raw)] == ["hindi", "punjabi"]


def test_explore_album_parser_keeps_valid_albums_and_deduplicates() -> None:
    raw = shelf(
        "New albums & singles",
        [
            two_row("Album One", "MPREbOne"),
            two_row("Invalid playlist", "VLPlaylist"),
            two_row("Album One duplicate", "MPREbOne"),
            two_row("Album Two", "MPREbTwo"),
        ],
    )
    assert [item.id for item in _extract_explore_albums(raw)] == ["MPREbOne", "MPREbTwo"]


def test_home_assembly_returns_only_approved_ids_in_order() -> None:
    service = YouTubeMusicService()
    provider = HomePage(
        chips=[],
        sections=[HomeSection(title="Quick Picks", label=None, thumbnail=None, endpoint=None, items=[song("quick")])],
    )
    response = service._assemble_home(
        provider,
        ("Daily Top Music Videos Global", "VLglobal", [song("global")]),
        ("Trending 20 India", "VLindia", [song("india")]),
        [album("MPREbAlbum")],
    )
    assert [section.id for section in response.sections] == [
        "today-picks",
        "quick-picks",
        "global-trending",
        "trending-albums",
        "india-pulse",
    ]
    assert response.chips == []


def test_home_assembly_never_calls_generic_search_for_charts() -> None:
    service = YouTubeMusicService()

    def forbidden(*args, **kwargs):
        raise AssertionError("generic search must not be called")

    service.client.search = forbidden
    response = service._assemble_home(None, ("Global", "VLglobal", [song("global")]), None, None)
    assert [section.id for section in response.sections] == ["today-picks", "global-trending"]


def test_today_pick_prefers_provider_quick_picks_and_falls_back_to_global() -> None:
    service = YouTubeMusicService()
    provider = HomePage(
        chips=[],
        sections=[HomeSection(title="Quick Picks", label=None, thumbnail=None, endpoint=None, items=[song("quick")])],
    )
    preferred = service._assemble_home(provider, ("Global", "VLglobal", [song("global")]), None, None)
    fallback = service._assemble_home(None, ("Global", "VLglobal", [song("global")]), None, None)
    assert preferred.sections[0].items[0].id == "quick"
    assert fallback.sections[0].items[0].id == "global"


def test_absent_provider_quick_picks_omits_quick_section() -> None:
    service = YouTubeMusicService()
    provider = HomePage(
        chips=[],
        sections=[HomeSection(title="Listen Again", label=None, thumbnail=None, endpoint=None, items=[song("recent")])],
    )
    response = service._assemble_home(provider, None, None, None)
    assert [section.id for section in response.sections] == ["today-picks"]


def test_related_tab_uses_page_type_when_tab_order_changes() -> None:
    raw = {
        "tabs": [
            {"tabRenderer": {"title": "Up next", "endpoint": {"browseEndpoint": {"browseId": "MPUP"}}}},
            {
                "tabRenderer": {
                    "title": "Suggestions",
                    "endpoint": {
                        "browseEndpoint": {
                            "browseId": "MPTRrelated",
                            "browseEndpointContextSupportedConfigs": {
                                "browseEndpointContextMusicConfig": {"pageType": "MUSIC_PAGE_TYPE_TRACK_RELATED"}
                            },
                        }
                    },
                }
            },
        ]
    }
    assert _extract_related_browse_id(raw) == "MPTRrelated"


def test_related_parser_excludes_seed_and_non_song_shelves() -> None:
    raw = {
        "contents": [
            shelf("Albums", [two_row("Album", "MPREbAlbum")]),
            shelf("You might also like", [responsive("seed", "Seed"), responsive("other", "Other"), responsive("other", "Duplicate")]),
        ]
    }
    assert [item.id for item in _select_related_song_items(raw, seed_video_id="seed")] == ["other"]


def test_related_cache_isolated_by_seed_video_id() -> None:
    service = YouTubeMusicService()
    calls = []

    def related(seed_video_id):
        calls.append(seed_video_id)
        return [song(f"result-{seed_video_id}")]

    service._related_sync = related
    first = asyncio.run(service.related("a"))
    second = asyncio.run(service.related("b"))
    cached = asyncio.run(service.related("a"))
    assert first.items[0].id == cached.items[0].id
    assert second.items[0].id == "result-b"
    assert calls == ["a", "b"]


def test_duration_hydration_populates_quick_pick_rows() -> None:
    service = YouTubeMusicService()
    items = [song("one"), song("two")]

    class FakeSession:
        def web_remix_client(self):
            return WEB

        def player(self, video_id, *, client):
            return {"videoDetails": {"lengthSeconds": "247" if video_id == "one" else "181"}}

    class FakeClient:
        session = FakeSession()

    service._hydrate_missing_durations(FakeClient(), items, limit=8)
    assert [item.duration_seconds for item in items] == [247, 181]


def configure_home_sources(service: YouTubeMusicService) -> None:
    service._provider_home_sync = lambda: None
    service._global_chart_sync = lambda: ("Global", "VLglobal", [song("global")])
    service._india_chart_sync = lambda: ("India", "VLindia", [song("india")])
    service._india_explore_sync = lambda: []


def test_repeated_home_calls_within_ten_minutes_use_cache() -> None:
    service = YouTubeMusicService()
    calls = {"global": 0}
    configure_home_sources(service)

    def global_chart():
        calls["global"] += 1
        return "Global", "VLglobal", [song("global")]

    service._global_chart_sync = global_chart
    asyncio.run(service.home())
    asyncio.run(service.home())
    assert calls["global"] == 1


def test_failed_chart_refresh_returns_previous_complete_response() -> None:
    service = YouTubeMusicService()
    previous = OnlineHomeResponse(
        region="GLOBAL",
        sections=[
            OnlineHomeSection(id="global-trending", title="Global", layout="song_list"),
            OnlineHomeSection(id="india-pulse", title="India", layout="song_list"),
        ],
    )
    service._home_cache = (0, previous)
    service._provider_home_sync = lambda: None
    service._india_chart_sync = lambda: ("India", "VLindia", [song("india")])
    service._india_explore_sync = lambda: []

    def fail_global():
        raise RuntimeError("chart unavailable")

    service._global_chart_sync = fail_global
    assert asyncio.run(service.home()) is previous


def test_cold_start_partial_failure_returns_successful_sections() -> None:
    service = YouTubeMusicService()
    service._provider_home_sync = lambda: (_ for _ in ()).throw(RuntimeError("provider unavailable"))
    service._global_chart_sync = lambda: ("Global", "VLglobal", [song("global")])
    service._india_chart_sync = lambda: (_ for _ in ()).throw(RuntimeError("india unavailable"))
    service._india_explore_sync = lambda: [album("MPREbAlbum")]
    response = asyncio.run(service.home())
    assert [section.id for section in response.sections] == ["today-picks", "global-trending", "trending-albums"]
