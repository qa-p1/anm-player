from __future__ import annotations

import re
from dataclasses import replace
from typing import Any

from app.schemas.ytmusic import (
    OnlineAlbum,
    OnlineArtist,
    OnlineHomeResponse,
    OnlineHomeSection,
    OnlineMusicItem,
)
from app.services.ytmusic_service.models import HomePage, YTItem
from app.services.ytmusic_service.parsing import (
    find_provider_quick_picks,
    get_browse_id,
    get_playlist_id,
    header_title,
    looks_like_metric_text,
    playable_tracks,
    runs,
    runs_text,
    walk_renderers,
)


HERO_SIZE = 5
_BRACKETS = re.compile(r"\s*(\([^()]*\)|\[[^\[\]]*\]|「[^」]*」|【[^】]*】)")
_VIDEO_WORDS = re.compile(r"official|video|vídeo|audio|lyric|visuali[sz]er|\bm/?v\b|\bclip\b|\b4k\b|\bhd\b", re.IGNORECASE)


def clean_chart_title(title: str, artist_names: list[str]) -> str:
    """Video charts carry titles like "Artist - Song (Official Music Video)"; keep the song name."""
    artists = [name.casefold() for name in artist_names if name]

    def is_artist(text: str) -> bool:
        return text.strip().casefold() in artists

    def strip_bracket(match: re.Match[str]) -> str:
        inner = match.group(1)[1:-1]
        return "" if _VIDEO_WORDS.search(inner) or is_artist(inner) else match.group(0)

    cleaned = _BRACKETS.sub(strip_bracket, title).strip()
    if " / " in cleaned:
        cleaned = cleaned.split(" / ", 1)[0].strip()
    parts = [part.strip() for part in re.split(r"\s+[-–—]\s+", cleaned) if part.strip()]
    original_parts = list(parts)
    if len(parts) > 1 and any(name in parts[0].casefold() for name in artists):
        parts = parts[1:]
    elif len(parts) > 1 and is_artist(parts[-1]):
        parts = parts[:-1]
    parts = [part for part in parts if not _VIDEO_WORDS.fullmatch(part) and not re.fullmatch(r"(?i)(official\s+)?(music\s+)?video(\s+klip)?|video\s+oficial", part)]
    result = cleaned if parts == original_parts else " - ".join(parts).strip(" -")
    return result or title


def chart_item(item: YTItem) -> YTItem:
    title = clean_chart_title(item.title, [artist.name for artist in item.artists])
    return item if title == item.title else replace(item, title=title)


def assemble_home(
    provider_home: HomePage | None,
    global_chart: tuple[str, str, list[YTItem]] | None,
    region_chart: tuple[str, str, list[YTItem]] | None,
    explore_albums: list[YTItem] | None,
    *,
    region: str = "US",
) -> OnlineHomeResponse:
    provider_sections = provider_home.sections if provider_home else []
    quick_shelf = find_provider_quick_picks(provider_sections)
    global_items = global_chart[2] if global_chart else []

    quick_items = playable_tracks(quick_shelf.items if quick_shelf else [])
    # The hero never repeats Quick Picks: it takes the head of a long shelf, or another shelf.
    if len(quick_items) >= HERO_SIZE + 8:
        today_items, quick_items = quick_items[:HERO_SIZE], quick_items[HERO_SIZE:]
    else:
        quick_ids = {item.id for item in quick_items}
        today_items = []
        for shelf in provider_sections:
            if shelf is quick_shelf:
                continue
            today_items = [item for item in playable_tracks(shelf.items) if item.id not in quick_ids]
            if today_items:
                break
        if not today_items:
            today_items = [item for item in global_items if item.id not in quick_ids]

    sections: list[OnlineHomeSection] = []
    if today_items:
        sections.append(
            OnlineHomeSection(
                id="today-picks",
                title="Today's Pick",
                subtitle="Ready to play",
                layout="hero",
                items=[item_to_schema(item) for item in today_items[:HERO_SIZE]],
            )
        )
    if quick_items:
        sections.append(
            OnlineHomeSection(
                id="quick-picks",
                title="Quick Picks",
                subtitle=quick_shelf.label if quick_shelf else None,
                layout="quick_grid",
                items=[item_to_schema(item) for item in quick_items[:20]],
            )
        )
    if global_chart:
        sections.append(
            OnlineHomeSection(
                id="global-trending",
                title="Trending Globally",
                subtitle=global_chart[0],
                layout="song_list",
                items=[item_to_schema(chart_item(item)) for item in global_items[:20]],
            )
        )
    if explore_albums:
        sections.append(
            OnlineHomeSection(
                id="trending-albums",
                title="Trending Albums",
                layout="album_grid",
                items=[item_to_schema(item) for item in explore_albums[:12]],
            )
        )
    if region_chart:
        sections.append(
            OnlineHomeSection(
                id="region-top",
                title="Top Songs",
                subtitle=region_chart[0],
                layout="song_list",
                items=[item_to_schema(chart_item(item)) for item in region_chart[2][:20]],
            )
        )
    return OnlineHomeResponse(region=region, chips=[], sections=sections)


def has_complete_charts(response: OnlineHomeResponse) -> bool:
    section_ids = {section.id for section in response.sections}
    return {"global-trending", "region-top"}.issubset(section_ids)


