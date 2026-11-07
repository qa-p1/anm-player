from __future__ import annotations

import hashlib
import re
from typing import Any

from app.services.ytmusic_service.models import (
    AlbumRef,
    ArtistRef,
    HomeChip,
    HomePage,
    HomeSection,
    InnertubeSearchResult,
    ItemKind,
    YTItem,
)


def _normalized_title(value: str) -> str:
    return " ".join(value.casefold().split())


def playable_tracks(items: list[YTItem]) -> list[YTItem]:
    result: list[YTItem] = []
    seen: set[str] = set()
    for item in items:
        if item.kind != "song" or not item.id or item.id in seen:
            continue
        seen.add(item.id)
        result.append(item)
    return result


def find_provider_quick_picks(sections: list[HomeSection]) -> HomeSection | None:
    for section in sections:
        title = _normalized_title(section.title)
        if "listen again" in title:
            continue
        if "quick picks" in title or "quick" in title:
            return section
    return None


def _iter_shelf_renderers(value: Any):
    if isinstance(value, dict):
        for key in ("musicCarouselShelfRenderer", "musicShelfRenderer"):
            renderer = value.get(key)
            if isinstance(renderer, dict):
                yield renderer
        for item in value.values():
            yield from _iter_shelf_renderers(item)
    elif isinstance(value, list):
        for item in value:
            yield from _iter_shelf_renderers(item)


def _shelf_title(renderer: dict[str, Any]) -> str:
    return (
        header_title(renderer.get("header"))
        or header_title(renderer.get("title"))
        or ""
    )


def _ordered_renderer_items(value: Any):
    if isinstance(value, dict):
        for key in (
            "musicResponsiveListItemRenderer",
            "musicTwoRowItemRenderer",
            "musicCardShelfRenderer",
        ):
            renderer = value.get(key)
            if isinstance(renderer, dict):
                yield {key: renderer}
                return
        for item in value.values():
            yield from _ordered_renderer_items(item)
    elif isinstance(value, list):
        for item in value:
            yield from _ordered_renderer_items(item)


def _items_from_shelf(renderer: dict[str, Any]) -> list[YTItem]:
    contents = renderer.get("contents") or renderer.get("items") or []
    return [
        item
        for wrapped in _ordered_renderer_items(contents)
        if (item := item_from_renderer(wrapped))
    ]


def extract_video_charts_section(raw: dict[str, Any]) -> dict[str, Any] | None:
    return next(
        (
            renderer
            for renderer in _iter_shelf_renderers(raw)
            if "video charts" in _normalized_title(_shelf_title(renderer))
        ),
        None,
    )


def select_chart_playlist(
    video_charts: dict[str, Any],
    preferences: tuple[tuple[str, ...], ...],
) -> YTItem | None:
    candidates = [
        item
        for item in _items_from_shelf(video_charts)
        if get_browse_id(item.endpoint) or get_playlist_id(item.endpoint)
    ]
    for terms in preferences:
        match = next(
            (
                item
                for item in candidates
                if all(term in _normalized_title(item.title) for term in terms)
            ),
            None,
        )
        if match:
            return match
    return candidates[0] if candidates else None


def normalize_chart_browse_id(playlist_id: str) -> str:
    return playlist_id if playlist_id.startswith("VL") else f"VL{playlist_id}"


def parse_chart_tracks(raw: dict[str, Any]) -> list[YTItem]:
    return playable_tracks(
        [
            item
            for wrapped in _ordered_renderer_items(raw)
            if (item := item_from_renderer(wrapped))
        ]
    )


def extract_explore_albums(raw: dict[str, Any]) -> list[YTItem]:
    shelf = next(
        (
            renderer
            for renderer in _iter_shelf_renderers(raw)
            if "new albums" in _normalized_title(_shelf_title(renderer))
            or "albums and singles" in _normalized_title(_shelf_title(renderer))
        ),
        None,
    )
    if shelf is None:
        return []
    result: list[YTItem] = []
    seen: set[str] = set()
    for item in _items_from_shelf(shelf):
        browse_id = get_browse_id(item.endpoint)
        if (
            item.kind != "album"
            or not browse_id
            or not browse_id.startswith("MPREb")
            or browse_id in seen
        ):
            continue
        seen.add(browse_id)
        result.append(item)
    return result


