import asyncio
from types import SimpleNamespace

import app.services.ytmusic_service.service as service_module

from app.schemas.ytmusic import OnlineHomeResponse, OnlineHomeSection
from app.services.ytmusic_service import YouTubeMusicService
from app.services.ytmusic_service.models import AlbumRef, HomePage, HomeSection, YTItem
from app.services.ytmusic_service.parsing import (
    extract_explore_albums,
    extract_related_browse_id,
    extract_video_charts_section,
    normalize_chart_browse_id,
    parse_chart_tracks,
    select_chart_playlist,
    select_related_song_items,
)
from app.services.ytmusic_service.presentation import assemble_home
from app.services.ytmusic_service.transport import WEB, InnerTubeSession


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
                {
                    "musicResponsiveListItemFlexColumnRenderer": {
                        "text": {"runs": [{"text": title}]}
                    }
                }
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
    session.browse(
        client=WEB, browse_id="FEmusic_charts", form_data={"selectedValues": ["ZZ"]}
    )
    assert session.body["formData"] == {"selectedValues": ["ZZ"]}


def test_global_chart_selection_prefers_daily_global_over_top_100() -> None:
    raw = shelf(
        "Video charts",
        [
            two_row("Top 100 Music Videos Global", "VLtop"),
            two_row("Daily Top Music Videos Global", "VLdaily"),
        ],
    )
    section = extract_video_charts_section(raw)
    selected = select_chart_playlist(
        section,
        (("daily top music videos", "global"), ("top 100 music videos", "global")),
    )
    assert selected.title == "Daily Top Music Videos Global"


def test_india_chart_selection_prefers_trending_20_india() -> None:
    section = extract_video_charts_section(
        shelf(
            "Video charts",
            [
                two_row("Daily Top Music Videos India", "VLdaily"),
                two_row("Trending 20 India", "VLtrending"),
            ],
        )
    )
    selected = select_chart_playlist(
        section,
        (
            ("trending 20", "india"),
            ("daily top music videos", "india"),
            ("top 100 music videos", "india"),
        ),
    )
    assert selected.title == "Trending 20 India"


def test_chart_playlist_id_is_not_double_prefixed() -> None:
    assert normalize_chart_browse_id("VLPL123") == "VLPL123"
    assert normalize_chart_browse_id("PL123") == "VLPL123"


def test_chart_tracks_preserve_order_and_deduplicate_video_ids() -> None:
    raw = {
        "contents": [
            responsive("one", "One"),
            two_row("An album", "MPREbAlbum"),
            responsive("two", "Two"),
            responsive("one", "One again"),
        ]
    }
    assert [item.id for item in parse_chart_tracks(raw)] == ["one", "two"]


def test_chart_tracks_retain_regional_titles_without_filtering() -> None:
    raw = {
        "contents": [
            responsive("hindi", "Hindi Hit"),
            responsive("punjabi", "Punjabi Hit"),
        ]
    }
    assert [item.id for item in parse_chart_tracks(raw)] == ["hindi", "punjabi"]


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
    assert [item.id for item in extract_explore_albums(raw)] == ["MPREbOne", "MPREbTwo"]


def test_home_assembly_returns_only_approved_ids_in_order() -> None:
    provider = HomePage(
        chips=[],
        sections=[
            HomeSection(
                title="Quick Picks",
                label=None,
                thumbnail=None,
                endpoint=None,
                items=[song("quick")],
            )
        ],
    )
    response = assemble_home(
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
        "region-top",
    ]
    assert response.chips == []


def test_home_assembly_uses_the_supplied_chart_without_provider_home() -> None:
    response = assemble_home(None, ("Global", "VLglobal", [song("global")]), None, None)
    assert [section.id for section in response.sections] == [
        "today-picks",
        "global-trending",
    ]
    assert response.sections[1].items[0].id == "global"


def test_today_pick_never_repeats_quick_picks() -> None:
    def provider(count: int) -> HomePage:
        shelf = HomeSection(title="Quick Picks", label=None, thumbnail=None, endpoint=None, items=[song(f"quick{index}") for index in range(count)])
        return HomePage(chips=[], sections=[shelf])

    chart = ("Global", "VLglobal", [song("quick0"), song("global")])
    long_shelf = assemble_home(provider(20), chart, None, None)
    short_shelf = assemble_home(provider(3), chart, None, None)
    no_provider = assemble_home(None, chart, None, None)

    hero, quick = long_shelf.sections[0], long_shelf.sections[1]
    assert [item.id for item in hero.items] == [f"quick{index}" for index in range(5)]
    assert quick.items[0].id == "quick5"
    assert {item.id for item in hero.items}.isdisjoint(item.id for item in quick.items)
    assert [item.id for item in short_shelf.sections[0].items] == ["global"]
    assert no_provider.sections[0].items[0].id == "quick0"


