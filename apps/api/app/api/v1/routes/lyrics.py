"""Lyrics API routes."""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Query
from pydantic import BaseModel, Field

from app.api.deps import DbSession, ResourceId
from app.services.lyrics_cache import LyricsCacheResult
from app.services.lyrics_service import LyricsService

router = APIRouter()


class LyricsResponse(BaseModel):
    song_id: int | None = None
    video_id: str | None = None
    lyrics: str | None
    has_lyrics: bool
    source: str | None = None
    format: str | None = None
    status: str
    error_code: str | None = None
    fetched_at: datetime | None = None


class OnlineLyricsResponse(BaseModel):
    song_id: int | None = None
    video_id: str | None = None
    lyrics: str | None
    has_lyrics: bool
    source: str | None = None
    format: str | None = None
    status: str
    error_code: str | None = None
    fetched_at: datetime | None = None


class LyricsSaveRequest(BaseModel):
    lyrics: str = Field(min_length=1, max_length=1_000_000)


VideoId = Annotated[str, Path(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")]


def _song_response(song_id: int, result: LyricsCacheResult) -> LyricsResponse:
    return LyricsResponse(
        song_id=song_id,
        lyrics=result.lyrics,
        has_lyrics=result.has_lyrics,
        source=result.source,
        format=result.format,
        status=result.status,
        error_code=result.error_code,
        fetched_at=result.fetched_at,
    )


def _youtube_response(video_id: str, result: LyricsCacheResult) -> OnlineLyricsResponse:
    return OnlineLyricsResponse(
        video_id=video_id,
        lyrics=result.lyrics,
        has_lyrics=result.has_lyrics,
        source=result.source,
        format=result.format,
        status=result.status,
        error_code=result.error_code,
        fetched_at=result.fetched_at,
    )


@router.get("/songs/{song_id}", response_model=LyricsResponse)
def get_song_lyrics(
    song_id: ResourceId,
    session: DbSession,
) -> LyricsResponse:
    """Get lyrics for a song."""
    service = LyricsService(session)
    return _song_response(song_id, service.get_song_lyrics(song_id))


@router.post("/songs/{song_id}", response_model=LyricsResponse)
def save_song_lyrics(
    song_id: ResourceId,
    request: LyricsSaveRequest,
    session: DbSession,
) -> LyricsResponse:
    """Save lyrics to a song."""
    service = LyricsService(session)
    result = service.save_song_lyrics(song_id, request.lyrics)
    
    if not result:
        raise HTTPException(status_code=500, detail="Failed to save lyrics")
    
    return _song_response(song_id, result)


@router.post("/songs/{song_id}/fetch", response_model=LyricsResponse)
async def fetch_song_lyrics(
    song_id: ResourceId,
    session: DbSession,
    force: bool = Query(default=False),
) -> LyricsResponse:
    """Fetch timestamped lyrics for a local song and save them when found."""
    service = LyricsService(session)
    return _song_response(song_id, await service.fetch_and_save_lyrics(song_id, force=force))


@router.get("/youtube/{video_id}", response_model=OnlineLyricsResponse)
async def get_youtube_lyrics(
    video_id: VideoId,
    session: DbSession,
    title: str | None = Query(default=None, max_length=255),
    artist: str | None = Query(default=None, max_length=255),
    album: str | None = Query(default=None, max_length=255),
    duration: int | None = Query(default=None, ge=0, le=86400),
) -> OnlineLyricsResponse:
    """Get cached lyrics for an online YouTube Music track."""
    service = LyricsService(session)
    return _youtube_response(video_id, service.get_youtube_lyrics(video_id))


@router.post("/youtube/{video_id}/fetch", response_model=OnlineLyricsResponse)
async def fetch_youtube_lyrics(
    video_id: VideoId,
    session: DbSession,
    title: str | None = Query(default=None, max_length=255),
    artist: str | None = Query(default=None, max_length=255),
    album: str | None = Query(default=None, max_length=255),
    duration: int | None = Query(default=None, ge=0, le=86400),
    force: bool = Query(default=False),
) -> OnlineLyricsResponse:
    """Fetch lyrics for an online YouTube Music track and cache the result."""
    service = LyricsService(session)
    result = await service.fetch_online_lyrics(
        video_id=video_id,
        title=title,
        artist=artist,
        album=album,
        duration=duration,
        force=force,
    )
    return _youtube_response(video_id, result)