def _page_type(value: Any) -> str | None:
    if isinstance(value, dict):
        page_type = value.get("pageType")
        if isinstance(page_type, str):
            return page_type
        for item in value.values():
            found = _page_type(item)
            if found:
                return found
    elif isinstance(value, list):
        for item in value:
            found = _page_type(item)
            if found:
                return found
    return None


def extract_related_browse_id(raw_next: dict[str, Any]) -> str | None:
    tabs = list(walk_renderers(raw_next, "tabRenderer"))
    related = next(
        (tab for tab in tabs if _page_type(tab) == "MUSIC_PAGE_TYPE_TRACK_RELATED"),
        None,
    )
    if related is None:
        related = next(
            (
                tab
                for tab in tabs
                if "related"
                in _normalized_title(
                    tab.get("title")
                    if isinstance(tab.get("title"), str)
                    else runs_text(tab.get("title"))
                )
            ),
            None,
        )
    if related is None:
        return None
    endpoint = (
        related.get("endpoint")
        or related.get("navigationEndpoint")
        or _find_endpoint(related)
    )
    browse_id = get_browse_id(endpoint)
    return browse_id if browse_id and browse_id.startswith("MPTR") else None


def select_related_song_items(
    raw: dict[str, Any], *, seed_video_id: str
) -> list[YTItem]:
    song_shelves: list[tuple[str, list[YTItem]]] = []
    for renderer in _iter_shelf_renderers(raw):
        parsed = _items_from_shelf(renderer)
        if not parsed or any(item.kind != "song" for item in parsed):
            continue
        song_shelves.append((_shelf_title(renderer), parsed))
    if not song_shelves:
        return []
    selected = next(
        (
            items
            for title, items in song_shelves
            if "you might also like" in _normalized_title(title)
        ),
        song_shelves[0][1],
    )
    return [item for item in playable_tracks(selected) if item.id != seed_video_id][:20]


def parse_home(raw: dict[str, Any]) -> HomePage:
    chips = [
        HomeChip(title=text, endpoint=chip.get("navigationEndpoint"))
        for chip in walk_renderers(raw, "chipCloudChipRenderer")
        if (text := runs_text(chip.get("text")))
    ]
    sections: list[HomeSection] = []

    for renderer in walk_renderers(raw, "musicCarouselShelfRenderer"):
        title = header_title(renderer.get("header")) or "Featured"
        items = [
            item
            for item in (
                item_from_renderer(child)
                for child in _renderer_children(renderer.get("contents"))
            )
            if item
        ]
        if items:
            sections.append(
                HomeSection(
                    title=title,
                    label=None,
                    thumbnail=items[0].thumbnail,
                    endpoint=renderer.get("navigationEndpoint"),
                    items=items,
                )
            )

    for renderer in walk_renderers(raw, "musicShelfRenderer"):
        title = (
            header_title(renderer.get("title"))
            or header_title(renderer.get("header"))
            or "Songs"
        )
        items = [
            item
            for item in (
                item_from_renderer(child)
                for child in _renderer_children(renderer.get("contents"))
            )
            if item
        ]
        if items:
            sections.append(
                HomeSection(
                    title=title,
                    label=None,
                    thumbnail=items[0].thumbnail,
                    endpoint=renderer.get("navigationEndpoint"),
                    items=items,
                )
            )

    return HomePage(
        chips=chips,
        sections=_dedupe_sections(sections),
        continuation=_find_continuation(raw),
    )


def parse_search(raw: dict[str, Any]) -> InnertubeSearchResult:
    items: list[YTItem] = []
    seen: set[tuple[str, str]] = set()
    for key in (
        "musicCardShelfRenderer",
        "musicResponsiveListItemRenderer",
        "musicTwoRowItemRenderer",
    ):
        for renderer in walk_renderers(raw, key):
            item = item_from_renderer({key: renderer})
            if not item:
                continue
            dedupe_key = (item.kind, item.id or item.title)
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            items.append(item)
    return InnertubeSearchResult(items=items, continuation=_find_continuation(raw))


