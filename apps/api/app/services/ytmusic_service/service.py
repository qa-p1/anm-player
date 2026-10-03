from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
import threading
import time
from dataclasses import dataclass, field, replace
from typing import Any, Literal
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import Request, build_opener

import httpx

from app.core.exceptions import AppError
from app.schemas.library import OnlineAlbumPreview, OnlineAlbumTrackPreview
from app.schemas.ytmusic import (
    OnlineAlbum,
    OnlineArtist,
    OnlineHomeResponse,
    OnlineHomeSection,
    OnlineMusicItem,
    OnlineRelatedResponse,
    OnlineSearchResponse,
)

logger = logging.getLogger(__name__)

API_URL_YOUTUBE_MUSIC = "https://music.youtube.com/youtubei/v1/"
ORIGIN_YOUTUBE_MUSIC = "https://music.youtube.com"
REFERER_YOUTUBE_MUSIC = f"{ORIGIN_YOUTUBE_MUSIC}/"
USER_AGENT_WEB = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0"

SEARCH_FILTERS = {
    "all": None,
    "songs": "EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D",
    "videos": "EgWKAQIQAWoKEAkQChAFEAMQBA%3D%3D",
    "albums": "EgWKAQIYAWoKEAkQChAFEAMQBA%3D%3D",
    "artists": "EgWKAQIgAWoKEAkQChAFEAMQBA%3D%3D",
    "featured_playlists": "EgeKAQQoADgBagwQDhAKEAMQBRAJEAQ%3D",
    "community_playlists": "EgeKAQQoAEABagoQAxAEEAoQCRAF",
    "podcasts": "EgWKAQJQAWoKEAkQChAFEAMQBA%3D%3D",
    "episodes": "EgWKAQJYAWoKEAkQChAFEAMQBA%3D%3D",
    "profiles": "EgWKAQJYAWoSEAUQCRADEAQQEBAVEAoQDhAR",
}

ItemKind = Literal["song", "album", "playlist", "artist", "podcast", "episode", "unknown"]


@dataclass(slots=True)
class ArtistRef:
    name: str
    id: str | None = None


@dataclass(slots=True)
class AlbumRef:
    name: str
    id: str | None = None


@dataclass(slots=True)
class YTItem:
    kind: ItemKind
    id: str
    title: str
    thumbnail: str | None = None
    explicit: bool = False
    artists: list[ArtistRef] = field(default_factory=list)
    album: AlbumRef | None = None
    duration_seconds: int | None = None
    endpoint: dict[str, Any] | None = None
    raw: dict[str, Any] | None = None

    @property
    def share_link(self) -> str:
        if self.kind in {"song", "episode"} and self.id:
            return f"https://music.youtube.com/watch?v={self.id}"
        if self.kind in {"album", "playlist", "podcast"} and self.id:
            playlist_id = self.id if self.id.startswith("VL") else f"VL{self.id}" if self.kind == "playlist" else self.id
            return f"https://music.youtube.com/playlist?list={playlist_id}"
        if self.kind == "artist" and self.id:
            return f"https://music.youtube.com/channel/{self.id}"
        return "https://music.youtube.com/"


@dataclass(slots=True)
class HomeChip:
    title: str
    endpoint: dict[str, Any] | None = None


@dataclass(slots=True)
class HomeSection:
    title: str
    label: str | None
    thumbnail: str | None
    endpoint: dict[str, Any] | None
    items: list[YTItem]


@dataclass(slots=True)
class HomePage:
    chips: list[HomeChip]
    sections: list[HomeSection]
    continuation: str | None = None


@dataclass(slots=True)
class InnertubeSearchResult:
    items: list[YTItem]
    continuation: str | None = None


@dataclass(slots=True)
class PlaybackData:
    video_id: str
    title: str | None
    author: str | None
    stream_url: str
    expires_in_seconds: int
    client_name: str
    format: dict[str, Any]
    request_headers: dict[str, str] = field(default_factory=dict)
    video_details: dict[str, Any] | None = None
    playability_status: dict[str, Any] | None = None


@dataclass(frozen=True, slots=True)
class YouTubeClientConfig:
    client_name: str
    client_version: str
    client_id: str
    user_agent: str
    os_name: str | None = None
    os_version: str | None = None
    device_make: str | None = None
    device_model: str | None = None
    android_sdk_version: str | None = None
    login_supported: bool = False
    login_required: bool = False
    use_signature_timestamp: bool = False
    use_web_po_tokens: bool = False


WEB = YouTubeClientConfig("WEB", "2.20260213.00.00", "1", USER_AGENT_WEB)
WEB_REMIX = YouTubeClientConfig("WEB_REMIX", "1.20260213.01.00", "67", USER_AGENT_WEB, login_supported=True)
VISIONOS = YouTubeClientConfig(
    "VISIONOS",
    "0.1",
    "101",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
    os_name="visionOS",
    os_version="1.3.21O771",
    device_make="Apple",
    device_model="RealityDevice14,1",
)
IOS = YouTubeClientConfig(
    "IOS",
    "21.03.1",
    "5",
    "com.google.ios.youtube/21.03.1 (iPhone16,2; U; CPU iOS 18_2 like Mac OS X;)",
    os_version="18.2.22C152",
)
ANDROID = YouTubeClientConfig(
    "ANDROID",
    "21.03.38",
    "3",
    "com.google.android.youtube/21.03.38 (Linux; U; Android 14) gzip",
    os_name="Android",
    os_version="14",
    login_supported=True,
)


class InnerTubeError(RuntimeError):
    def __init__(self, status: int, body: str) -> None:
        super().__init__(f"Innertube request failed with HTTP {status}: {body[:300]}")
        self.status = status
        self.body = body


