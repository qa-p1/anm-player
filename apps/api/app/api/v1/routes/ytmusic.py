from __future__ import annotations

import asyncio
import logging
import threading
from contextlib import suppress
from collections.abc import Iterator
from typing import Annotated
from urllib.error import HTTPError, URLError
from urllib.request import Request as UrlRequest, build_opener

from fastapi import APIRouter, Header, HTTPException, Path, Query, Request as FastAPIRequest, status
from fastapi.responses import FileResponse, Response, StreamingResponse

from app.api.deps import DbSession
from app.core.config import settings
from app.schemas.library import OnlineAlbumPreview
from app.schemas.ytmusic import OnlineHomeResponse, OnlineRelatedResponse, OnlineSearchResponse
from app.services.playback_sources import PlaybackSourceService
from app.services.ytmusic_service.playback import PlaybackData
from app.services.stream_cache import StreamCacheService
from app.services.ytmusic_service import ytmusic_service

router = APIRouter()
logger = logging.getLogger(__name__)
_upstream_limit = asyncio.Semaphore(4)
_resolution_limit = threading.BoundedSemaphore(settings.stream_fetch_max_concurrency)

VideoId = Annotated[str, Path(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")]
BrowseId = Annotated[str, Path(min_length=1, max_length=255, pattern=r"^[A-Za-z0-9_-]+$")]


async def _limited_upstream(awaitable):
    async with _upstream_limit:
        return await awaitable


@router.get("/home", response_model=OnlineHomeResponse, summary="YouTube Music home")
async def home() -> OnlineHomeResponse:
    return await _limited_upstream(ytmusic_service.home())


@router.get("/related/{video_id}", response_model=OnlineRelatedResponse, summary="YouTube Music related tracks")
async def related(video_id: VideoId) -> OnlineRelatedResponse:
    return await _limited_upstream(ytmusic_service.related(video_id))


@router.get("/search", response_model=OnlineSearchResponse, summary="Search YouTube Music with Innertube")
async def search(
    request: FastAPIRequest,
    q: Annotated[str, Query(min_length=1, max_length=200)],
    filter: Annotated[str, Query(pattern="^(all|songs|videos|albums|artists|featured_playlists|community_playlists|podcasts|episodes|profiles)$")] = "all",
    continuation: Annotated[str | None, Query(max_length=4096)] = None,
) -> OnlineSearchResponse:
    search_task = asyncio.create_task(
        _limited_upstream(ytmusic_service.search(q, filter_name=filter, continuation=continuation))
    )
    while not search_task.done():
        if await request.is_disconnected():
            search_task.cancel()
            with suppress(asyncio.CancelledError):
                await search_task
            raise HTTPException(status_code=499, detail="Search request cancelled")
        await asyncio.sleep(0.05)
    return await search_task


@router.get("/albums/{browse_id}", response_model=OnlineAlbumPreview, summary="Preview a YouTube Music album")
async def album(browse_id: BrowseId) -> OnlineAlbumPreview:
    return await _limited_upstream(ytmusic_service.album(browse_id))


@router.get("/stream/{video_id}/status", response_model=dict[str, bool], summary="Check YouTube stream cache status")
def stream_status(video_id: VideoId, session: DbSession) -> dict[str, bool]:
    cache_service = StreamCacheService(session)
    return {"cached": cache_service.get_cached_youtube_stream(video_id) is not None}


@router.get("/stream/{video_id}", response_model=None, summary="Stream and cache a YouTube Music audio track")
def stream(
    video_id: VideoId,
    session: DbSession,
    range_header: Annotated[
        str | None,
        Header(alias="Range", max_length=100, pattern=r"^bytes=(?:\d+-\d*|-\d+)$"),
    ] = None,
) -> Response:
    try:
        with _resolution_limit:
            source = PlaybackSourceService(session).resolve_youtube(video_id)
    except Exception as exc:
        logger.exception("Could not resolve YouTube Music stream for video %s", video_id)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not resolve audio stream") from exc

    if source.path:
        return FileResponse(
            path=str(source.path),
            media_type=source.media_type,
            filename=source.path.name,
            headers={"Cache-Control": "private, max-age=86400", "X-Aura-Playback-Source": source.kind},
        )
    if source.playback is None:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Playback source did not contain audio")
    return _proxy_playback_stream(source.playback, range_header, source_kind=source.kind)


def _proxy_playback_stream(playback: PlaybackData, range_header: str | None, *, source_kind: str = "streaming") -> StreamingResponse:
    request_headers = dict(playback.request_headers)
    if range_header:
        request_headers["Range"] = range_header
    request = UrlRequest(playback.stream_url, headers=request_headers, method="GET")

    try:
        response = build_opener().open(request, timeout=30)
    except HTTPError as exc:
        logger.warning("Upstream stream request failed with HTTP %s", exc.code)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Upstream audio service rejected the request") from exc
    except (OSError, URLError) as exc:
        logger.warning("Could not open upstream stream: %s", exc)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not open upstream audio stream") from exc

    headers = {"Cache-Control": "no-store", "Accept-Ranges": "bytes", "X-Aura-Playback-Source": source_kind}
    for source, target in (
        ("Content-Length", "Content-Length"),
        ("Content-Range", "Content-Range"),
    ):
        value = response.headers.get(source)
        if value:
            headers[target] = value

    return StreamingResponse(
        _iter_remote_response(response),
        status_code=getattr(response, "status", 200),
        media_type=StreamCacheService.content_type_for_playback(playback),
        headers=headers,
    )


def _iter_remote_response(response) -> Iterator[bytes]:
    try:
        while True:
            chunk = response.read(256 * 1024)
            if not chunk:
                break
            yield chunk
    finally:
        response.close()