def item_from_renderer(value: Any) -> YTItem | None:
    renderer = _unwrap_renderer(value)
    if not renderer:
        return None
    if "musicResponsiveListItemRenderer" in renderer:
        return _responsive_item(renderer["musicResponsiveListItemRenderer"])
    if "musicTwoRowItemRenderer" in renderer:
        return _two_row_item(renderer["musicTwoRowItemRenderer"])
    if "musicCardShelfRenderer" in renderer:
        return _card_item(renderer["musicCardShelfRenderer"])
    return None


def _responsive_item(renderer: dict[str, Any]) -> YTItem | None:
    columns = [
        runs(
            (column.get("musicResponsiveListItemFlexColumnRenderer") or {}).get("text")
        )
        for column in renderer.get("flexColumns") or []
    ]
    columns = [column for column in columns if column]
    if not columns:
        return None
    title = _runs_text_from_runs(columns[0])
    endpoint = (
        renderer.get("navigationEndpoint")
        or _first_endpoint(columns[0])
        or _find_endpoint(renderer)
    )
    video_id = _video_id(endpoint)
    browse_id = get_browse_id(endpoint)
    playlist_id = get_playlist_id(endpoint)
    subtitle_runs = [run for column in columns[1:] for run in column]
    subtitle_texts = [
        run.get("text", "").strip()
        for run in subtitle_runs
        if run.get("text", "").strip() and run.get("text", "").strip() not in {"•", "·"}
    ]
    kind = _kind_from_endpoint(endpoint, title, subtitle_texts)
    item_id = video_id or browse_id or playlist_id or _stable_id(title)
    artists = _artist_refs(subtitle_runs)
    album = _album_ref(subtitle_runs)
    if not artists and subtitle_texts and kind in {"song", "episode"}:
        fallback_artist = next(
            (text for text in subtitle_texts if not looks_like_metric_text(text)), None
        )
        if fallback_artist:
            artists = [ArtistRef(name=fallback_artist)]
    return YTItem(
        kind=kind,
        id=item_id,
        title=title,
        thumbnail=best_thumbnail(renderer),
        explicit=_has_explicit_badge(renderer),
        artists=artists,
        album=album,
        duration_seconds=_duration_from_renderer(renderer, subtitle_texts),
        endpoint=endpoint,
        raw=renderer,
    )


def _two_row_item(renderer: dict[str, Any]) -> YTItem | None:
    title = runs_text(renderer.get("title"))
    if not title:
        return None
    subtitle_runs = runs(renderer.get("subtitle"))
    subtitle_texts = [
        run.get("text", "").strip()
        for run in subtitle_runs
        if run.get("text", "").strip() and run.get("text", "").strip() not in {"•", "·"}
    ]
    endpoint = (
        renderer.get("navigationEndpoint")
        or _first_endpoint(runs(renderer.get("title")))
        or _find_endpoint(renderer)
    )
    video_id = _video_id(endpoint)
    browse_id = get_browse_id(endpoint)
    playlist_id = get_playlist_id(endpoint)
    kind = _kind_from_endpoint(endpoint, title, subtitle_texts)
    item_id = video_id or browse_id or playlist_id or _stable_id(title)
    return YTItem(
        kind=kind,
        id=item_id,
        title=title,
        thumbnail=best_thumbnail(renderer),
        explicit=_has_explicit_badge(renderer),
        artists=_artist_refs(subtitle_runs),
        album=_album_ref(subtitle_runs),
        duration_seconds=_duration_from_renderer(renderer, subtitle_texts),
        endpoint=endpoint,
        raw=renderer,
    )


def _card_item(renderer: dict[str, Any]) -> YTItem | None:
    title = runs_text(renderer.get("title"))
    if not title:
        return None
    subtitle_runs = runs(renderer.get("subtitle"))
    endpoint = renderer.get("navigationEndpoint") or _find_endpoint(renderer)
    return YTItem(
        kind=_kind_from_endpoint(
            endpoint, title, [run.get("text", "") for run in subtitle_runs]
        ),
        id=_video_id(endpoint)
        or get_browse_id(endpoint)
        or get_playlist_id(endpoint)
        or _stable_id(title),
        title=title,
        thumbnail=best_thumbnail(renderer),
        artists=_artist_refs(subtitle_runs),
        album=_album_ref(subtitle_runs),
        duration_seconds=_duration_from_renderer(
            renderer, [run.get("text", "") for run in subtitle_runs]
        ),
        endpoint=endpoint,
        raw=renderer,
    )


