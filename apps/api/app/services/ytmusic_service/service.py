from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
import logging
import threading
import time
from typing import Any

from app.core.exceptions import AppError
from app.schemas.library import OnlineAlbumPreview, OnlineAlbumTrackPreview
from app.schemas.ytmusic import (
    OnlineHomeResponse,
    OnlineMusicItem,
    OnlineRelatedResponse,
    OnlineSearchResponse,
)
from app.services.ytmusic_service.client import YouTubeMusicClient
from app.services.ytmusic_service.models import HomePage, PlaybackData, YTItem
from app.services.ytmusic_service.parsing import (
    runs_text,
    best_thumbnail,
    extract_explore_albums,
    extract_related_browse_id,
    extract_video_charts_section,
    find_provider_quick_picks,
    get_browse_id,
    get_playlist_id,
    item_from_renderer,
    normalize_chart_browse_id,
    parse_chart_tracks,
    select_chart_playlist,
    select_related_song_items,
    walk_renderers,
)
from app.services.ytmusic_service.regions import CHART_REGIONS, DEFAULT_REGION, chart_region, newest_release
from app.services.ytmusic_service.presentation import (
    album_artist_from_items,
    album_artist_from_raw,
    album_title_from_raw,
    artist_name_from_raw,
    artist_release_shelves,
    album_year_from_raw,
    assemble_home,
    extract_lyrics_lines,
    find_lyrics_browse_id,
    has_complete_charts,
    item_to_schema,
)
from app.services.ytmusic_service.transport import SEARCH_FILTERS, InnerTubeSession

logger = logging.getLogger(__name__)
# How many of a country's top artists feed its "Trending Albums" row.
TRENDING_ARTISTS = 12


