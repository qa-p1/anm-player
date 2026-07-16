import logging
import mimetypes
from pathlib import Path
from urllib.parse import unquote

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from sqlalchemy import select

from app.api.deps import DbSession, require_operator
from app.models import Album, Artist, LibraryAlbum, LibraryTrack, Song
from app.repositories.music import SongRepository
from app.services.artwork_cache import ArtworkCacheService
from app.services.file_paths import resolve_library_path
from app.services.ytmusic_service import ytmusic_service
from app.storage import storage_manager

router = APIRouter()
logger = logging.getLogger(__name__)

def _artwork_cache() -> ArtworkCacheService:
    return ArtworkCacheService(storage_manager.paths.artwork_cache)


@router.get("/songs/{song_id}/stream", summary="Stream song audio")
def stream_song(
    session: DbSession,
    song_id: int,
) -> FileResponse:
    """Stream audio file for a given song."""
    logger.info(f"[MEDIA-STREAM] Streaming request for song_id={song_id}")
    
    song_repo = SongRepository(session)
    song = song_repo.get(song_id)
    
    if not song:
        logger.error(f"[MEDIA-STREAM] Song {song_id} not found in database")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Song not found in database",
        )
    
    if not song.relative_path:
        logger.error(f"[MEDIA-STREAM] Song {song_id} has no file_path in database")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Song file path not set",
        )
    
    logger.info(f"[MEDIA-STREAM] Song {song_id} relative_path from DB: {song.relative_path}")
    
    file_path = resolve_library_path(song.relative_path)
    logger.info(f"[MEDIA-STREAM] Resolved path: {file_path}")
    
    if not file_path.exists():
        logger.error(f"[MEDIA-STREAM] File does not exist: {file_path}")
        
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Audio file does not exist on disk: {file_path}",
        )
    
    logger.info(f"[MEDIA-STREAM] Successfully streaming file: {file_path}")
    
    return FileResponse(
        path=str(file_path),
        media_type=mimetypes.guess_type(file_path.name)[0] or "application/octet-stream",
        filename=file_path.name,
    )


@router.get("/library-tracks/{track_id}/stream", summary="Stream downloaded library-track audio")
def stream_library_track(
    session: DbSession,
    track_id: int,
) -> FileResponse:
    track = session.get(LibraryTrack, track_id)
    if not track:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Library track not found")
    if not track.is_downloaded or not track.relative_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Library track is not downloaded")

    file_path = resolve_library_path(track.relative_path)
    if not file_path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Library track file does not exist")

    return FileResponse(
        path=str(file_path),
        media_type=mimetypes.guess_type(file_path.name)[0] or "application/octet-stream",
        filename=file_path.name,
    )


@router.get("/remote-artwork", summary="Proxy and cache remote artwork", dependencies=[Depends(require_operator)])
async def remote_artwork(url: str = Query(min_length=1, max_length=4096)) -> FileResponse:
    artwork_cache = _artwork_cache()
    decoded_url = unquote(url)
    if not artwork_cache.is_allowed_remote_url(decoded_url):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid artwork URL")

    cached_path = await artwork_cache.download_and_cache(decoded_url)
    if not cached_path or not cached_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artwork not available")

    return FileResponse(str(cached_path), media_type="image/jpeg")


@router.get("/artwork/cache/{size}/{filename}", summary="Serve cached artwork")
async def cached_artwork(session: DbSession, size: str, filename: str) -> FileResponse:
    artwork_cache = _artwork_cache()
    if size not in artwork_cache.sizes and size != "original":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artwork size not found")
    if "/" in filename or "\\" in filename:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid artwork path")

    artwork_path = artwork_cache.cache_dir / size / filename
    if not artwork_path.exists():
        recovered = await _recover_missing_artwork(session, f"/artwork/cache/{size}/{filename}")
        if recovered is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artwork not found")
        artwork_path = recovered

    return FileResponse(str(artwork_path), media_type="image/jpeg")


@router.get("/artwork/downloads/{filename}", summary="Serve persistent downloaded artwork")
async def downloaded_artwork(session: DbSession, filename: str) -> FileResponse:
    if "/" in filename or "\\" in filename:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid artwork path")
    artwork_path = storage_manager.paths.download_thumbnails / filename
    if not artwork_path.is_file():
        recovered = await _recover_missing_artwork(session, f"/artwork/downloads/{filename}")
        if recovered is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Downloaded artwork not found")
        artwork_path = recovered
    return FileResponse(str(artwork_path), media_type=mimetypes.guess_type(filename)[0] or "image/jpeg")


async def _recover_missing_artwork(session: DbSession, reference_suffix: str) -> Path | None:
    """Rehydrate an evicted DB-referenced image, using Innertube for legacy rows."""
    records = []
    for model in (LibraryTrack, LibraryAlbum, Song, Album, Artist):
        records.extend(session.scalars(select(model).where(model.artwork_path.like(f"%{reference_suffix}"))).all())

    remote_url = next((getattr(record, "artwork_url", None) for record in records if getattr(record, "artwork_url", None)), None)
    video_id = next(
        (
            record.external_id
            for record in records
            if isinstance(record, LibraryTrack) and record.source == "youtube" and record.external_id
        ),
        None,
    )
    if video_id is None:
        source_url = next((record.source_url for record in records if isinstance(record, Song) and record.source_url), None)
        video_id = _youtube_video_id(source_url)

    if remote_url is None and video_id:
        remote_url = await ytmusic_service.artwork(video_id)
    artwork_cache = _artwork_cache()
    if not remote_url or not artwork_cache.is_allowed_remote_url(remote_url):
        return None

    cached_path = await artwork_cache.download_and_cache(remote_url)
    if cached_path is None or not cached_path.is_file():
        return None

    public_path = artwork_cache.public_path(cached_path)
    for record in records:
        if hasattr(record, "artwork_url") and not getattr(record, "artwork_url", None):
            record.artwork_url = remote_url
        record.artwork_path = public_path
    session.commit()
    return cached_path


def _youtube_video_id(source_url: str | None) -> str | None:
    if not source_url:
        return None
    from urllib.parse import parse_qs, urlparse

    parsed = urlparse(source_url)
    if (parsed.hostname or "").endswith("youtube.com"):
        return (parse_qs(parsed.query).get("v") or [None])[0]
    if parsed.hostname in {"youtu.be", "www.youtu.be"}:
        return parsed.path.strip("/").split("/")[0] or None
    return None
