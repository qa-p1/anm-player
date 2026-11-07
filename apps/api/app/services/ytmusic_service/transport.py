from __future__ import annotations

import asyncio
import hashlib
import json
import re
import time
from dataclasses import dataclass, replace
from typing import Any
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, build_opener

import httpx

API_URL_YOUTUBE_MUSIC = "https://music.youtube.com/youtubei/v1/"
ORIGIN_YOUTUBE_MUSIC = "https://music.youtube.com"
REFERER_YOUTUBE_MUSIC = f"{ORIGIN_YOUTUBE_MUSIC}/"
USER_AGENT_WEB = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0"
)

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


WEB = YouTubeClientConfig("WEB", "2.20260213.00.00", "1", USER_AGENT_WEB)
WEB_REMIX = YouTubeClientConfig(
    "WEB_REMIX", "1.20260213.01.00", "67", USER_AGENT_WEB, login_supported=True
)
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
    def __init__(
        self,
        *,
        gl: str = "US",
        hl: str = "en-US",
        cookie: str | None = None,
        timeout: float = 30.0,
    ) -> None:
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

    def context(
        self, client: YouTubeClientConfig, data_sync_id: str | None = None
    ) -> dict[str, Any]:
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
        return {
            "client": client_context,
            "user": {
                "onBehalfOfUser": data_sync_id if client.login_supported else None
            },
        }

    def headers(
        self, client: YouTubeClientConfig, *, set_login: bool = False
    ) -> dict[str, str]:
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
                digest = hashlib.sha1(
                    f"{now} {sapisid} {ORIGIN_YOUTUBE_MUSIC}".encode()
                ).hexdigest()
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
                "context": self.context(
                    client, self.data_sync_id if set_login else None
                ),
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
            {
                "context": self.context(client, self.data_sync_id),
                "videoId": video_id,
                "playlistId": playlist_id,
                "continuation": continuation,
            },
            client=client,
            set_login=True,
        )

    def player(
        self,
        video_id: str,
        *,
        playlist_id: str | None = None,
        client: YouTubeClientConfig | None = None,
    ) -> dict[str, Any]:
        client = client or self.web_remix_client()
        return self.post(
            "player",
            {
                "context": self.context(client, self.data_sync_id),
                "videoId": video_id,
                "playlistId": playlist_id,
            },
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
        query_string = urlencode(
            {key: value for key, value in query.items() if value is not None}
        )
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
        async with httpx.AsyncClient(
            timeout=timeout, follow_redirects=False
        ) as client_session:
            response = await client_session.post(
                url,
                params={
                    key: value for key, value in query.items() if value is not None
                },
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
                async with httpx.AsyncClient(
                    timeout=httpx.Timeout(self.timeout), follow_redirects=False
                ) as client:
                    response = await client.get(
                        ORIGIN_YOUTUBE_MUSIC,
                        headers={
                            "User-Agent": USER_AGENT_WEB,
                            "Referer": REFERER_YOUTUBE_MUSIC,
                        },
                    )
                    response.raise_for_status()
                html = response.text
                self._apply_web_config(html)
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
        request = Request(
            ORIGIN_YOUTUBE_MUSIC,
            headers={"User-Agent": USER_AGENT_WEB, "Referer": REFERER_YOUTUBE_MUSIC},
            method="GET",
        )
        try:
            with self._opener.open(request, timeout=self.timeout) as response:
                html = response.read().decode("utf-8", errors="replace")
            self._apply_web_config(html)
        except Exception:
            self._web_remix_client = WEB_REMIX

    def _apply_web_config(self, html: str) -> None:
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
            version_match = re.search(
                r'"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"', html
            )
            version = version_match.group(1) if version_match else None
        self._web_remix_client = (
            replace(WEB_REMIX, client_version=version)
            if isinstance(version, str)
            else WEB_REMIX
        )


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
        return {
            key: _strip_none(item) for key, item in value.items() if item is not None
        }
    if isinstance(value, list):
        return [_strip_none(item) for item in value if item is not None]
    return value