def _kind_from_endpoint(
    endpoint: dict[str, Any] | None, title: str, subtitle_texts: list[str]
) -> ItemKind:
    if _video_id(endpoint):
        text = " ".join(subtitle_texts).lower()
        return "episode" if "podcast" in text or "episode" in text else "song"
    browse_id = get_browse_id(endpoint) or ""
    playlist_id = get_playlist_id(endpoint) or ""
    text = " ".join([title, *subtitle_texts]).lower()
    if browse_id.startswith("MPREb"):
        return "album"
    if browse_id.startswith("UC") or "artist" in text:
        return "artist"
    if "podcast" in text:
        return "podcast"
    if playlist_id or browse_id.startswith("VL") or "playlist" in text:
        return "playlist"
    return "unknown"


def _artist_refs(runs: list[dict[str, Any]]) -> list[ArtistRef]:
    result: list[ArtistRef] = []
    for run in runs:
        text = run.get("text", "").strip()
        endpoint = run.get("navigationEndpoint")
        browse_id = get_browse_id(endpoint)
        if not text or text in {"•", "·"} or looks_like_metric_text(text):
            continue
        if browse_id and (browse_id.startswith("UC") or browse_id.startswith("MPLA")):
            result.append(ArtistRef(name=text, id=browse_id))
    return result[:4]


def looks_like_metric_text(text: str) -> bool:
    normalized = text.strip().lower()
    return bool(
        re.search(r"\b(?:plays?|views?|songs?|minutes?|hours?)\b", normalized)
        or re.fullmatch(r"\d{4}", normalized)
        or normalized in {"song", "songs", "album", "single", "ep", "playlist", "video"}
    )


def _album_ref(runs: list[dict[str, Any]]) -> AlbumRef | None:
    for run in runs:
        text = run.get("text", "").strip()
        browse_id = get_browse_id(run.get("navigationEndpoint"))
        if text and browse_id and browse_id.startswith("MPREb"):
            return AlbumRef(name=text, id=browse_id)
    return None


def runs(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, dict):
        return []
    runs = value.get("runs")
    if isinstance(runs, list):
        return [run for run in runs if isinstance(run, dict)]
    simple_text = value.get("simpleText")
    return [{"text": simple_text}] if isinstance(simple_text, str) else []


def runs_text(value: Any) -> str:
    return _runs_text_from_runs(runs(value))


def _runs_text_from_runs(runs: list[dict[str, Any]]) -> str:
    return "".join(run.get("text", "") for run in runs).strip()


def header_title(value: Any) -> str | None:
    if isinstance(value, dict):
        text = runs_text(value)
        if text:
            return text
        for item in value.values():
            found = header_title(item)
            if found:
                return found
    elif isinstance(value, list):
        for item in value:
            found = header_title(item)
            if found:
                return found
    return None