def test_absent_provider_quick_picks_omits_quick_section() -> None:
    provider = HomePage(
        chips=[],
        sections=[
            HomeSection(
                title="Listen Again",
                label=None,
                thumbnail=None,
                endpoint=None,
                items=[song("recent")],
            )
        ],
    )
    response = assemble_home(provider, None, None, None)
    assert [section.id for section in response.sections] == ["today-picks"]


def test_related_tab_uses_page_type_when_tab_order_changes() -> None:
    raw = {
        "tabs": [
            {
                "tabRenderer": {
                    "title": "Up next",
                    "endpoint": {"browseEndpoint": {"browseId": "MPUP"}},
                }
            },
            {
                "tabRenderer": {
                    "title": "Suggestions",
                    "endpoint": {
                        "browseEndpoint": {
                            "browseId": "MPTRrelated",
                            "browseEndpointContextSupportedConfigs": {
                                "browseEndpointContextMusicConfig": {
                                    "pageType": "MUSIC_PAGE_TYPE_TRACK_RELATED"
                                }
                            },
                        }
                    },
                }
            },
        ]
    }
    assert extract_related_browse_id(raw) == "MPTRrelated"


def test_related_parser_excludes_seed_and_non_song_shelves() -> None:
    raw = {
        "contents": [
            shelf("Albums", [two_row("Album", "MPREbAlbum")]),
            shelf(
                "You might also like",
                [
                    responsive("seed", "Seed"),
                    responsive("other", "Other"),
                    responsive("other", "Duplicate"),
                ],
            ),
        ]
    }
    assert [
        item.id for item in select_related_song_items(raw, seed_video_id="seed")
    ] == ["other"]


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
            return {
                "videoDetails": {"lengthSeconds": "247" if video_id == "one" else "181"}
            }

    class FakeClient:
        session = FakeSession()

    service._hydrate_missing_durations(FakeClient(), items, limit=8)
    assert [item.duration_seconds for item in items] == [247, 181]


def configure_home_sources(service: YouTubeMusicService) -> None:
    service._provider_home_sync = lambda: None
    service._global_chart_sync = lambda: ("Global", "VLglobal", [song("global")])
    service._region_chart_sync = lambda _region: ("India", "VLindia", [song("india")])
    service._region_explore_sync = lambda _region: []


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
            OnlineHomeSection(id="region-top", title="Top Songs", layout="song_list"),
        ],
    )
    service._home_cache = {"US": (0, previous)}
    service._provider_home_sync = lambda: None
    service._region_chart_sync = lambda _region: ("India", "VLindia", [song("india")])
    service._region_explore_sync = lambda _region: []

    def fail_global():
        raise RuntimeError("chart unavailable")

    service._global_chart_sync = fail_global
    assert asyncio.run(service.home()) is previous


def test_cold_start_partial_failure_returns_successful_sections() -> None:
    service = YouTubeMusicService()
    service._provider_home_sync = lambda: (_ for _ in ()).throw(
        RuntimeError("provider unavailable")
    )
    service._global_chart_sync = lambda: ("Global", "VLglobal", [song("global")])
    service._region_chart_sync = lambda _region: (_ for _ in ()).throw(
        RuntimeError("india unavailable")
    )
    service._region_explore_sync = lambda _region: [album("MPREbAlbum")]
    response = asyncio.run(service.home())
    assert [section.id for section in response.sections] == [
        "today-picks",
        "global-trending",
        "trending-albums",
    ]


def test_duration_hydration_covers_every_item_and_reuses_known_lengths() -> None:
    service = YouTubeMusicService()
    lookups: list[str] = []

    class FakeSession:
        def web_remix_client(self):
            return WEB

        def player(self, video_id, *, client):
            lookups.append(video_id)
            return {"videoDetails": {"lengthSeconds": "200"}}

    class FakeClient:
        session = FakeSession()

    first = [song(f"track-{index}") for index in range(12)]
    service._hydrate_missing_durations(FakeClient(), first, limit=len(first))
    assert all(item.duration_seconds == 200 for item in first)
    assert len(lookups) == 12

    again = [song("track-3"), song("track-11")]
    service._hydrate_missing_durations(FakeClient(), again, limit=len(again))
    assert [item.duration_seconds for item in again] == [200, 200]
    assert len(lookups) == 12


