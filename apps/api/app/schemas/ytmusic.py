from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


OnlineItemKind = Literal["song", "video", "album", "artist", "playlist", "podcast", "episode", "unknown"]


class OnlineArtist(BaseModel):
    id: str | None = None
    name: str


class OnlineAlbum(BaseModel):
    id: str | None = None
    name: str


class OnlineMusicItem(BaseModel):
    source: Literal["youtube"] = "youtube"
    kind: OnlineItemKind
    id: str
    title: str
    subtitle: str | None = None
    artists: list[OnlineArtist] = []
    album: OnlineAlbum | None = None
    thumbnail: str | None = None
    duration_seconds: int | None = None
    explicit: bool = False
    playable: bool = False
    browse_id: str | None = None
    playlist_id: str | None = None
    endpoint: dict[str, Any] | None = None
    url: str


class OnlineHomeChip(BaseModel):
    title: str
    params: str | None = None


class OnlineHomeSection(BaseModel):
    id: str
    title: str
    subtitle: str | None = None
    layout: Literal["hero", "quick_grid", "song_list", "album_grid", "playlist_grid", "artist_grid", "chips"] = "album_grid"
    items: list[OnlineMusicItem] = []
    continuation: str | None = None


class OnlineHomeResponse(BaseModel):
    region: str
    generated_at: datetime = Field(default_factory=datetime.utcnow)
    chips: list[OnlineHomeChip] = []
    sections: list[OnlineHomeSection] = []


class OnlineRelatedResponse(BaseModel):
    seed_video_id: str
    items: list[OnlineMusicItem] = []


class OnlineSearchResponse(BaseModel):
    query: str
    filter: str = "all"
    items: list[OnlineMusicItem]
    continuation: str | None = None
