import logging
import mimetypes
import os
import re
import secrets
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from sqlalchemy import select

from app.api.deps import DbSession, ResourceId, require_operator
from app.models import Album, Artist, History, LibraryAlbum, LibraryTrack, Song
from app.repositories.music import SongRepository
from app.services.artwork_cache import ArtworkCacheService
from app.services.file_paths import resolve_library_path
from app.core.youtube import youtube_video_id
from app.services.ytmusic_service import ytmusic_service
from app.storage import storage_manager

router = APIRouter()
logger = logging.getLogger(__name__)
# New cache entries use SHA-256. Exact legacy MD5 names remain readable so
# existing installations can rehydrate them and rewrite their database path.
ARTWORK_FILENAME = re.compile(r"^(?:[0-9a-f]{32}|[0-9a-f]{64})\.jpg$")

def _artwork_cache() -> ArtworkCacheService:
    return ArtworkCacheService(storage_manager.paths.artwork_cache)


@router.get("/songs/{song_id}/stream", summary="Stream song audio")
def stream_song(
    session: DbSession,
    song_id: ResourceId,
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
    
    try:
        file_path = resolve_library_path(song.relative_path)
    except (OSError, ValueError):
        logger.exception("[MEDIA-STREAM] Rejected invalid managed path for song %s", song_id)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Audio file is unavailable",
        ) from None
    logger.info(f"[MEDIA-STREAM] Resolved path: {file_path}")
    
    if not file_path.is_file():
        logger.error(f"[MEDIA-STREAM] File does not exist: {file_path}")
        
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Audio file is unavailable",
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
    track_id: ResourceId,
) -> FileResponse:
    track = session.get(LibraryTrack, track_id)
    if not track:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Library track not found")
    if not track.is_downloaded or not track.relative_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Library track is not downloaded")

    try:
        file_path = resolve_library_path(track.relative_path)
    except (OSError, ValueError):
        logger.exception("[MEDIA-STREAM] Rejected invalid managed path for library track %s", track_id)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Library track file is unavailable",
        ) from None
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
    if not artwork_cache.is_allowed_remote_url(url):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid artwork URL")

    cached_path = await artwork_cache.download_and_cache(url)
    if not cached_path or not cached_path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artwork not available")

    return FileResponse(str(cached_path), media_type="image/jpeg")


@router.get("/artwork/cache/{size}/{filename}", summary="Serve cached artwork")
async def cached_artwork(session: DbSession, size: str, filename: str) -> FileResponse:
    artwork_cache = _artwork_cache()
    if size not in artwork_cache.sizes and size != "original":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artwork size not found")
    if not ARTWORK_FILENAME.fullmatch(filename):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid artwork path")

    artwork_path = artwork_cache.cache_dir / size / filename
    if not artwork_path.is_file():
        recovered = await _recover_missing_artwork(
            session,
            f"/artwork/cache/{size}/{filename}",
            legacy_target=artwork_path,
        )
        if recovered is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artwork not found")
        artwork_path = recovered
    else:
        try:
            artwork_path.touch()
        except OSError:
            pass

    return FileResponse(str(artwork_path), media_type="image/jpeg")


@router.get("/artwork/downloads/{filename}", summary="Serve persistent downloaded artwork")
async def downloaded_artwork(session: DbSession, filename: str) -> FileResponse:
    if not ARTWORK_FILENAME.fullmatch(filename):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid artwork path")
    artwork_path = storage_manager.paths.download_thumbnails / filename
    if not artwork_path.is_file():
        recovered = await _recover_missing_artwork(
            session,
            f"/artwork/downloads/{filename}",
            legacy_target=artwork_path,
        )
        if recovered is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Downloaded artwork not found")
        artwork_path = recovered
    return FileResponse(str(artwork_path), media_type=mimetypes.guess_type(filename)[0] or "image/jpeg")


