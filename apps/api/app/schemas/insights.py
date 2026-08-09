from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.artwork import ArtworkResponseModel


class ListeningSummary(BaseModel):
    period_days: int | None = None
    range_start: datetime | None = None
    generated_at: datetime
    total_plays: int = 0
    completed_plays: int = 0
    skipped_plays: int = 0
    listening_seconds: int = 0
    unique_tracks: int = 0
    unique_artists: int = 0
    active_days: int = 0
    current_streak_days: int = 0
    completion_rate: float = Field(default=0, ge=0, le=100)


class TrackInsight(ArtworkResponseModel):
    key: str
    source: str
    external_id: str | None = None
    song_id: int | None = None
    title: str
    artist_name: str | None = None
    album_title: str | None = None
    artwork_url: str | None = None
    source_url: str | None = None
    duration_seconds: int | None = None
    play_count: int = 0
    completed_count: int = 0
    skipped_count: int = 0
    listening_seconds: int = 0


class ArtistInsight(BaseModel):
    name: str
    play_count: int = 0
    listening_seconds: int = 0


class AlbumInsight(BaseModel):
    title: str
    artist_name: str | None = None
    play_count: int = 0
    listening_seconds: int = 0


class DailyListening(BaseModel):
    date: str
    play_count: int = 0
    listening_seconds: int = 0


class HourlyListening(BaseModel):
    hour: int = Field(ge=0, le=23)
    play_count: int = 0


class ListeningInsightsResponse(BaseModel):
    summary: ListeningSummary
    top_tracks: list[TrackInsight] = []
    top_artists: list[ArtistInsight] = []
    top_albums: list[AlbumInsight] = []
    daily: list[DailyListening] = []
    hourly: list[HourlyListening] = []
