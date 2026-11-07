from __future__ import annotations

from typing import Any

from app.services.ytmusic_service.models import (
    HomePage,
    InnertubeSearchResult,
    PlaybackData,
)
from app.services.ytmusic_service.parsing import parse_home, parse_search
from app.services.ytmusic_service.playback import (
    decipher_signature_cipher,
    select_audio_format,
    select_ytdlp_audio_format,
    validate_stream_spans,
)
from app.services.ytmusic_service.transport import (
    ANDROID,
    IOS,
    VISIONOS,
    WEB,
    InnerTubeSession,
)


class YouTubeMusicClient:
    def __init__(self, session: InnerTubeSession | None = None) -> None:
        self.session = session or InnerTubeSession()

    def home(
        self, *, continuation: str | None = None, params: str | None = None
    ) -> HomePage:
        raw = self.session.browse(
            browse_id=None if continuation else "FEmusic_home",
            params=params,
            continuation=continuation,
        )
        return parse_home(raw)

    def search(
        self, query: str, *, params: str | None = None, continuation: str | None = None
    ) -> InnertubeSearchResult:
        raw = self.session.search(
            query if continuation is None else None,
            params=params,
            continuation=continuation,
        )
        return parse_search(raw)

    async def search_async(
        self, query: str, *, params: str | None = None, continuation: str | None = None
    ) -> InnertubeSearchResult:
        raw = await self.session.search_async(
            query if continuation is None else None,
            params=params,
            continuation=continuation,
        )
        return parse_search(raw)

    def playback(
        self, video_id: str, *, playlist_id: str | None = None, quality: str = "auto"
    ) -> PlaybackData:
        clients = (self.session.web_remix_client(), VISIONOS, IOS, ANDROID, WEB)
        last_status: dict[str, Any] | None = None
        for yt_client in clients:
            if yt_client.login_required and not self.session.cookie:
                continue
            try:
                response = self.session.player(
                    video_id, playlist_id=playlist_id, client=yt_client
                )
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
            content_length = int(
                selected.get("contentLength") or selected.get("clen") or 0
            )
            if not validate_stream_spans(
                url,
                headers,
                content_length=content_length,
                timeout=self.session.timeout,
            ):
                continue
            details = response.get("videoDetails") or {}
            return PlaybackData(
                video_id=video_id,
                title=details.get("title"),
                author=details.get("author"),
                stream_url=url,
                expires_in_seconds=int(
                    (response.get("streamingData") or {}).get("expiresInSeconds") or 0
                ),
                client_name=yt_client.client_name,
                format=selected,
                request_headers=headers,
                video_details=details,
                playability_status=status,
            )
        ytdlp = self.playback_with_ytdlp(video_id, quality=quality)
        if ytdlp is not None:
            return ytdlp
        reason = (
            (last_status or {}).get("reason")
            or (last_status or {}).get("status")
            or "no playable direct audio format"
        )
        raise RuntimeError(
            f"Could not resolve playback stream for {video_id}: {reason}"
        )

    def playback_with_ytdlp(
        self, video_id: str, *, quality: str = "auto"
    ) -> PlaybackData | None:
        try:
            import yt_dlp
        except Exception:
            return None
        options = {
            "quiet": True,
            "no_warnings": True,
            "noplaylist": True,
            "format": "bestaudio[ext=webm]/bestaudio/best"
            if quality != "low"
            else "worstaudio/bestaudio/best",
        }
        try:
            with yt_dlp.YoutubeDL(options) as ydl:
                info = ydl.extract_info(
                    f"https://music.youtube.com/watch?v={video_id}", download=False
                )
        except Exception:
            return None
        selected = (
            info
            if info.get("url")
            else select_ytdlp_audio_format(info.get("formats") or [], quality=quality)
        )
        if not selected or not selected.get("url"):
            return None
        headers = dict(info.get("http_headers") or {})
        headers.update(selected.get("http_headers") or {})
        headers.setdefault("Accept-Encoding", "identity")
        content_length = int(
            selected.get("filesize") or selected.get("filesize_approx") or 0
        )
        if not validate_stream_spans(
            selected["url"],
            headers,
            content_length=content_length,
            timeout=self.session.timeout,
        ):
            return None
        mime_type = (
            selected.get("mime_type") or f"audio/{selected.get('ext') or 'webm'}"
        )
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
                "bitrate": int(float(selected.get("abr") or 0) * 1000)
                if selected.get("abr")
                else int(selected.get("tbr") or 0),
                "contentLength": content_length,
                "audioQuality": selected.get("format_note"),
                "audioSampleRate": selected.get("asr"),
                "audioChannels": selected.get("audio_channels"),
                "quality": selected.get("quality"),
            },
            request_headers=headers,
            video_details={
                "videoId": video_id,
                "title": info.get("title"),
                "author": info.get("uploader") or info.get("channel"),
            },
            playability_status={"status": "OK"},
        )
