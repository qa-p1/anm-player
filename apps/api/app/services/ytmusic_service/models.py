from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

ItemKind = Literal[
    "song", "album", "playlist", "artist", "podcast", "episode", "unknown"
]


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
            playlist_id = (
                self.id
                if self.id.startswith("VL")
                else f"VL{self.id}"
                if self.kind == "playlist"
                else self.id
            )
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
