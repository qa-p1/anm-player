from __future__ import annotations

from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, build_opener

from app.services.ytmusic_service.models import PlaybackData as PlaybackData

__all__ = [
    "PlaybackData",
    "decipher_signature_cipher",
    "select_audio_format",
    "select_ytdlp_audio_format",
    "validate_stream_spans",
    "validate_stream_url",
]


def select_audio_format(
    player_response: dict[str, Any], *, quality: str = "auto"
) -> dict[str, Any] | None:
    formats = (player_response.get("streamingData") or {}).get("adaptiveFormats") or []
    audio_formats = [
        fmt for fmt in formats if fmt.get("width") is None and fmt.get("mimeType")
    ]
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
        return {
            "AUDIO_QUALITY_HIGH": 3,
            "AUDIO_QUALITY_MEDIUM": 2,
            "AUDIO_QUALITY_LOW": 1,
        }.get(fmt.get("audioQuality"), 0)

    if quality == "low":
        capped = [
            fmt for fmt in audio_formats if int(fmt.get("bitrate") or 0) <= 128_000
        ]
        return max(
            capped or audio_formats,
            key=lambda fmt: (int(fmt.get("bitrate") or 0), codec_score(fmt)),
        )
    if quality == "high":
        return max(
            audio_formats,
            key=lambda fmt: (
                quality_score(fmt),
                int(fmt.get("audioChannels") or 2),
                codec_score(fmt),
                int(fmt.get("bitrate") or 0),
            ),
        )
    return max(
        audio_formats, key=lambda fmt: (int(fmt.get("bitrate") or 0), codec_score(fmt))
    )


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


def validate_stream_url(
    url: str, headers: dict[str, str], *, timeout: float = 10.0
) -> bool:
    request = Request(url, headers={**headers, "Range": "bytes=0-1"}, method="GET")
    try:
        with build_opener().open(request, timeout=timeout) as response:
            return response.status in {200, 206}
    except HTTPError as exc:
        return exc.code in {200, 206}
    except (OSError, URLError):
        return False


def validate_stream_spans(
    url: str, headers: dict[str, str], *, content_length: int, timeout: float = 10.0
) -> bool:
    if content_length <= 0:
        return validate_stream_url(url, headers, timeout=timeout)
    starts = [0]
    if content_length > 1_200_000:
        starts.append(1_048_576)
    if content_length > 3_300_000:
        starts.append(3_145_728)
    for start in starts:
        end = min(start + 1, content_length - 1)
        request = Request(
            url, headers={**headers, "Range": f"bytes={start}-{end}"}, method="GET"
        )
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


def select_ytdlp_audio_format(
    formats: list[dict[str, Any]], *, quality: str = "auto"
) -> dict[str, Any] | None:
    audio_formats = [
        fmt
        for fmt in formats
        if fmt.get("url")
        and fmt.get("vcodec") in {None, "none"}
        and fmt.get("acodec") not in {None, "none"}
    ]
    if not audio_formats:
        audio_formats = [
            fmt
            for fmt in formats
            if fmt.get("url") and fmt.get("acodec") not in {None, "none"}
        ]
    if not audio_formats:
        return None

    def score(fmt: dict[str, Any]) -> tuple[float, int]:
        codec = 2 if fmt.get("acodec") == "opus" or fmt.get("ext") == "webm" else 1
        return float(fmt.get("abr") or fmt.get("tbr") or 0), codec

    return (
        min(audio_formats, key=score)
        if quality == "low"
        else max(audio_formats, key=score)
    )