def item_to_schema(item: YTItem) -> OnlineMusicItem:
    artist_models = [
        OnlineArtist(id=artist.id, name=artist.name) for artist in item.artists
    ]
    album_model = (
        OnlineAlbum(id=item.album.id, name=item.album.name) if item.album else None
    )
    endpoint = item.endpoint if isinstance(item.endpoint, dict) else None
    browse_id = get_browse_id(endpoint) or (
        item.id if item.kind in {"album", "artist", "playlist", "podcast"} else None
    )
    playlist_id = get_playlist_id(endpoint) or (
        item.id if item.kind == "playlist" else None
    )
    return OnlineMusicItem(
        kind="video" if looks_like_video(item) else item.kind,
        id=item.id,
        title=item.title,
        subtitle=subtitle(item),
        artists=artist_models,
        album=album_model,
        thumbnail=item.thumbnail,
        duration_seconds=item.duration_seconds,
        explicit=item.explicit,
        playable=item.kind in {"song", "episode"},
        browse_id=browse_id,
        playlist_id=playlist_id,
        endpoint=endpoint,
        url=item.share_link,
    )


def subtitle(item: YTItem) -> str | None:
    parts = [artist.name for artist in item.artists]
    if item.album:
        parts.append(item.album.name)
    if item.duration_seconds:
        minutes, seconds = divmod(item.duration_seconds, 60)
        parts.append(f"{minutes}:{seconds:02d}")
    return " • ".join(part for part in parts if part) or None


def looks_like_video(item: YTItem) -> bool:
    music_type = (
        ((item.endpoint or {}).get("watchEndpointMusicSupportedConfigs") or {})
        .get("watchEndpointMusicConfig", {})
        .get("musicVideoType")
    )
    return item.kind == "song" and music_type not in {None, "MUSIC_VIDEO_TYPE_ATV"}


def album_title_from_raw(raw: dict[str, Any]) -> str | None:
    for key in (
        "musicDetailHeaderRenderer",
        "musicResponsiveHeaderRenderer",
        "musicEditablePlaylistDetailHeaderRenderer",
    ):
        for renderer in walk_renderers(raw, key):
            title = header_title(renderer.get("title")) or runs_text(
                renderer.get("title")
            )
            if title:
                return title
    return None


def album_artist_from_raw(raw: dict[str, Any]) -> tuple[str | None, str | None]:
    for renderer in walk_renderers(raw, "musicResponsiveHeaderRenderer"):
        for key in ("straplineTextOne", "straplineTextTwo"):
            for run in runs(renderer.get(key)):
                name = (run.get("text") or "").strip()
                browse_id = get_browse_id(run.get("navigationEndpoint"))
                if name and not looks_like_metric_text(name):
                    return name, browse_id
    return None, None


def album_artist_from_items(items: list[YTItem]) -> tuple[str | None, str | None]:
    for item in items:
        if item.artists:
            return item.artists[0].name, item.artists[0].id
    return None, None


def album_year_from_raw(raw: dict[str, Any]) -> int | None:
    for text in walk_strings(raw):
        match = re.fullmatch(r"(19|20)\d{2}", text.strip())
        if match:
            try:
                return int(text.strip())
            except ValueError:
                return None
    return None


def find_lyrics_browse_id(value: Any) -> str | None:
    if isinstance(value, dict):
        endpoint = value.get("browseEndpoint")
        if isinstance(endpoint, dict):
            browse_id = endpoint.get("browseId")
            text = " ".join(walk_strings(value)).lower()
            if isinstance(browse_id, str) and (
                "lyrics" in text or browse_id.startswith("MPLYt")
            ):
                return browse_id
        for item in value.values():
            found = find_lyrics_browse_id(item)
            if found:
                return found
    elif isinstance(value, list):
        for item in value:
            found = find_lyrics_browse_id(item)
            if found:
                return found
    return None


def extract_lyrics_lines(value: Any) -> list[str]:
    raw_lines: list[str] = []

    def visit(node: Any) -> None:
        if isinstance(node, dict):
            runs = node.get("runs")
            if isinstance(runs, list):
                text = "".join(
                    run.get("text", "") for run in runs if isinstance(run, dict)
                ).strip()
                if text:
                    raw_lines.extend(
                        line.strip() for line in text.splitlines() if line.strip()
                    )
            for item in node.values():
                visit(item)
        elif isinstance(node, list):
            for item in node:
                visit(item)

    visit(value)
    blocked = {"lyrics", "source", "songwriters", "show less", "show more"}
    result: list[str] = []
    seen: set[str] = set()
    for line in raw_lines:
        normalized = line.strip()
        key = normalized.lower()
        if not normalized or key in blocked or key in seen:
            continue
        if key.startswith("provided to youtube"):
            continue
        seen.add(key)
        result.append(normalized)
    return result


def walk_strings(value: Any):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from walk_strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from walk_strings(item)


ARTIST_HEADER_KEYS = (
    "musicImmersiveHeaderRenderer",
    "musicVisualHeaderRenderer",
    "musicResponsiveHeaderRenderer",
    "musicDetailHeaderRenderer",
)


def artist_name_from_raw(raw: dict[str, Any]) -> str | None:
    """Artist pages use an immersive or visual header, not an album header."""
    header = raw.get("header") if isinstance(raw.get("header"), dict) else {}
    for key in ARTIST_HEADER_KEYS:
        renderer = header.get(key)
        if isinstance(renderer, dict):
            title = header_title(renderer.get("title")) or runs_text(renderer.get("title"))
            if title and title.strip():
                return title.strip()
    return album_title_from_raw(raw)


def artist_release_shelves(raw: dict[str, Any]) -> list[dict[str, Any]]:
    """The artist's own "Albums" and "Singles & EPs" rows, not "Featured on" or playlists."""
    shelves = []
    for shelf in walk_renderers(raw, "musicCarouselShelfRenderer"):
        title = runs_text(
            (shelf.get("header") or {}).get("musicCarouselShelfBasicHeaderRenderer", {}).get("title")
        ).strip().casefold()
        if title.startswith(("albums", "singles", "eps")):
            shelves.append(shelf)
    return shelves