class InnerTubeSession:
    def __init__(self, *, gl: str = "US", hl: str = "en-US", cookie: str | None = None, timeout: float = 30.0) -> None:
        self.gl = gl
        self.hl = hl
        self.cookie = cookie
        self.timeout = timeout
        self.visitor_data: str | None = None
        self.data_sync_id: str | None = None
        self._opener = build_opener()
        self._api_key: str | None = None
        self._web_context: dict[str, Any] | None = None
        self._web_remix_client: YouTubeClientConfig | None = None
        self._web_config_lock = asyncio.Lock()

    def web_remix_client(self) -> YouTubeClientConfig:
        self._load_web_config()
        return self._web_remix_client or WEB_REMIX

    def context(self, client: YouTubeClientConfig, data_sync_id: str | None = None) -> dict[str, Any]:
        if client.client_name == "WEB_REMIX":
            self._load_web_config()
            if self._web_context is not None and data_sync_id is None:
                context = json.loads(json.dumps(self._web_context))
                context.setdefault("client", {})
                context["client"]["gl"] = self.gl
                context["client"]["hl"] = self.hl
                return context

        client_context: dict[str, Any] = {
            "clientName": client.client_name,
            "clientVersion": client.client_version,
            "gl": self.gl,
            "hl": self.hl,
        }
        for key, value in {
            "osName": client.os_name,
            "osVersion": client.os_version,
            "deviceMake": client.device_make,
            "deviceModel": client.device_model,
            "androidSdkVersion": client.android_sdk_version,
            "visitorData": self.visitor_data,
        }.items():
            if value is not None:
                client_context[key] = value
        return {"client": client_context, "user": {"onBehalfOfUser": data_sync_id if client.login_supported else None}}

    def headers(self, client: YouTubeClientConfig, *, set_login: bool = False) -> dict[str, str]:
        headers = {
            "Accept": "application/json",
            "Accept-Language": "en-US,en;q=0.9",
            "Content-Type": "application/json",
            "Origin": ORIGIN_YOUTUBE_MUSIC,
            "Referer": REFERER_YOUTUBE_MUSIC,
            "User-Agent": client.user_agent,
            "X-Goog-Api-Format-Version": "1",
            "X-Origin": ORIGIN_YOUTUBE_MUSIC,
            "X-YouTube-Client-Name": client.client_id,
            "X-YouTube-Client-Version": client.client_version,
        }
        if self.visitor_data:
            headers["X-Goog-Visitor-Id"] = self.visitor_data
        if set_login and client.login_supported and self.cookie:
            headers["Cookie"] = self.cookie
            sapisid = _parse_cookie(self.cookie).get("SAPISID")
            if sapisid:
                now = int(time.time())
                # YouTube's SAPISIDHASH wire protocol requires SHA-1. This is
                # protocol formatting, not a password or integrity hash.
                digest = hashlib.sha1(f"{now} {sapisid} {ORIGIN_YOUTUBE_MUSIC}".encode()).hexdigest()
                headers["Authorization"] = f"SAPISIDHASH {now}_{digest}"
        return headers

    def browse(
        self,
        *,
        client: YouTubeClientConfig | None = None,
        browse_id: str | None = None,
        params: str | None = None,
        continuation: str | None = None,
        form_data: dict[str, Any] | None = None,
        set_login: bool = False,
    ) -> dict[str, Any]:
        client = client or self.web_remix_client()
        return self.post(
            "browse",
            {
                "context": self.context(client, self.data_sync_id if set_login else None),
                "browseId": browse_id,
                "params": params,
                "continuation": continuation,
                "formData": form_data,
            },
            client=client,
            set_login=set_login,
        )

    def search(
        self,
        query_text: str | None = None,
        *,
        params: str | None = None,
        continuation: str | None = None,
        client: YouTubeClientConfig | None = None,
    ) -> dict[str, Any]:
        client = client or self.web_remix_client()
        return self.post(
            "search",
            {"context": self.context(client), "query": query_text, "params": params},
            client=client,
            query={"continuation": continuation, "ctoken": continuation},
        )

    async def search_async(
        self,
        query_text: str | None = None,
        *,
        params: str | None = None,
        continuation: str | None = None,
    ) -> dict[str, Any]:
        client = await self.web_remix_client_async()
        return await self.post_async(
            "search",
            {"context": self.context(client), "query": query_text, "params": params},
            client=client,
            query={"continuation": continuation, "ctoken": continuation},
        )

    def next(
        self,
        *,
        video_id: str | None = None,
        playlist_id: str | None = None,
        continuation: str | None = None,
        client: YouTubeClientConfig | None = None,
    ) -> dict[str, Any]:
        client = client or self.web_remix_client()
        return self.post(
            "next",
            {"context": self.context(client, self.data_sync_id), "videoId": video_id, "playlistId": playlist_id, "continuation": continuation},
            client=client,
            set_login=True,
        )

    def player(self, video_id: str, *, playlist_id: str | None = None, client: YouTubeClientConfig | None = None) -> dict[str, Any]:
        client = client or self.web_remix_client()
        return self.post(
            "player",
            {"context": self.context(client, self.data_sync_id), "videoId": video_id, "playlistId": playlist_id},
            client=client,
            set_login=True,
        )

    def post(
        self,
        path: str,
        body: dict[str, Any],
        *,
        client: YouTubeClientConfig,
        set_login: bool = False,
        query: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if client.client_name == "WEB_REMIX":
            self._load_web_config()
        url = path if path.startswith("http") else f"{API_URL_YOUTUBE_MUSIC}{path}"
        query = {"prettyPrint": "false", **(query or {})}
        if self._api_key and "key" not in query:
            query["key"] = self._api_key
        query_string = urlencode({key: value for key, value in query.items() if value is not None})
        request = Request(
            f"{url}?{query_string}",
            data=json.dumps(_strip_none(body), separators=(",", ":")).encode(),
            headers=self.headers(client, set_login=set_login),
            method="POST",
        )
        try:
            with self._opener.open(request, timeout=self.timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            body_text = exc.read().decode("utf-8", errors="replace")
            raise InnerTubeError(exc.code, body_text) from exc

    async def post_async(
        self,
        path: str,
        body: dict[str, Any],
        *,
        client: YouTubeClientConfig,
        set_login: bool = False,
        query: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        url = path if path.startswith("http") else f"{API_URL_YOUTUBE_MUSIC}{path}"
        query = {"prettyPrint": "false", **(query or {})}
        if self._api_key and "key" not in query:
            query["key"] = self._api_key
        timeout = httpx.Timeout(self.timeout)
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client_session:
            response = await client_session.post(
                url,
                params={key: value for key, value in query.items() if value is not None},
                json=_strip_none(body),
                headers=self.headers(client, set_login=set_login),
            )
        if response.is_error:
            raise InnerTubeError(response.status_code, response.text)
        return response.json()

    async def web_remix_client_async(self) -> YouTubeClientConfig:
        if self._web_remix_client is not None:
            return self._web_remix_client
        async with self._web_config_lock:
            if self._web_remix_client is not None:
                return self._web_remix_client
            try:
                async with httpx.AsyncClient(timeout=httpx.Timeout(self.timeout), follow_redirects=False) as client:
                    response = await client.get(ORIGIN_YOUTUBE_MUSIC, headers={"User-Agent": USER_AGENT_WEB, "Referer": REFERER_YOUTUBE_MUSIC})
                    response.raise_for_status()
                html = response.text
                ytcfg = re.search(r"ytcfg\.set\(({.+?})\);", html)
                config = json.loads(ytcfg.group(1)) if ytcfg else {}
                context = config.get("INNERTUBE_CONTEXT")
                if isinstance(context, dict):
                    self._web_context = context
                    visitor_data = (context.get("client") or {}).get("visitorData")
                    if isinstance(visitor_data, str):
                        self.visitor_data = visitor_data
                api_key = config.get("INNERTUBE_API_KEY")
                if isinstance(api_key, str):
                    self._api_key = api_key
                version = config.get("INNERTUBE_CONTEXT_CLIENT_VERSION")
                self._web_remix_client = replace(WEB_REMIX, client_version=version) if isinstance(version, str) else WEB_REMIX
            except asyncio.CancelledError:
                raise
            except Exception:
                self._web_remix_client = WEB_REMIX
            return self._web_remix_client

    def stream_request_headers(self, client: YouTubeClientConfig) -> dict[str, str]:
        headers = {
            "User-Agent": client.user_agent,
            "Accept": "*/*",
            "Accept-Encoding": "identity",
            "Connection": "keep-alive",
        }
        if client.client_name in {"WEB", "WEB_REMIX"}:
            headers["Origin"] = ORIGIN_YOUTUBE_MUSIC
            headers["Referer"] = REFERER_YOUTUBE_MUSIC
        if self.cookie:
            headers["Cookie"] = self.cookie
        return headers

    def _load_web_config(self) -> None:
        if self._web_remix_client is not None:
            return
        request = Request(ORIGIN_YOUTUBE_MUSIC, headers={"User-Agent": USER_AGENT_WEB, "Referer": REFERER_YOUTUBE_MUSIC}, method="GET")
        try:
            with self._opener.open(request, timeout=self.timeout) as response:
                html = response.read().decode("utf-8", errors="replace")
            ytcfg = re.search(r"ytcfg\.set\(({.+?})\);", html)
            config = json.loads(ytcfg.group(1)) if ytcfg else {}
            context = config.get("INNERTUBE_CONTEXT")
            if isinstance(context, dict):
                self._web_context = context
                visitor_data = (context.get("client") or {}).get("visitorData")
                if isinstance(visitor_data, str):
                    self.visitor_data = visitor_data
            api_key = config.get("INNERTUBE_API_KEY")
            if isinstance(api_key, str):
                self._api_key = api_key
            version = config.get("INNERTUBE_CONTEXT_CLIENT_VERSION")
            if not version:
                version_match = re.search(r'"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"', html)
                version = version_match.group(1) if version_match else None
            self._web_remix_client = replace(WEB_REMIX, client_version=version) if isinstance(version, str) else WEB_REMIX
        except Exception:
            self._web_remix_client = WEB_REMIX


class YouTubeMusicClient:
    def __init__(self, session: InnerTubeSession | None = None) -> None:
        self.session = session or InnerTubeSession()

    def home(self, *, continuation: str | None = None, params: str | None = None) -> HomePage:
        raw = self.session.browse(browse_id=None if continuation else "FEmusic_home", params=params, continuation=continuation)
        return parse_home(raw)

    def search(self, query: str, *, params: str | None = None, continuation: str | None = None) -> InnertubeSearchResult:
        raw = self.session.search(query if continuation is None else None, params=params, continuation=continuation)
        return parse_search(raw)

    async def search_async(self, query: str, *, params: str | None = None, continuation: str | None = None) -> InnertubeSearchResult:
        raw = await self.session.search_async(query if continuation is None else None, params=params, continuation=continuation)
        return parse_search(raw)

    def playback(self, video_id: str, *, playlist_id: str | None = None, quality: str = "auto") -> PlaybackData:
        clients = (self.session.web_remix_client(), VISIONOS, IOS, ANDROID, WEB)
        last_status: dict[str, Any] | None = None
        for yt_client in clients:
            if yt_client.login_required and not self.session.cookie:
                continue
            try:
                response = self.session.player(video_id, playlist_id=playlist_id, client=yt_client)
            except Exception:
                continue
            status = response.get("playabilityStatus") or {}
            last_status = status
            if status.get("status") != "OK":
                continue
            selected = select_audio_format(response, quality=quality)
            if not selected:
                continue
            url = selected.get("url") or decipher_signature_cipher(selected)
            if not url:
                continue
            headers = self.session.stream_request_headers(yt_client)
            content_length = int(selected.get("contentLength") or selected.get("clen") or 0)
            if not validate_stream_spans(url, headers, content_length=content_length, timeout=self.session.timeout):
                continue
            details = response.get("videoDetails") or {}
            return PlaybackData(
                video_id=video_id,
                title=details.get("title"),
                author=details.get("author"),
                stream_url=url,
                expires_in_seconds=int((response.get("streamingData") or {}).get("expiresInSeconds") or 0),
                client_name=yt_client.client_name,
                format=selected,
                request_headers=headers,
                video_details=details,
                playability_status=status,
            )
        ytdlp = self.playback_with_ytdlp(video_id, quality=quality)
        if ytdlp is not None:
            return ytdlp
        reason = (last_status or {}).get("reason") or (last_status or {}).get("status") or "no playable direct audio format"
        raise RuntimeError(f"Could not resolve playback stream for {video_id}: {reason}")

    def playback_with_ytdlp(self, video_id: str, *, quality: str = "auto") -> PlaybackData | None:
        try:
            import yt_dlp
        except Exception:
            return None
        options = {
            "quiet": True,
            "no_warnings": True,
            "noplaylist": True,
            "format": "bestaudio[ext=webm]/bestaudio/best" if quality != "low" else "worstaudio/bestaudio/best",
        }
        try:
            with yt_dlp.YoutubeDL(options) as ydl:
                info = ydl.extract_info(f"https://music.youtube.com/watch?v={video_id}", download=False)
        except Exception:
            return None
        selected = info if info.get("url") else select_ytdlp_audio_format(info.get("formats") or [], quality=quality)
        if not selected or not selected.get("url"):
            return None
        headers = dict(info.get("http_headers") or {})
        headers.update(selected.get("http_headers") or {})
        headers.setdefault("Accept-Encoding", "identity")
        content_length = int(selected.get("filesize") or selected.get("filesize_approx") or 0)
        if not validate_stream_spans(selected["url"], headers, content_length=content_length, timeout=self.session.timeout):
            return None
        mime_type = selected.get("mime_type") or f"audio/{selected.get('ext') or 'webm'}"
        return PlaybackData(
            video_id=video_id,
            title=info.get("title"),
            author=info.get("uploader") or info.get("channel"),
            stream_url=selected["url"],
            expires_in_seconds=6 * 60 * 60,
            client_name="yt-dlp",
            format={
                "itag": int(selected.get("format_id") or selected.get("itag") or 0),
                "url": selected["url"],
                "mimeType": mime_type,
                "bitrate": int(float(selected.get("abr") or 0) * 1000) if selected.get("abr") else int(selected.get("tbr") or 0),
                "contentLength": content_length,
                "audioQuality": selected.get("format_note"),
                "audioSampleRate": selected.get("asr"),
                "audioChannels": selected.get("audio_channels"),
                "quality": selected.get("quality"),
            },
            request_headers=headers,
            video_details={"videoId": video_id, "title": info.get("title"), "author": info.get("uploader") or info.get("channel")},
            playability_status={"status": "OK"},
        )


class YouTubeMusicService:
    def __init__(self) -> None:
        self.client = YouTubeMusicClient(InnerTubeSession(gl="US", hl="en-US"))
        self.home_client = self.client
        self.global_chart_client = YouTubeMusicClient(InnerTubeSession(gl="US", hl="en-US"))
        self.india_chart_client = YouTubeMusicClient(InnerTubeSession(gl="IN", hl="en-IN"))
        self.india_explore_client = YouTubeMusicClient(InnerTubeSession(gl="IN", hl="en-IN"))
        self.related_client = YouTubeMusicClient(InnerTubeSession(gl="US", hl="en-US"))
        # Kept as a compatibility alias for callers that previously replaced this client.
        self.india_client = self.india_chart_client
        self._search_cache: dict[tuple[str, str, str | None], tuple[float, OnlineSearchResponse]] = {}
        self._home_cache: tuple[float, OnlineHomeResponse] | None = None
        self._related_cache: dict[str, tuple[float, OnlineRelatedResponse]] = {}
        self._home_refresh_lock = asyncio.Lock()
        self.search_cache_ttl_seconds = 120.0
        self.home_cache_ttl_seconds = 600.0
        self.related_cache_ttl_seconds = 300.0
        # Resolving a stream costs a player call plus validation range requests
        # (or a slow yt-dlp fallback). The audio element issues a new range
        # request on every seek, so reuse a resolved URL while it stays valid.
        self._playback_cache: dict[tuple[str, str], tuple[float, PlaybackData]] = {}
        self._playback_cache_lock = threading.Lock()
        self.playback_cache_ttl_seconds = 1800.0
        self.playback_cache_max_entries = 64

    async def home(self) -> OnlineHomeResponse:
        now = time.monotonic()
        if self._home_cache and self._home_cache[0] > now:
            logger.info("YouTube Music home cache hit", extra={"source": "home", "cache_state": "hit"})
            return self._home_cache[1]
        async with self._home_refresh_lock:
            now = time.monotonic()
            if self._home_cache and self._home_cache[0] > now:
                logger.info("YouTube Music home cache hit after lock", extra={"source": "home", "cache_state": "hit"})
                return self._home_cache[1]

            previous = self._home_cache[1] if self._home_cache else None
            logger.info("Refreshing YouTube Music home", extra={"source": "home", "cache_state": "refresh"})
            provider_result, global_result, india_result, albums_result = await asyncio.gather(
                self._load_home_source("provider home", "US", self._provider_home_sync),
                self._load_home_source("Global chart", "ZZ", self._global_chart_sync),
                self._load_home_source("India chart", "IN", self._india_chart_sync),
                self._load_home_source("India Explore", "IN", self._india_explore_sync),
            )

            if (global_result[1] or india_result[1]) and previous and self._has_complete_charts(previous):
                logger.warning(
                    "YouTube Music chart refresh failed; returning stale complete home",
                    extra={"source": "home", "cache_state": "stale_fallback"},
                )
                self._home_cache = (now + self.home_cache_ttl_seconds, previous)
                return previous

            response = self._assemble_home(
                provider_result[0],
                global_result[0],
                india_result[0],
                albums_result[0],
            )
            self._home_cache = (now + self.home_cache_ttl_seconds, response)
            return response

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
            raise AppError("YouTube Music related recommendations failed. Please try again.") from exc

        response = OnlineRelatedResponse(seed_video_id=video_id, items=[self._item_to_schema(item) for item in items[:20]])
        logger.info(
            "Parsed YouTube Music related recommendations",
            extra={"source": "Related", "country": "US", "item_count": len(response.items)},
        )
        if response.items:
            if len(self._related_cache) >= 128:
                self._related_cache.clear()
            self._related_cache[video_id] = (now + self.related_cache_ttl_seconds, response)
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

    async def search(self, query: str, *, filter_name: str = "all", continuation: str | None = None) -> OnlineSearchResponse:
        filter_key = filter_name if filter_name in SEARCH_FILTERS else "all"
        cache_key = (query.strip().casefold(), filter_key, continuation)
        now = time.monotonic()
        cached = self._search_cache.get(cache_key)
        if cached and cached[0] > now:
            return cached[1]
        try:
            raw = await self.client.search_async(query, params=SEARCH_FILTERS[filter_key], continuation=continuation)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("Innertube search failed")
            raise AppError("YouTube Music search failed. Please try a different query.") from exc
        response = OnlineSearchResponse(
            query=query,
            filter=filter_key,
            items=[self._item_to_schema(item) for item in raw.items],
            continuation=raw.continuation,
        )
        if len(self._search_cache) >= 256:
            self._search_cache.clear()
        self._search_cache[cache_key] = (now + self.search_cache_ttl_seconds, response)
        return response

    async def album(self, browse_id: str) -> OnlineAlbumPreview:
        return await asyncio.to_thread(self._album_sync, browse_id)

    async def artist(self, browse_id: str) -> dict[str, Any]:
        return await asyncio.to_thread(self._artist_sync, browse_id)

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
                    expired = [entry for entry, (expires_at, _) in self._playback_cache.items() if expires_at <= now]
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
            player = self.client.session.player(video_id, client=self.client.session.web_remix_client())
            return _thumbnail(player)
        except Exception:
            logger.debug("Innertube artwork lookup failed", extra={"video_id": video_id}, exc_info=True)
            return None

    def _lyrics_sync(self, video_id: str) -> str | None:
        try:
            raw_next = self.client.session.next(video_id=video_id, client=self.client.session.web_remix_client())
            browse_id = self._find_lyrics_browse_id(raw_next)
            if not browse_id:
                return None
            raw_lyrics = self.client.session.browse(client=self.client.session.web_remix_client(), browse_id=browse_id)
            lines = self._extract_lyrics_lines(raw_lyrics)
            return "\n".join(lines) if lines else None
        except Exception:
            logger.debug("Innertube lyrics lookup failed", extra={"video_id": video_id}, exc_info=True)
            return None

    def _provider_home_sync(self) -> HomePage:
        home = self.home_client.home()
        quick_shelf = _find_provider_quick_picks(home.sections)
        if quick_shelf:
            self._hydrate_missing_durations(self.home_client, quick_shelf.items, limit=8)
        logger.info(
            "Parsed YouTube Music provider home",
            extra={"source": "provider home", "country": "US", "item_count": sum(len(section.items) for section in home.sections)},
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

    def _india_chart_sync(self) -> tuple[str, str, list[YTItem]]:
        return self._chart_sync(
            self.india_chart_client,
            country="IN",
            preferences=(
                ("trending 20", "india"),
                ("daily top music videos", "india"),
                ("top 100 music videos", "india"),
            ),
            source="India chart",
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
        video_charts = _extract_video_charts_section(raw_charts)
        if video_charts is None:
            raise RuntimeError("Video charts shelf was not present")
        selected = _select_chart_playlist(video_charts, preferences)
        if selected is None:
            raise RuntimeError("Video charts did not contain a browseable playlist")
        playlist_id = _normalize_chart_browse_id(_browse_id(selected.endpoint) or _playlist_id(selected.endpoint) or selected.id)
        raw_playlist = client.session.browse(client=client.session.web_remix_client(), browse_id=playlist_id)
        items = _parse_chart_tracks(raw_playlist)[:20]
        if not items:
            raise RuntimeError(f"Selected chart playlist {playlist_id} contained no playable tracks")
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

    def _india_explore_sync(self) -> list[YTItem]:
        client = self.india_explore_client
        raw_explore = client.session.browse(client=client.session.web_remix_client(), browse_id="FEmusic_explore")
        items = _extract_explore_albums(raw_explore)[:12]
        logger.info(
            "Parsed YouTube Music India Explore albums",
            extra={"source": "India Explore", "country": "IN", "item_count": len(items)},
        )
        return items

    def _related_sync(self, video_id: str) -> list[YTItem]:
        client = self.related_client
        raw_next = client.session.next(video_id=video_id, client=client.session.web_remix_client())
        browse_id = _extract_related_browse_id(raw_next)
        if not browse_id:
            return []
        raw_related = client.session.browse(client=client.session.web_remix_client(), browse_id=browse_id)
        items = _select_related_song_items(raw_related, seed_video_id=video_id)[:20]
        self._hydrate_missing_durations(client, items, limit=8)
        return items

    def _hydrate_missing_durations(self, client: YouTubeMusicClient, items: list[YTItem], *, limit: int) -> None:
        hydrated = 0
        for item in items[:limit]:
            if item.duration_seconds is not None or item.kind != "song" or not item.id:
                continue
            try:
                raw_player = client.session.player(item.id, client=client.session.web_remix_client())
                length = (raw_player.get("videoDetails") or {}).get("lengthSeconds")
                duration = int(length) if length is not None else 0
                if duration > 0:
                    item.duration_seconds = duration
                    hydrated += 1
            except Exception:
                logger.debug("YouTube Music duration hydration failed", extra={"source": "duration"}, exc_info=True)
        if hydrated:
            logger.info(
                "Hydrated YouTube Music shelf durations",
                extra={"source": "duration", "item_count": hydrated},
            )

    def _assemble_home(
        self,
        provider_home: HomePage | None,
        global_chart: tuple[str, str, list[YTItem]] | None,
        india_chart: tuple[str, str, list[YTItem]] | None,
        explore_albums: list[YTItem] | None,
    ) -> OnlineHomeResponse:
        provider_sections = provider_home.sections if provider_home else []
        quick_shelf = _find_provider_quick_picks(provider_sections)
        global_items = global_chart[2] if global_chart else []

        today_items = _playable_tracks(quick_shelf.items if quick_shelf else [])
        if not today_items:
            for shelf in provider_sections:
                if shelf is quick_shelf:
                    continue
                today_items = _playable_tracks(shelf.items)
                if today_items:
                    break
        if not today_items:
            today_items = global_items

        sections: list[OnlineHomeSection] = []
        if today_items:
            sections.append(
                OnlineHomeSection(
                    id="today-picks",
                    title="Today's Pick",
                    subtitle="Ready to play",
                    layout="hero",
                    items=[self._item_to_schema(item) for item in today_items[:5]],
                )
            )
        quick_items = _playable_tracks(quick_shelf.items if quick_shelf else [])
        if quick_items:
            sections.append(
                OnlineHomeSection(
                    id="quick-picks",
                    title="Quick Picks",
                    subtitle=quick_shelf.label,
                    layout="quick_grid",
                    items=[self._item_to_schema(item) for item in quick_items[:20]],
                )
            )
        if global_chart:
            sections.append(
                OnlineHomeSection(
                    id="global-trending",
                    title="Trending Globally",
                    subtitle=global_chart[0],
                    layout="song_list",
                    items=[self._item_to_schema(item) for item in global_items[:20]],
                )
            )
        if explore_albums:
            sections.append(
                OnlineHomeSection(
                    id="trending-albums",
                    title="Trending Albums",
                    subtitle="New albums & singles from YouTube Music India.",
                    layout="album_grid",
                    items=[self._item_to_schema(item) for item in explore_albums[:12]],
                )
            )
        if india_chart:
            sections.append(
                OnlineHomeSection(
                    id="india-pulse",
                    title="India Pulse",
                    subtitle=india_chart[0],
                    layout="song_list",
                    items=[self._item_to_schema(item) for item in india_chart[2][:20]],
                )
            )
        return OnlineHomeResponse(region="GLOBAL", chips=[], sections=sections)

    def _has_complete_charts(self, response: OnlineHomeResponse) -> bool:
        section_ids = {section.id for section in response.sections}
        return {"global-trending", "india-pulse"}.issubset(section_ids)

    def _clear_expired_related_cache(self, now: float) -> None:
        expired = [key for key, (expires_at, _) in self._related_cache.items() if expires_at <= now]
        for key in expired:
            self._related_cache.pop(key, None)

    def _album_sync(self, browse_id: str) -> OnlineAlbumPreview:
        try:
            raw = self.client.session.browse(client=self.client.session.web_remix_client(), browse_id=browse_id)
        except Exception as exc:
            logger.exception("Innertube album browse failed")
            raise AppError("YouTube Music album failed. Please try again.") from exc

        parsed_items: list[YTItem] = []
        seen: set[str] = set()
        for key in ("musicResponsiveListItemRenderer", "musicTwoRowItemRenderer", "musicCardShelfRenderer"):
            for renderer in _walk_renderers(raw, key):
                item = _item_from_renderer({key: renderer})
                if not item or item.kind not in {"song", "episode"} or not item.id:
                    continue
                if item.id in seen:
                    continue
                seen.add(item.id)
                parsed_items.append(item)

        album_title = self._album_title_from_raw(raw) or (parsed_items[0].album.name if parsed_items and parsed_items[0].album else "Album")
        album_art = self._album_art_from_raw(raw) or (parsed_items[0].thumbnail if parsed_items else None)
        artist_name, artist_id = self._album_artist_from_raw(raw)
        if not artist_name:
            artist_name, artist_id = self._album_artist_from_items(parsed_items)
        year = self._album_year_from_raw(raw)

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
            raw = self.client.session.browse(client=self.client.session.web_remix_client(), browse_id=browse_id)
        except Exception as exc:
            logger.exception("Innertube artist browse failed")
            raise AppError("YouTube Music artist failed. Please try again.") from exc

        name = self._album_title_from_raw(raw) or "Artist"
        thumbnail = _thumbnail(raw)
        items: list[OnlineMusicItem] = []
        seen: set[tuple[str, str]] = set()
        for key in ("musicResponsiveListItemRenderer", "musicTwoRowItemRenderer", "musicCardShelfRenderer"):
            for renderer in _walk_renderers(raw, key):
                item = _item_from_renderer({key: renderer})
                if not item or not item.id:
                    continue
                dedupe_key = (item.kind, item.id)
                if dedupe_key in seen:
                    continue
                seen.add(dedupe_key)
                items.append(self._item_to_schema(item))

        return {
            "source": "youtube",
            "external_id": browse_id,
            "name": name,
            "thumbnail_url": thumbnail,
            "tracks": [item for item in items if item.playable],
            "albums": [item for item in items if item.kind == "album"],
        }

    def _item_to_schema(self, item: YTItem) -> OnlineMusicItem:
        artist_models = [OnlineArtist(id=artist.id, name=artist.name) for artist in item.artists]
        album_model = OnlineAlbum(id=item.album.id, name=item.album.name) if item.album else None
        endpoint = item.endpoint if isinstance(item.endpoint, dict) else None
        browse_id = self._extract_browse_id(endpoint) or (item.id if item.kind in {"album", "artist", "playlist", "podcast"} else None)
        playlist_id = self._extract_playlist_id(endpoint) or (item.id if item.kind == "playlist" else None)
        return OnlineMusicItem(
            kind="video" if self._looks_like_video(item) else item.kind,
            id=item.id,
            title=item.title,
            subtitle=self._subtitle(item),
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

    def _subtitle(self, item: YTItem) -> str | None:
        parts = [artist.name for artist in item.artists]
        if item.album:
            parts.append(item.album.name)
        if item.duration_seconds:
            minutes, seconds = divmod(item.duration_seconds, 60)
            parts.append(f"{minutes}:{seconds:02d}")
        return " - ".join(part for part in parts if part) or None

    def _looks_like_video(self, item: YTItem) -> bool:
        music_type = ((item.endpoint or {}).get("watchEndpointMusicSupportedConfigs") or {}).get("watchEndpointMusicConfig", {}).get("musicVideoType")
        return item.kind == "song" and music_type not in {None, "MUSIC_VIDEO_TYPE_ATV"}

    def _extract_browse_id(self, endpoint: dict[str, Any] | None) -> str | None:
        if not endpoint:
            return None
        return (endpoint.get("browseEndpoint") or {}).get("browseId") or endpoint.get("browseId")

    def _extract_playlist_id(self, endpoint: dict[str, Any] | None) -> str | None:
        if not endpoint:
            return None
        return (
            (endpoint.get("watchEndpoint") or {}).get("playlistId")
            or (endpoint.get("watchPlaylistEndpoint") or {}).get("playlistId")
            or endpoint.get("playlistId")
        )

    def _album_title_from_raw(self, raw: dict[str, Any]) -> str | None:
        for key in ("musicDetailHeaderRenderer", "musicResponsiveHeaderRenderer", "musicEditablePlaylistDetailHeaderRenderer"):
            for renderer in _walk_renderers(raw, key):
                title = _header_title(renderer.get("title")) or _runs_text(renderer.get("title"))
                if title:
                    return title
        return None

    def _album_art_from_raw(self, raw: dict[str, Any]) -> str | None:
        return _thumbnail(raw)

    def _album_artist_from_raw(self, raw: dict[str, Any]) -> tuple[str | None, str | None]:
        for renderer in _walk_renderers(raw, "musicResponsiveHeaderRenderer"):
            for key in ("straplineTextOne", "straplineTextTwo"):
                for run in _runs(renderer.get(key)):
                    name = (run.get("text") or "").strip()
                    browse_id = _browse_id(run.get("navigationEndpoint"))
                    if name and not _looks_like_metric_text(name):
                        return name, browse_id
        return None, None

    def _album_artist_from_items(self, items: list[YTItem]) -> tuple[str | None, str | None]:
        for item in items:
            if item.artists:
                return item.artists[0].name, item.artists[0].id
        return None, None

    def _album_year_from_raw(self, raw: dict[str, Any]) -> int | None:
        for text in self._walk_strings(raw):
            match = re.fullmatch(r"(19|20)\d{2}", text.strip())
            if match:
                try:
                    return int(text.strip())
                except ValueError:
                    return None
        return None

    def _find_lyrics_browse_id(self, value: Any) -> str | None:
        if isinstance(value, dict):
            endpoint = value.get("browseEndpoint")
            if isinstance(endpoint, dict):
                browse_id = endpoint.get("browseId")
                text = " ".join(self._walk_strings(value)).lower()
                if isinstance(browse_id, str) and ("lyrics" in text or browse_id.startswith("MPLYt")):
                    return browse_id
            for item in value.values():
                found = self._find_lyrics_browse_id(item)
                if found:
                    return found
        elif isinstance(value, list):
            for item in value:
                found = self._find_lyrics_browse_id(item)
                if found:
                    return found
        return None

    def _extract_lyrics_lines(self, value: Any) -> list[str]:
        raw_lines: list[str] = []

        def visit(node: Any) -> None:
            if isinstance(node, dict):
                runs = node.get("runs")
                if isinstance(runs, list):
                    text = "".join(run.get("text", "") for run in runs if isinstance(run, dict)).strip()
                    if text:
                        raw_lines.extend(line.strip() for line in text.splitlines() if line.strip())
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

    def _walk_strings(self, value: Any):
        if isinstance(value, str):
            yield value
        elif isinstance(value, dict):
            for item in value.values():
                yield from self._walk_strings(item)
        elif isinstance(value, list):
            for item in value:
                yield from self._walk_strings(item)

def _normalized_title(value: str) -> str:
    return " ".join(value.casefold().split())


def _playable_tracks(items: list[YTItem]) -> list[YTItem]:
    result: list[YTItem] = []
    seen: set[str] = set()
    for item in items:
        if item.kind != "song" or not item.id or item.id in seen:
            continue
        seen.add(item.id)
        result.append(item)
    return result


def _find_provider_quick_picks(sections: list[HomeSection]) -> HomeSection | None:
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
    return _header_title(renderer.get("header")) or _header_title(renderer.get("title")) or ""


def _ordered_renderer_items(value: Any):
    if isinstance(value, dict):
        for key in ("musicResponsiveListItemRenderer", "musicTwoRowItemRenderer", "musicCardShelfRenderer"):
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
    return [item for wrapped in _ordered_renderer_items(contents) if (item := _item_from_renderer(wrapped))]


def _extract_video_charts_section(raw: dict[str, Any]) -> dict[str, Any] | None:
    return next(
        (renderer for renderer in _iter_shelf_renderers(raw) if "video charts" in _normalized_title(_shelf_title(renderer))),
        None,
    )


def _select_chart_playlist(
    video_charts: dict[str, Any],
    preferences: tuple[tuple[str, ...], ...],
) -> YTItem | None:
    candidates = [
        item
        for item in _items_from_shelf(video_charts)
        if _browse_id(item.endpoint) or _playlist_id(item.endpoint)
    ]
    for terms in preferences:
        match = next(
            (item for item in candidates if all(term in _normalized_title(item.title) for term in terms)),
            None,
        )
        if match:
            return match
    return candidates[0] if candidates else None


def _normalize_chart_browse_id(playlist_id: str) -> str:
    return playlist_id if playlist_id.startswith("VL") else f"VL{playlist_id}"


def _parse_chart_tracks(raw: dict[str, Any]) -> list[YTItem]:
    return _playable_tracks(
        [item for wrapped in _ordered_renderer_items(raw) if (item := _item_from_renderer(wrapped))]
    )


def _extract_explore_albums(raw: dict[str, Any]) -> list[YTItem]:
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
        browse_id = _browse_id(item.endpoint)
        if item.kind != "album" or not browse_id or not browse_id.startswith("MPREb") or browse_id in seen:
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


def _extract_related_browse_id(raw_next: dict[str, Any]) -> str | None:
    tabs = list(_walk_renderers(raw_next, "tabRenderer"))
    related = next((tab for tab in tabs if _page_type(tab) == "MUSIC_PAGE_TYPE_TRACK_RELATED"), None)
    if related is None:
        related = next(
            (
                tab
                for tab in tabs
                if "related" in _normalized_title(
                    tab.get("title") if isinstance(tab.get("title"), str) else _runs_text(tab.get("title"))
                )
            ),
            None,
        )
    if related is None:
        return None
    endpoint = related.get("endpoint") or related.get("navigationEndpoint") or _find_endpoint(related)
    browse_id = _browse_id(endpoint)
    return browse_id if browse_id and browse_id.startswith("MPTR") else None


def _select_related_song_items(raw: dict[str, Any], *, seed_video_id: str) -> list[YTItem]:
    song_shelves: list[tuple[str, list[YTItem]]] = []
    for renderer in _iter_shelf_renderers(raw):
        parsed = _items_from_shelf(renderer)
        if not parsed or any(item.kind != "song" for item in parsed):
            continue
        song_shelves.append((_shelf_title(renderer), parsed))
    if not song_shelves:
        return []
    selected = next(
        (items for title, items in song_shelves if "you might also like" in _normalized_title(title)),
        song_shelves[0][1],
    )
    return [item for item in _playable_tracks(selected) if item.id != seed_video_id][:20]


def parse_home(raw: dict[str, Any]) -> HomePage:
    chips = [
        HomeChip(title=text, endpoint=chip.get("navigationEndpoint"))
        for chip in _walk_renderers(raw, "chipCloudChipRenderer")
        if (text := _runs_text(chip.get("text")))
    ]
    sections: list[HomeSection] = []

    for renderer in _walk_renderers(raw, "musicCarouselShelfRenderer"):
        title = _header_title(renderer.get("header")) or "Featured"
        items = [item for item in (_item_from_renderer(child) for child in _renderer_children(renderer.get("contents"))) if item]
        if items:
            sections.append(HomeSection(title=title, label=None, thumbnail=items[0].thumbnail, endpoint=renderer.get("navigationEndpoint"), items=items))

    for renderer in _walk_renderers(raw, "musicShelfRenderer"):
        title = _header_title(renderer.get("title")) or _header_title(renderer.get("header")) or "Songs"
        items = [item for item in (_item_from_renderer(child) for child in _renderer_children(renderer.get("contents"))) if item]
        if items:
            sections.append(HomeSection(title=title, label=None, thumbnail=items[0].thumbnail, endpoint=renderer.get("navigationEndpoint"), items=items))

    return HomePage(chips=chips, sections=_dedupe_sections(sections), continuation=_find_continuation(raw))


def parse_search(raw: dict[str, Any]) -> InnertubeSearchResult:
    items: list[YTItem] = []
    seen: set[tuple[str, str]] = set()
    for key in ("musicCardShelfRenderer", "musicResponsiveListItemRenderer", "musicTwoRowItemRenderer"):
        for renderer in _walk_renderers(raw, key):
            item = _item_from_renderer({key: renderer})
            if not item:
                continue
            dedupe_key = (item.kind, item.id or item.title)
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            items.append(item)
    return InnertubeSearchResult(items=items, continuation=_find_continuation(raw))


def _item_from_renderer(value: Any) -> YTItem | None:
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
        _runs((column.get("musicResponsiveListItemFlexColumnRenderer") or {}).get("text"))
        for column in renderer.get("flexColumns") or []
    ]
    columns = [column for column in columns if column]
    if not columns:
        return None
    title = _runs_text_from_runs(columns[0])
    endpoint = renderer.get("navigationEndpoint") or _first_endpoint(columns[0]) or _find_endpoint(renderer)
    video_id = _video_id(endpoint)
    browse_id = _browse_id(endpoint)
    playlist_id = _playlist_id(endpoint)
    subtitle_runs = [run for column in columns[1:] for run in column]
    subtitle_texts = [run.get("text", "").strip() for run in subtitle_runs if run.get("text", "").strip() and run.get("text", "").strip() not in {"•", "·"}]
    kind = _kind_from_endpoint(endpoint, title, subtitle_texts)
    item_id = video_id or browse_id or playlist_id or _stable_id(title)
    artists = _artist_refs(subtitle_runs)
    album = _album_ref(subtitle_runs)
    if not artists and subtitle_texts and kind in {"song", "episode"}:
        fallback_artist = next((text for text in subtitle_texts if not _looks_like_metric_text(text)), None)
        if fallback_artist:
            artists = [ArtistRef(name=fallback_artist)]
    return YTItem(
        kind=kind,
        id=item_id,
        title=title,
        thumbnail=_thumbnail(renderer),
        explicit=_has_explicit_badge(renderer),
        artists=artists,
        album=album,
        duration_seconds=_duration_from_renderer(renderer, subtitle_texts),
        endpoint=endpoint,
        raw=renderer,
    )


def _two_row_item(renderer: dict[str, Any]) -> YTItem | None:
    title = _runs_text(renderer.get("title"))
    if not title:
        return None
    subtitle_runs = _runs(renderer.get("subtitle"))
    subtitle_texts = [run.get("text", "").strip() for run in subtitle_runs if run.get("text", "").strip() and run.get("text", "").strip() not in {"•", "·"}]
    endpoint = renderer.get("navigationEndpoint") or _first_endpoint(_runs(renderer.get("title"))) or _find_endpoint(renderer)
    video_id = _video_id(endpoint)
    browse_id = _browse_id(endpoint)
    playlist_id = _playlist_id(endpoint)
    kind = _kind_from_endpoint(endpoint, title, subtitle_texts)
    item_id = video_id or browse_id or playlist_id or _stable_id(title)
    return YTItem(
        kind=kind,
        id=item_id,
        title=title,
        thumbnail=_thumbnail(renderer),
        explicit=_has_explicit_badge(renderer),
        artists=_artist_refs(subtitle_runs),
        album=_album_ref(subtitle_runs),
        duration_seconds=_duration_from_renderer(renderer, subtitle_texts),
        endpoint=endpoint,
        raw=renderer,
    )


def _card_item(renderer: dict[str, Any]) -> YTItem | None:
    title = _runs_text(renderer.get("title"))
    if not title:
        return None
    subtitle_runs = _runs(renderer.get("subtitle"))
    endpoint = renderer.get("navigationEndpoint") or _find_endpoint(renderer)
    return YTItem(
        kind=_kind_from_endpoint(endpoint, title, [run.get("text", "") for run in subtitle_runs]),
        id=_video_id(endpoint) or _browse_id(endpoint) or _playlist_id(endpoint) or _stable_id(title),
        title=title,
        thumbnail=_thumbnail(renderer),
        artists=_artist_refs(subtitle_runs),
        album=_album_ref(subtitle_runs),
        duration_seconds=_duration_from_renderer(renderer, [run.get("text", "") for run in subtitle_runs]),
        endpoint=endpoint,
        raw=renderer,
    )


def _kind_from_endpoint(endpoint: dict[str, Any] | None, title: str, subtitle_texts: list[str]) -> ItemKind:
    if _video_id(endpoint):
        text = " ".join(subtitle_texts).lower()
        return "episode" if "podcast" in text or "episode" in text else "song"
    browse_id = _browse_id(endpoint) or ""
    playlist_id = _playlist_id(endpoint) or ""
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
        browse_id = _browse_id(endpoint)
        if not text or text in {"•", "·"} or _looks_like_metric_text(text):
            continue
        if browse_id and (browse_id.startswith("UC") or browse_id.startswith("MPLA")):
            result.append(ArtistRef(name=text, id=browse_id))
    return result[:4]


def _looks_like_metric_text(text: str) -> bool:
    normalized = text.strip().lower()
    return bool(
        re.search(r"\b(?:plays?|views?|songs?|minutes?|hours?)\b", normalized)
        or re.fullmatch(r"\d{4}", normalized)
        or normalized in {"song", "songs", "album", "single", "ep", "playlist", "video"}
    )


def _album_ref(runs: list[dict[str, Any]]) -> AlbumRef | None:
    for run in runs:
        text = run.get("text", "").strip()
        browse_id = _browse_id(run.get("navigationEndpoint"))
        if text and browse_id and browse_id.startswith("MPREb"):
            return AlbumRef(name=text, id=browse_id)
    return None


def _runs(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, dict):
        return []
    runs = value.get("runs")
    if isinstance(runs, list):
        return [run for run in runs if isinstance(run, dict)]
    simple_text = value.get("simpleText")
    return [{"text": simple_text}] if isinstance(simple_text, str) else []


def _runs_text(value: Any) -> str:
    return _runs_text_from_runs(_runs(value))


def _runs_text_from_runs(runs: list[dict[str, Any]]) -> str:
    return "".join(run.get("text", "") for run in runs).strip()


def _header_title(value: Any) -> str | None:
    if isinstance(value, dict):
        text = _runs_text(value)
        if text:
            return text
        for item in value.values():
            found = _header_title(item)
            if found:
                return found
    elif isinstance(value, list):
        for item in value:
            found = _header_title(item)
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
    if any(key in value for key in ("musicResponsiveListItemRenderer", "musicTwoRowItemRenderer", "musicCardShelfRenderer")):
        return value
    if "item" in value and isinstance(value["item"], dict):
        return _unwrap_renderer(value["item"])
    return value


def _walk_renderers(value: Any, renderer_key: str):
    if isinstance(value, dict):
        renderer = value.get(renderer_key)
        if isinstance(renderer, dict):
            yield renderer
        for item in value.values():
            yield from _walk_renderers(item, renderer_key)
    elif isinstance(value, list):
        for item in value:
            yield from _walk_renderers(item, renderer_key)


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
    return (endpoint.get("watchEndpoint") or {}).get("videoId") or endpoint.get("videoId")


def _browse_id(endpoint: dict[str, Any] | None) -> str | None:
    if not endpoint:
        return None
    return (endpoint.get("browseEndpoint") or {}).get("browseId") or endpoint.get("browseId")


def _playlist_id(endpoint: dict[str, Any] | None) -> str | None:
    if not endpoint:
        return None
    return (
        (endpoint.get("watchEndpoint") or {}).get("playlistId")
        or (endpoint.get("watchPlaylistEndpoint") or {}).get("playlistId")
        or endpoint.get("playlistId")
    )


def _thumbnail(value: Any) -> str | None:
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
        duration_texts.append(_runs_text(fixed.get("text")))
    for overlay in _walk_renderers(renderer, "thumbnailOverlayTimeStatusRenderer"):
        duration_texts.append(_runs_text(overlay.get("text")))
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


def select_audio_format(player_response: dict[str, Any], *, quality: str = "auto") -> dict[str, Any] | None:
    formats = (player_response.get("streamingData") or {}).get("adaptiveFormats") or []
    audio_formats = [fmt for fmt in formats if fmt.get("width") is None and fmt.get("mimeType")]
    if not audio_formats:
        return None

    def codec_score(fmt: dict[str, Any]) -> int:
        mime = fmt.get("mimeType") or ""
        if "opus" in mime:
            return 2
        if "mp4a" in mime:
            return 1
        return 0

    def quality_score(fmt: dict[str, Any]) -> int:
        return {"AUDIO_QUALITY_HIGH": 3, "AUDIO_QUALITY_MEDIUM": 2, "AUDIO_QUALITY_LOW": 1}.get(fmt.get("audioQuality"), 0)

    if quality == "low":
        capped = [fmt for fmt in audio_formats if int(fmt.get("bitrate") or 0) <= 128_000]
        return max(capped or audio_formats, key=lambda fmt: (int(fmt.get("bitrate") or 0), codec_score(fmt)))
    if quality == "high":
        return max(audio_formats, key=lambda fmt: (quality_score(fmt), int(fmt.get("audioChannels") or 2), codec_score(fmt), int(fmt.get("bitrate") or 0)))
    return max(audio_formats, key=lambda fmt: (int(fmt.get("bitrate") or 0), codec_score(fmt)))


def decipher_signature_cipher(format_data: dict[str, Any]) -> str | None:
    cipher = format_data.get("signatureCipher") or format_data.get("cipher")
    if not cipher:
        return None
    parsed = parse_qs(cipher)
    url = (parsed.get("url") or [None])[0]
    signature = (parsed.get("sig") or parsed.get("signature") or [None])[0]
    sp = (parsed.get("sp") or ["signature"])[0]
    if url and signature:
        separator = "&" if urlparse(url).query else "?"
        return f"{url}{separator}{sp}={signature}"
    return url


def validate_stream_url(url: str, headers: dict[str, str], *, timeout: float = 10.0) -> bool:
    request = Request(url, headers={**headers, "Range": "bytes=0-1"}, method="GET")
    try:
        with build_opener().open(request, timeout=timeout) as response:
            return response.status in {200, 206}
    except HTTPError as exc:
        return exc.code in {200, 206}
    except (OSError, URLError):
        return False


def validate_stream_spans(url: str, headers: dict[str, str], *, content_length: int, timeout: float = 10.0) -> bool:
    if content_length <= 0:
        return validate_stream_url(url, headers, timeout=timeout)
    starts = [0]
    if content_length > 1_200_000:
        starts.append(1_048_576)
    if content_length > 3_300_000:
        starts.append(3_145_728)
    for start in starts:
        end = min(start + 1, content_length - 1)
        request = Request(url, headers={**headers, "Range": f"bytes={start}-{end}"}, method="GET")
        try:
            with build_opener().open(request, timeout=timeout) as response:
                if response.status not in {200, 206}:
                    return False
                response.read(2)
        except HTTPError as exc:
            if exc.code not in {200, 206}:
                return False
        except (OSError, URLError):
            return False
    return True


def select_ytdlp_audio_format(formats: list[dict[str, Any]], *, quality: str = "auto") -> dict[str, Any] | None:
    audio_formats = [
        fmt for fmt in formats
        if fmt.get("url") and fmt.get("vcodec") in {None, "none"} and fmt.get("acodec") not in {None, "none"}
    ]
    if not audio_formats:
        audio_formats = [fmt for fmt in formats if fmt.get("url") and fmt.get("acodec") not in {None, "none"}]
    if not audio_formats:
        return None

    def score(fmt: dict[str, Any]) -> tuple[float, int]:
        codec = 2 if fmt.get("acodec") == "opus" or fmt.get("ext") == "webm" else 1
        return float(fmt.get("abr") or fmt.get("tbr") or 0), codec

    return min(audio_formats, key=score) if quality == "low" else max(audio_formats, key=score)


def _parse_cookie(cookie: str) -> dict[str, str]:
    result: dict[str, str] = {}
    for part in cookie.split(";"):
        if "=" not in part:
            continue
        key, value = part.strip().split("=", 1)
        result[key] = value
    return result


def _strip_none(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _strip_none(item) for key, item in value.items() if item is not None}
    if isinstance(value, list):
        return [_strip_none(item) for item in value if item is not None]
    return value


ytmusic_service = YouTubeMusicService()