def _renderer_children(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        for key in ("contents", "items"):
            if isinstance(value.get(key), list):
                return value[key]
    return []


def _unwrap_renderer(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    if any(
        key in value
        for key in (
            "musicResponsiveListItemRenderer",
            "musicTwoRowItemRenderer",
            "musicCardShelfRenderer",
        )
    ):
        return value
    if "item" in value and isinstance(value["item"], dict):
        return _unwrap_renderer(value["item"])
    return value


def walk_renderers(value: Any, renderer_key: str):
    if isinstance(value, dict):
        renderer = value.get(renderer_key)
        if isinstance(renderer, dict):
            yield renderer
        for item in value.values():
            yield from walk_renderers(item, renderer_key)
    elif isinstance(value, list):
        for item in value:
            yield from walk_renderers(item, renderer_key)


def _find_endpoint(value: Any) -> dict[str, Any] | None:
    if isinstance(value, dict):
        for key in ("watchEndpoint", "browseEndpoint", "watchPlaylistEndpoint"):
            if isinstance(value.get(key), dict):
                return value
        for item in value.values():
            found = _find_endpoint(item)
            if found:
                return found
    elif isinstance(value, list):
        for item in value:
            found = _find_endpoint(item)
            if found:
                return found
    return None


def _first_endpoint(runs: list[dict[str, Any]]) -> dict[str, Any] | None:
    for run in runs:
        endpoint = run.get("navigationEndpoint")
        if isinstance(endpoint, dict):
            return endpoint
    return None


def _video_id(endpoint: dict[str, Any] | None) -> str | None:
    if not endpoint:
        return None
    return (endpoint.get("watchEndpoint") or {}).get("videoId") or endpoint.get(
        "videoId"
    )


def get_browse_id(endpoint: dict[str, Any] | None) -> str | None:
    if not endpoint:
        return None
    return (endpoint.get("browseEndpoint") or {}).get("browseId") or endpoint.get(
        "browseId"
    )


def get_playlist_id(endpoint: dict[str, Any] | None) -> str | None:
    if not endpoint:
        return None
    return (
        (endpoint.get("watchEndpoint") or {}).get("playlistId")
        or (endpoint.get("watchPlaylistEndpoint") or {}).get("playlistId")
        or endpoint.get("playlistId")
    )


def best_thumbnail(value: Any) -> str | None:
    best_url: str | None = None
    best_area = -1
    for thumb in _walk_thumbnails(value):
        url = thumb.get("url")
        if not isinstance(url, str):
            continue
        area = int(thumb.get("width") or 0) * int(thumb.get("height") or 0)
        if area >= best_area:
            best_url = url
            best_area = area
    return best_url


def _walk_thumbnails(value: Any):
    if isinstance(value, dict):
        thumbs = value.get("thumbnails")
        if isinstance(thumbs, list):
            for thumb in thumbs:
                if isinstance(thumb, dict):
                    yield thumb
        for item in value.values():
            yield from _walk_thumbnails(item)
    elif isinstance(value, list):
        for item in value:
            yield from _walk_thumbnails(item)


def _duration_from_texts(texts: list[str]) -> int | None:
    for text in reversed(texts):
        match = re.search(r"\b(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\b", text or "")
        if match:
            hours = int(match.group(1) or 0)
            minutes = int(match.group(2))
            seconds = int(match.group(3))
            return hours * 3600 + minutes * 60 + seconds
    return None


def _duration_from_renderer(renderer: dict[str, Any], texts: list[str]) -> int | None:
    """Read duration from subtitles, fixed columns, or thumbnail overlays."""
    duration_texts = list(texts)
    for column in renderer.get("fixedColumns") or []:
        if not isinstance(column, dict):
            continue
        fixed = column.get("musicResponsiveListItemFixedColumnRenderer") or {}
        duration_texts.append(runs_text(fixed.get("text")))
    for overlay in walk_renderers(renderer, "thumbnailOverlayTimeStatusRenderer"):
        duration_texts.append(runs_text(overlay.get("text")))
    return _duration_from_texts(duration_texts)


def _has_explicit_badge(value: Any) -> bool:
    if isinstance(value, dict):
        if value.get("iconType") == "MUSIC_EXPLICIT_BADGE":
            return True
        return any(_has_explicit_badge(item) for item in value.values())
    if isinstance(value, list):
        return any(_has_explicit_badge(item) for item in value)
    return False


def _find_continuation(value: Any) -> str | None:
    if isinstance(value, dict):
        command = value.get("continuationCommand")
        if isinstance(command, dict) and isinstance(command.get("token"), str):
            return command["token"]
        for item in value.values():
            found = _find_continuation(item)
            if found:
                return found
    elif isinstance(value, list):
        for item in value:
            found = _find_continuation(item)
            if found:
                return found
    return None


def _dedupe_sections(sections: list[HomeSection]) -> list[HomeSection]:
    result: list[HomeSection] = []
    seen_titles: set[str] = set()
    for section in sections:
        key = section.title.lower()
        if key in seen_titles:
            continue
        seen_titles.add(key)
        result.append(section)
    return result


def _stable_id(title: str) -> str:
    return hashlib.sha256(title.encode("utf-8")).hexdigest()[:16]