class YouTubeMusicService:
    def __init__(self) -> None:
        self.client = YouTubeMusicClient(InnerTubeSession(gl="US", hl="en-US"))
        self.home_client = self.client
        self.global_chart_client = YouTubeMusicClient(
            InnerTubeSession(gl="US", hl="en-US")
        )
        self._region_clients: dict[str, YouTubeMusicClient] = {}
        self.related_client = YouTubeMusicClient(InnerTubeSession(gl="US", hl="en-US"))
        # Kept as a compatibility alias for callers that previously replaced this client.
        self._search_cache: dict[
            tuple[str, str, str | None], tuple[float, OnlineSearchResponse]
        ] = {}
        self._album_cache: dict[str, tuple[float, OnlineAlbumPreview]] = {}
        self._album_inflight: dict[str, asyncio.Task[OnlineAlbumPreview]] = {}
        self.album_cache_ttl_seconds = 120.0
        self.album_cache_max_entries = 128
        self._home_cache: dict[str, tuple[float, OnlineHomeResponse]] = {}
        self._related_cache: dict[str, tuple[float, OnlineRelatedResponse]] = {}
        self._duration_cache: dict[str, int] = {}
        self._artist_cache: dict[str, tuple[float, dict[str, Any]]] = {}
        self.artist_cache_ttl_seconds = 600.0
        self._home_refresh_lock = asyncio.Lock()
        self.search_cache_ttl_seconds = 600.0
        self.home_cache_ttl_seconds = 600.0
        self.related_cache_ttl_seconds = 300.0
        # Resolving a stream costs a player call plus validation range requests
        # (or a slow yt-dlp fallback). The audio element issues a new range
        # request on every seek, so reuse a resolved URL while it stays valid.
        self._playback_cache: dict[tuple[str, str], tuple[float, PlaybackData]] = {}
        self._playback_cache_lock = threading.Lock()
        self.playback_cache_ttl_seconds = 1800.0
        self.playback_cache_max_entries = 64

    async def home(self, region: str = DEFAULT_REGION) -> OnlineHomeResponse:
        """Home with global sections plus the region's chart and new releases (cached per region)."""
        region = chart_region(region)
        now = time.monotonic()
        cached = self._home_cache.get(region)
        if cached and cached[0] > now:
            return cached[1]
        async with self._home_refresh_lock:
            now = time.monotonic()
            cached = self._home_cache.get(region)
            if cached and cached[0] > now:
                return cached[1]
            previous = cached[1] if cached else None
            logger.info("Refreshing YouTube Music home", extra={"source": "home", "country": region, "cache_state": "refresh"})
            provider_result, global_result, region_result, albums_result = await asyncio.gather(
                self._load_home_source("provider home", "US", self._provider_home_sync),
                self._load_home_source("Global chart", "ZZ", self._global_chart_sync),
                self._load_home_source("Region chart", region, lambda: self._region_chart_sync(region)),
                self._load_home_source("Region explore", region, lambda: self._region_explore_sync(region)),
            )
            if (global_result[1] or region_result[1]) and previous and has_complete_charts(previous):
                logger.warning(
                    "YouTube Music chart refresh failed; returning stale complete home",
                    extra={"source": "home", "country": region, "cache_state": "stale_fallback"},
                )
                self._home_cache[region] = (now + self.home_cache_ttl_seconds, previous)
                return previous
            response = assemble_home(
                provider_result[0], global_result[0], region_result[0], albums_result[0],
                region=region,
            )
            self._home_cache[region] = (now + self.home_cache_ttl_seconds, response)
            return response

    def _region_client(self, region: str) -> YouTubeMusicClient:
        client = self._region_clients.get(region)
        if client is None:
            client = YouTubeMusicClient(InnerTubeSession(gl=region, hl="en"))
            self._region_clients[region] = client
        return client

    async def related(self, video_id: str) -> OnlineRelatedResponse:
        now = time.monotonic()
        self._clear_expired_related_cache(now)
        cached = self._related_cache.get(video_id)
        if cached:
            logger.info(
                "YouTube Music related cache hit",
                extra={"source": "Related", "country": "US", "cache_state": "hit"},
            )
            return cached[1]

        try:
            items = await asyncio.to_thread(self._related_sync, video_id)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception(
                "YouTube Music related request failed",
                extra={"source": "Related", "country": "US", "error": str(exc)},
            )
            raise AppError(
                "YouTube Music related recommendations failed. Please try again."
            ) from exc

        response = OnlineRelatedResponse(
            seed_video_id=video_id, items=[item_to_schema(item) for item in items[:20]]
        )
        logger.info(
            "Parsed YouTube Music related recommendations",
            extra={
                "source": "Related",
                "country": "US",
                "item_count": len(response.items),
            },
        )
        if response.items:
            if len(self._related_cache) >= 128:
                self._related_cache.clear()
            self._related_cache[video_id] = (
                now + self.related_cache_ttl_seconds,
                response,
            )
        return response

    async def _load_home_source(self, source: str, country: str, loader):
        try:
            return await asyncio.to_thread(loader), False
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception(
                "YouTube Music home source failed",
                extra={"source": source, "country": country, "error": str(exc)},
            )
            return None, True

    async def search(
        self, query: str, *, filter_name: str = "all", continuation: str | None = None
    ) -> OnlineSearchResponse:
        filter_key = filter_name if filter_name in SEARCH_FILTERS else "all"
        cache_key = (query.strip().casefold(), filter_key, continuation)
        now = time.monotonic()
        cached = self._search_cache.get(cache_key)
        if cached and cached[0] > now:
            return cached[1]
        try:
            raw = await self.client.search_async(
                query, params=SEARCH_FILTERS[filter_key], continuation=continuation
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("Innertube search failed")
            raise AppError(
                "YouTube Music search failed. Please try a different query."
            ) from exc
        response = OnlineSearchResponse(
            query=query,
            filter=filter_key,
            items=[item_to_schema(item) for item in raw.items],
            continuation=raw.continuation,
        )
        while len(self._search_cache) >= 256:
            self._search_cache.pop(next(iter(self._search_cache)))
        self._search_cache[cache_key] = (now + self.search_cache_ttl_seconds, response)
        return response

    async def album(self, browse_id: str) -> OnlineAlbumPreview:
        cached = self._album_cache.get(browse_id)
        if cached and cached[0] > time.monotonic():
            return cached[1].model_copy(deep=True)

        pending = self._album_inflight.get(browse_id)
        if pending is None:
            pending = asyncio.create_task(self._load_album_preview(browse_id))
            self._album_inflight[browse_id] = pending

            def finished(task: asyncio.Task[OnlineAlbumPreview]) -> None:
                if self._album_inflight.get(browse_id) is task:
                    self._album_inflight.pop(browse_id, None)
                # A canceled HTTP caller may leave no waiter to retrieve a provider error.
                if not task.cancelled():
                    task.exception()

            pending.add_done_callback(finished)
        # wait() cancels only this listener, leaving the shared provider task alive.
        await asyncio.wait({pending})
        return pending.result().model_copy(deep=True)

    async def _load_album_preview(self, browse_id: str) -> OnlineAlbumPreview:
        preview = await asyncio.to_thread(self._album_sync, browse_id)
        if self.album_cache_ttl_seconds > 0 and self.album_cache_max_entries > 0:
            now = time.monotonic()
            self._album_cache = {
                key: value for key, value in self._album_cache.items() if value[0] > now
            }
            while len(self._album_cache) >= self.album_cache_max_entries:
                self._album_cache.pop(next(iter(self._album_cache)))
            self._album_cache[browse_id] = (
                now + self.album_cache_ttl_seconds,
                preview.model_copy(deep=True),
            )
        return preview

    async def artist(self, browse_id: str) -> dict[str, Any]:
        now = time.monotonic()
        cached = self._artist_cache.get(browse_id)
        if cached and cached[0] > now:
            return cached[1]
        result = await asyncio.to_thread(self._artist_sync, browse_id)
        if len(self._artist_cache) >= 128:
            self._artist_cache.pop(next(iter(self._artist_cache)))
        self._artist_cache[browse_id] = (now + self.artist_cache_ttl_seconds, result)
        return result

    def playback(self, video_id: str, *, quality: str = "high") -> PlaybackData:
        key = (video_id, quality)
        now = time.monotonic()
        with self._playback_cache_lock:
            cached = self._playback_cache.get(key)
            if cached and cached[0] > now:
                return cached[1]
        resolved = self.client.playback(video_id, quality=quality)
        ttl = self.playback_cache_ttl_seconds
        if resolved.expires_in_seconds > 0:
            # Leave a margin so a cached URL never expires mid-request.
            ttl = min(ttl, max(0.0, resolved.expires_in_seconds - 600.0))
        if ttl > 0:
            with self._playback_cache_lock:
                if len(self._playback_cache) >= self.playback_cache_max_entries:
                    expired = [
                        entry
                        for entry, (expires_at, _) in self._playback_cache.items()
                        if expires_at <= now
                    ]
                    for entry in expired or [next(iter(self._playback_cache))]:
                        self._playback_cache.pop(entry, None)
                self._playback_cache[key] = (now + ttl, resolved)
        return resolved

    def invalidate_playback(self, video_id: str) -> None:
        """Drop cached stream URLs for a video after the upstream rejects one."""
        with self._playback_cache_lock:
            for key in [key for key in self._playback_cache if key[0] == video_id]:
                self._playback_cache.pop(key, None)

    async def lyrics(self, video_id: str) -> str | None:
        return await asyncio.to_thread(self._lyrics_sync, video_id)

    async def artwork(self, video_id: str) -> str | None:
        return await asyncio.to_thread(self._artwork_sync, video_id)

    def _artwork_sync(self, video_id: str) -> str | None:
        try:
            player = self.client.session.player(
                video_id, client=self.client.session.web_remix_client()
            )
            return best_thumbnail(player)
        except Exception:
            logger.debug(
                "Innertube artwork lookup failed",
                extra={"video_id": video_id},
                exc_info=True,
            )
            return None

    def _lyrics_sync(self, video_id: str) -> str | None:
        try:
            raw_next = self.client.session.next(
                video_id=video_id, client=self.client.session.web_remix_client()
            )
            browse_id = find_lyrics_browse_id(raw_next)
            if not browse_id:
                return None
            raw_lyrics = self.client.session.browse(
                client=self.client.session.web_remix_client(), browse_id=browse_id
            )
            lines = extract_lyrics_lines(raw_lyrics)
            return "\n".join(lines) if lines else None
        except Exception:
            logger.debug(
                "Innertube lyrics lookup failed",
                extra={"video_id": video_id},
                exc_info=True,
            )
            return None

    def _provider_home_sync(self) -> HomePage:
        home = self.home_client.home()
        quick_shelf = find_provider_quick_picks(home.sections)
        if quick_shelf:
            self._hydrate_missing_durations(
                self.home_client, quick_shelf.items, limit=len(quick_shelf.items)
            )
        logger.info(
            "Parsed YouTube Music provider home",
            extra={
                "source": "provider home",
                "country": "US",
                "item_count": sum(len(section.items) for section in home.sections),
            },
        )
        return home

    def _global_chart_sync(self) -> tuple[str, str, list[YTItem]]:
        return self._chart_sync(
            self.global_chart_client,
            country="ZZ",
            preferences=(
                ("daily top music videos", "global"),
                ("top 100 music videos", "global"),
            ),
            source="Global chart",
        )

    def _region_chart_sync(self, region: str) -> tuple[str, str, list[YTItem]]:
        name = CHART_REGIONS[region].casefold()
        return self._chart_sync(
            self._region_client(region),
            country=region,
            preferences=(
                ("trending 20", name),
                ("daily top music videos", name),
                ("top 100 music videos", name),
                ("trending 20",),
                ("daily top music videos",),
            ),
            source="Region chart",
        )

    def _chart_sync(
        self,
        client: YouTubeMusicClient,
        *,
        country: str,
        preferences: tuple[tuple[str, ...], ...],
        source: str,
    ) -> tuple[str, str, list[YTItem]]:
        raw_charts = client.session.browse(
            client=client.session.web_remix_client(),
            browse_id="FEmusic_charts",
            form_data={"selectedValues": [country]},
        )
        video_charts = extract_video_charts_section(raw_charts)
        if video_charts is None:
            raise RuntimeError("Video charts shelf was not present")
        selected = select_chart_playlist(video_charts, preferences)
        if selected is None:
            raise RuntimeError("Video charts did not contain a browseable playlist")
        playlist_id = normalize_chart_browse_id(
            get_browse_id(selected.endpoint)
            or get_playlist_id(selected.endpoint)
            or selected.id
        )
        raw_playlist = client.session.browse(
            client=client.session.web_remix_client(), browse_id=playlist_id
        )
        items = parse_chart_tracks(raw_playlist)[:20]
        if not items:
            raise RuntimeError(
                f"Selected chart playlist {playlist_id} contained no playable tracks"
            )
        logger.info(
            "Parsed YouTube Music chart",
            extra={
                "source": source,
                "country": country,
                "selected_chart_title": selected.title,
                "playlist_id": playlist_id,
                "item_count": len(items),
            },
        )
        return selected.title, playlist_id, items

    def _region_explore_sync(self, region: str) -> list[YTItem]:
        """The newest release from each of the region's top artists.

        YouTube Music has no per-country album chart, and its Explore page is
        personalised by IP rather than the requested country, so the country's
        top-artists chart is the reliable regional signal.
        """
        client = self._region_client(region)
        try:
            raw_charts = client.session.browse(
                client=client.session.web_remix_client(),
                browse_id="FEmusic_charts",
                form_data={"selectedValues": [region]},
            )
            artist_ids: list[str] = []
            for shelf in walk_renderers(raw_charts, "musicCarouselShelfRenderer"):
                title = runs_text((shelf.get("header") or {}).get("musicCarouselShelfBasicHeaderRenderer", {}).get("title"))
                if not title.strip().casefold().startswith("top artists"):
                    continue
                for renderer in walk_renderers(shelf, "musicResponsiveListItemRenderer"):
                    item = item_from_renderer({"musicResponsiveListItemRenderer": renderer})
                    if item and item.kind == "artist" and item.id and item.id not in artist_ids:
                        artist_ids.append(item.id)
            artist_ids = artist_ids[:TRENDING_ARTISTS]
            with ThreadPoolExecutor(max_workers=min(6, len(artist_ids) or 1)) as pool:
                pages = list(pool.map(self._artist_page_or_none, artist_ids))
            albums: list[YTItem] = []
            for page in pages:
                newest = newest_release(page["raw_albums"]) if page else None
                if newest is not None:
                    albums.append(newest)
            if albums:
                logger.info("Built regional trending albums", extra={"source": "Region albums", "country": region, "item_count": len(albums)})
                return albums[:12]
        except Exception:
            logger.warning("Regional trending albums failed; using Explore", extra={"country": region}, exc_info=True)
        raw_explore = client.session.browse(
            client=client.session.web_remix_client(), browse_id="FEmusic_explore"
        )
        return extract_explore_albums(raw_explore)[:12]

    def _artist_page_or_none(self, browse_id: str) -> dict[str, Any] | None:
        try:
            return self._artist_releases_sync(browse_id)
        except Exception:
            logger.debug("Artist releases lookup failed", extra={"artist": browse_id}, exc_info=True)
            return None

    def _artist_releases_sync(self, browse_id: str) -> dict[str, Any]:
        raw = self.client.session.browse(client=self.client.session.web_remix_client(), browse_id=browse_id)
        releases: list[tuple[YTItem, str]] = []
        for shelf in artist_release_shelves(raw):
            for renderer in walk_renderers(shelf, "musicTwoRowItemRenderer"):
                item = item_from_renderer({"musicTwoRowItemRenderer": renderer})
                if item and item.kind == "album" and item.id:
                    releases.append((item, runs_text(renderer.get("subtitle"))))
        return {"raw_albums": releases}

    def _related_sync(self, video_id: str) -> list[YTItem]:
        client = self.related_client
        raw_next = client.session.next(
            video_id=video_id, client=client.session.web_remix_client()
        )
        browse_id = extract_related_browse_id(raw_next)
        if not browse_id:
            return []
        raw_related = client.session.browse(
            client=client.session.web_remix_client(), browse_id=browse_id
        )
        items = select_related_song_items(raw_related, seed_video_id=video_id)[:20]
        self._hydrate_missing_durations(client, items, limit=len(items))
        return items

    def _hydrate_missing_durations(
        self, client: YouTubeMusicClient, items: list[YTItem], *, limit: int
    ) -> None:
        """Fill shelf items that YouTube Music returned without a length.

        Lookups run in parallel and are remembered, so later shelves that share
        tracks (home, related, search) never show unknown durations again.
        """
        cache = self._duration_cache
        pending: list[YTItem] = []
        for item in items[:limit]:
            if item.duration_seconds is not None or item.kind != "song" or not item.id:
                continue
            known = cache.get(item.id)
            if known:
                item.duration_seconds = known
            else:
                pending.append(item)
        if not pending:
            return

        def lookup(item: YTItem) -> int | None:
            try:
                raw_player = client.session.player(
                    item.id, client=client.session.web_remix_client()
                )
                length = (raw_player.get("videoDetails") or {}).get("lengthSeconds")
                duration = int(length) if length is not None else 0
                return duration if duration > 0 else None
            except Exception:
                logger.debug(
                    "YouTube Music duration hydration failed",
                    extra={"source": "duration"},
                    exc_info=True,
                )
                return None

        with ThreadPoolExecutor(max_workers=min(6, len(pending))) as pool:
            durations = list(pool.map(lookup, pending))
        hydrated = 0
        for item, duration in zip(pending, durations, strict=True):
            if duration is None:
                continue
            item.duration_seconds = duration
            if len(cache) >= 4096:
                cache.pop(next(iter(cache)))
            cache[item.id] = duration
            hydrated += 1
        if hydrated:
            logger.info(
                "Hydrated YouTube Music shelf durations",
                extra={"source": "duration", "item_count": hydrated},
            )

    def _clear_expired_related_cache(self, now: float) -> None:
        expired = [
            key
            for key, (expires_at, _) in self._related_cache.items()
            if expires_at <= now
        ]
        for key in expired:
            self._related_cache.pop(key, None)

    def _album_sync(self, browse_id: str) -> OnlineAlbumPreview:
        try:
            raw = self.client.session.browse(
                client=self.client.session.web_remix_client(), browse_id=browse_id
            )
        except Exception as exc:
            logger.exception("Innertube album browse failed")
            raise AppError("YouTube Music album failed. Please try again.") from exc

        parsed_items: list[YTItem] = []
        seen: set[str] = set()
        for key in (
            "musicResponsiveListItemRenderer",
            "musicTwoRowItemRenderer",
            "musicCardShelfRenderer",
        ):
            for renderer in walk_renderers(raw, key):
                item = item_from_renderer({key: renderer})
                if not item or item.kind not in {"song", "episode"} or not item.id:
                    continue
                if item.id in seen:
                    continue
                seen.add(item.id)
                parsed_items.append(item)

        album_title = album_title_from_raw(raw) or (
            parsed_items[0].album.name
            if parsed_items and parsed_items[0].album
            else "Album"
        )
        album_art = best_thumbnail(raw) or (
            parsed_items[0].thumbnail if parsed_items else None
        )
        artist_name, artist_id = album_artist_from_raw(raw)
        if not artist_name:
            artist_name, artist_id = album_artist_from_items(parsed_items)
        year = album_year_from_raw(raw)

        tracks = [
            OnlineAlbumTrackPreview(
                external_id=item.id,
                title=item.title,
                artist_name=item.artists[0].name if item.artists else artist_name,
                artist_external_id=item.artists[0].id if item.artists else artist_id,
                album_title=album_title,
                duration_seconds=item.duration_seconds,
                track_number=index,
                disc_number=1,
                position=index - 1,
                source_url=item.share_link,
                artwork_url=item.thumbnail or album_art,
                explicit=item.explicit,
            )
            for index, item in enumerate(parsed_items, start=1)
        ]

        return OnlineAlbumPreview(
            external_id=browse_id,
            title=album_title,
            artist_name=artist_name,
            artist_external_id=artist_id,
            year=year,
            artwork_url=album_art,
            description=None,
            tracks=tracks,
        )

    def _artist_sync(self, browse_id: str) -> dict[str, Any]:
        try:
            raw = self.client.session.browse(
                client=self.client.session.web_remix_client(), browse_id=browse_id
            )
        except Exception as exc:
            logger.exception("Innertube artist browse failed")
            raise AppError("YouTube Music artist failed. Please try again.") from exc

        name = artist_name_from_raw(raw)
        thumbnail = best_thumbnail(raw)
        releases: list[OnlineMusicItem] = []
        seen_releases: set[str] = set()
        for shelf in artist_release_shelves(raw):
            for renderer in walk_renderers(shelf, "musicTwoRowItemRenderer"):
                item = item_from_renderer({"musicTwoRowItemRenderer": renderer})
                if item and item.kind == "album" and item.id and item.id not in seen_releases:
                    seen_releases.add(item.id)
                    release = item_to_schema(item)
                    # Release cards carry the year as their subtitle ("2013" or "Album • 2013").
                    subtitle = runs_text(renderer.get("subtitle")).strip()
                    releases.append(release.model_copy(update={"subtitle": subtitle}) if subtitle and not release.subtitle else release)
        items: list[OnlineMusicItem] = []
        seen: set[tuple[str, str]] = set()
        for key in (
            "musicResponsiveListItemRenderer",
            "musicTwoRowItemRenderer",
            "musicCardShelfRenderer",
        ):
            for renderer in walk_renderers(raw, key):
                item = item_from_renderer({key: renderer})
                if not item or not item.id:
                    continue
                dedupe_key = (item.kind, item.id)
                if dedupe_key in seen:
                    continue
                seen.add(dedupe_key)
                items.append(item_to_schema(item))

        return {
            "source": "youtube",
            "external_id": browse_id,
            "name": name,
            "thumbnail_url": thumbnail,
            "tracks": [item for item in items if item.playable],
            # Older pages without titled release rows fall back to every album found.
            "albums": releases or [item for item in items if item.kind == "album"],
        }


ytmusic_service = YouTubeMusicService()
