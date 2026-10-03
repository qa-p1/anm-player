"""Shared parsing for YouTube and YouTube Music source URLs."""

import re
from urllib.parse import parse_qs, urlparse

_BARE_VIDEO_ID = re.compile(r"[A-Za-z0-9_-]{11}")


def youtube_video_id(source_url: str | None, *, allow_bare_id: bool = False) -> str | None:
    """Return the video ID from a YouTube watch, short, embed, or youtu.be URL.

    With ``allow_bare_id`` an 11-character ID passed on its own is accepted too.
    """
    if not source_url:
        return None
    value = source_url.strip()
    if allow_bare_id and _BARE_VIDEO_ID.fullmatch(value):
        return value
    try:
        parsed = urlparse(value)
        host = (parsed.hostname or "").lower().rstrip(".")
    except ValueError:
        return None
    if host in {"youtu.be", "www.youtu.be"}:
        return parsed.path.strip("/").split("/")[0] or None
    if host == "youtube.com" or host.endswith(".youtube.com"):
        if parsed.path == "/watch":
            return (parse_qs(parsed.query).get("v") or [None])[0] or None
        if parsed.path.startswith(("/shorts/", "/embed/")):
            parts = parsed.path.strip("/").split("/")
            return parts[1] if len(parts) > 1 and parts[1] else None
    return None