async def _recover_missing_artwork(
    session: DbSession,
    reference_suffix: str,
    *,
    legacy_target: Path | None = None,
) -> Path | None:
    """Rehydrate an evicted DB-referenced image, using Innertube for legacy rows."""
    records: list[LibraryTrack | LibraryAlbum | Song | Album | Artist] = []
    for model in (LibraryTrack, LibraryAlbum, Song, Album, Artist):
        records.extend(session.scalars(select(model).where(model.artwork_path.like(f"%{reference_suffix}"))).all())

    # Older online history rows may wrap an absolute local artwork URL inside
    # the former remote proxy. The hash remains literal even when the rest is
    # percent-encoded, so it is a safe compatibility lookup key.
    filename = Path(reference_suffix).name
    history_records = session.scalars(
        select(History).where(History.artwork_url.like(f"%{filename}%"))
    ).all()

    artwork_cache = _artwork_cache()
    remote_url = next(
        (
            candidate
            for record in (*records, *history_records)
            for candidate in _related_artwork_urls(record)
            if candidate and artwork_cache.is_allowed_remote_url(candidate)
        ),
        None,
    )
    video_id = next(
        (
            candidate
            for record in (*records, *history_records)
            for candidate in _related_video_ids(record)
        ),
        None,
    )
    if video_id is None:
        video_id = next(
            (
                candidate
                for record in (*records, *history_records)
                for source_url in _related_source_urls(record)
                if (candidate := youtube_video_id(source_url))
            ),
            None,
        )

    if remote_url is None and video_id:
        remote_url = await ytmusic_service.artwork(video_id)
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
    for record in history_records:
        record.artwork_url = remote_url
    session.commit()
    return _publish_legacy_artwork_alias(cached_path, legacy_target) or cached_path


def _related_artwork_urls(
    record: LibraryTrack | LibraryAlbum | Song | Album | Artist | History,
) -> list[str | None]:
    candidates = [getattr(record, "artwork_url", None)]
    if isinstance(record, LibraryTrack):
        if record.song:
            candidates.extend(_related_artwork_urls(record.song))
        if record.album:
            candidates.append(record.album.artwork_url)
    elif isinstance(record, LibraryAlbum):
        candidates.extend(track.artwork_url for track in record.tracks)
    elif isinstance(record, Song):
        if record.album:
            candidates.append(record.album.artwork_url)
        if record.artist:
            candidates.append(record.artist.artwork_url)
    elif isinstance(record, Album):
        candidates.extend(song.artwork_url for song in record.songs)
    elif isinstance(record, Artist):
        candidates.extend(song.artwork_url for song in record.songs)
        candidates.extend(album.artwork_url for album in record.albums)
    elif isinstance(record, History) and record.song:
        candidates.extend(_related_artwork_urls(record.song))
    return candidates


def _related_video_ids(
    record: LibraryTrack | LibraryAlbum | Song | Album | Artist | History,
) -> list[str]:
    candidates: list[str] = []
    if isinstance(record, LibraryTrack):
        if record.source == "youtube" and record.external_id:
            candidates.append(record.external_id)
    elif isinstance(record, LibraryAlbum):
        candidates.extend(
            track.external_id
            for track in record.tracks
            if track.source == "youtube" and track.external_id
        )
    elif isinstance(record, History):
        if record.source == "youtube" and record.external_id:
            candidates.append(record.external_id)
    return candidates


def _related_source_urls(
    record: LibraryTrack | LibraryAlbum | Song | Album | Artist | History,
) -> list[str]:
    candidates: list[str] = []
    source_url = getattr(record, "source_url", None)
    if source_url:
        candidates.append(source_url)
    if isinstance(record, LibraryTrack):
        if record.song and record.song.source_url:
            candidates.append(record.song.source_url)
    elif isinstance(record, LibraryAlbum):
        candidates.extend(track.source_url for track in record.tracks if track.source_url)
    elif isinstance(record, Album):
        candidates.extend(song.source_url for song in record.songs if song.source_url)
    elif isinstance(record, Artist):
        candidates.extend(song.source_url for song in record.songs if song.source_url)
    elif isinstance(record, History) and record.song and record.song.source_url:
        candidates.append(record.song.source_url)
    return candidates


def _publish_legacy_artwork_alias(cached_path: Path, target: Path | None) -> Path | None:
    if target is None or target == cached_path:
        return cached_path
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f".{target.name}.{secrets.token_hex(6)}.tmp")
    try:
        shutil.copyfile(cached_path, temporary)
        os.replace(temporary, target)
        return target
    except OSError:
        logger.warning("Could not publish a recovered legacy artwork alias", exc_info=True)
        return None
    finally:
        temporary.unlink(missing_ok=True)