def test_home_uses_the_requested_region_and_caches_each_region_separately() -> None:
    service = YouTubeMusicService()
    calls = []
    service._provider_home_sync = lambda: None
    service._global_chart_sync = lambda: ("Global", "VLglobal", [song("global")])
    service._region_chart_sync = lambda region: calls.append(region) or ("Top", f"VL{region}", [song(f"chart-{region}")])
    service._region_explore_sync = lambda region: [album(f"MPREb{region}")]

    india = asyncio.run(service.home("in"))
    usa = asyncio.run(service.home("US"))
    asyncio.run(service.home("IN"))
    unknown = asyncio.run(service.home("XX"))

    assert calls == ["IN", "US"]
    assert india.region == "IN" and usa.region == "US" and unknown.region == "US"
    top = {section.id: section for section in india.sections}["region-top"]
    assert top.title == "Top Songs" and top.items[0].id == "chart-IN"
    albums = {section.id: section for section in usa.sections}["trending-albums"]
    assert albums.subtitle is None and "United States" not in albums.title


def test_newest_release_picks_the_latest_year() -> None:
    from app.services.ytmusic_service.regions import newest_release

    assert newest_release([("old", "Album • 2013"), ("new", "2023"), ("unknown", "Single")]) == "new"
    assert newest_release([]) is None


def test_regional_albums_use_each_top_artists_newest_release_and_fall_back_to_explore(monkeypatch) -> None:
    service = YouTubeMusicService()
    charts = {"contents": [{"musicCarouselShelfRenderer": {
        "header": {"musicCarouselShelfBasicHeaderRenderer": {"title": {"runs": [{"text": "Top artists"}]}}},
        "contents": [{"musicResponsiveListItemRenderer": {"id": aid}} for aid in ("UCa", "UCb")],
    }}]}

    class Session:
        def web_remix_client(self):
            return WEB

        def browse(self, *, client, browse_id, form_data=None):
            return charts if browse_id == "FEmusic_charts" else {"explore": True}

    service._region_clients["GB"] = type("Client", (), {"session": Session()})()
    monkeypatch.setattr(service_module, "item_from_renderer", lambda value: SimpleNamespace(kind="artist", id=value["musicResponsiveListItemRenderer"]["id"], title=f"Artist {value['musicResponsiveListItemRenderer']['id']}"))
    service._artist_page_or_none = lambda artist_id: {"raw_albums": [(album(f"{artist_id}-old"), "2019"), (album(f"{artist_id}-new"), "2025")]}
    albums = service._region_explore_sync("GB")
    assert [item.id for item in albums] == ["UCa-new", "UCb-new"]
    assert [(item.artists[0].name, item.artists[0].id) for item in albums] == [("Artist UCa", "UCa"), ("Artist UCb", "UCb")]

    service._artist_page_or_none = lambda artist_id: None
    monkeypatch.setattr(service_module, "extract_explore_albums", lambda raw: [album("explore")] if raw.get("explore") else [])
    assert [item.id for item in service._region_explore_sync("GB")] == ["explore"]


def test_chart_titles_drop_video_clutter() -> None:
    from app.services.ytmusic_service.presentation import clean_chart_title

    assert clean_chart_title("Xamdam Sobirov - Peshta / Хамдам Собиров - Пешта / Video Klip", ["Xamdam Sobirov"]) == "Peshta"
    assert clean_chart_title("Quédate Tonight - Jack Hit (Official Music Video)", ["Jack Hit"]) == "Quédate Tonight"
    assert clean_chart_title("Clave Especial - MAÑA [Video Oficial]", ["CLAVE ESPECIAL"]) == "MAÑA"
    assert clean_chart_title("Tu Mil Jaaye (From \"KING\")", ["Kumaar"]) == "Tu Mil Jaaye (From \"KING\")"
    assert clean_chart_title("Arz Kiya Hai | Coke Studio Bharat", ["Anuv Jain"]) == "Arz Kiya Hai | Coke Studio Bharat"
