import asyncio
import logging
import os
import re
import secrets
import shutil
import subprocess
import threading
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.request import Request, build_opener

from yt_dlp import YoutubeDL

from app.core.config import settings
from app.core.enums import DownloadStage, DownloadStatus
from app.core.youtube import youtube_video_id
from app.database.session import SessionLocal
from app.models import AlbumDownloadItem, DownloadJob, LibraryAlbum, Song
from app.repositories.music import AlbumRepository, ArtistRepository, DownloadJobRepository, SongRepository
from app.services.download_state import (
    claim_job_ownership,
    release_job_ownership,
    requeue_orphaned_downloads,
    sync_linked_album_download,
)
from app.services.downloads import download_job_response
from app.services.file_paths import library_storage_path
from app.services.library_scanner import library_sync_guard
from app.services.naming import NamingService
from app.services.artwork_cache import ArtworkCacheService
from app.services.lyrics_service import LyricsService
from app.services.tagging import AudioTagData, AudioTaggingService
from app.services.websocket_manager import download_progress_hub
from app.services.settings import SettingsService
from app.services.metadata.service import MetadataEnrichmentService
from app.services.ytmusic_service import PlaybackData, ytmusic_service
from app.storage import storage_manager
from app.storage.coordinator import StorageMigrationError, storage_coordinator

logger = logging.getLogger(__name__)

# yt-dlp calls progress hooks many times per second. Persist and broadcast an
# unchanged percentage at most this often; status changes always go through.
PROGRESS_WRITE_INTERVAL_SECONDS = 1.0


class DownloadWorker:
    def __init__(self) -> None:
        self._stop_event = threading.Event()
        self._claim_lock = threading.Lock()
        self._threads: list[threading.Thread] = []
        self._progress_written_at: dict[int, float] = {}
        self.naming = NamingService()
        self.tagging = AudioTaggingService()

    def start(self) -> None:
        if any(thread.is_alive() for thread in self._threads):
            return
        worker_count = 8
        self._recover_orphaned_jobs()
        self._stop_event.clear()
        self._threads = [
            threading.Thread(target=self._run, name=f"aura-download-worker-{index + 1}", daemon=True)
            for index in range(worker_count)
        ]
        for thread in self._threads:
            thread.start()
        logger.info("download worker started")

    def _recover_orphaned_jobs(self) -> None:
        try:
            with SessionLocal() as session:
                recovered = requeue_orphaned_downloads(session)
        except Exception:
            logger.exception("could not requeue interrupted downloads")
            return
        if recovered:
            logger.info("returned %s interrupted downloads to the queue", len(recovered))
            for job_id in recovered:
                self._publish(job_id)

    def stop(self) -> None:
        self._stop_event.set()
        for thread in self._threads:
            thread.join(timeout=5)
        logger.info("download worker stopped")

    def _run(self) -> None:
        while not self._stop_event.is_set():
            try:
                self._work_once()
            except Exception:
                logger.exception("download worker cycle failed")
            self._stop_event.wait(settings.download_worker_poll_interval_seconds)

    def _work_once(self) -> None:
        try:
            with storage_coordinator.filesystem_write():
                job_id = self._claim_next_job()
                if job_id is None:
                    return
                try:
                    self._download_job(job_id)
                except Exception as exc:
                    logger.exception("download failed", extra={"job_id": job_id})
                    self._mark_failed(job_id, exc)
                finally:
                    release_job_ownership(job_id)
                    self._progress_written_at.pop(job_id, None)
                    shutil.rmtree(self._download_jobs_dir() / str(job_id), ignore_errors=True)
        except StorageMigrationError:
            return

    def _claim_next_job(self) -> int | None:
        with self._claim_lock:
            return self._claim_next_job_locked()

    def _claim_next_job_locked(self) -> int | None:
        if storage_coordinator.stop_claiming.is_set():
            return None
        with SessionLocal() as session:
            runtime = SettingsService(session)
            maximum = runtime.get_int("max_concurrent_downloads", 8)
            active = session.query(DownloadJob).filter(
                DownloadJob.status.in_([
                    DownloadStatus.PREPARING,
                    DownloadStatus.DOWNLOADING,
                    DownloadStatus.PROCESSING,
                ])
            ).count()
            if active >= maximum:
                return None
            downloads = DownloadJobRepository(session)
            job_id = downloads.claim_next_queued()
            if job_id is None:
                return None
            claim_job_ownership(job_id)
            job = downloads.get(job_id)
            if job:
                if job.queue_item:
                    job.queue_item.status = DownloadStatus.PREPARING
                sync_linked_album_download(session, job)
                session.commit()
        self._publish(job_id)
        return job_id

    def _mark_failed(self, job_id: int, exc: Exception) -> None:
        with SessionLocal() as session:
            downloads = DownloadJobRepository(session)
            fresh_job = downloads.get(job_id)
            if fresh_job and fresh_job.status != DownloadStatus.CANCELLED:
                if storage_coordinator.cancel_work.is_set() or fresh_job.status == DownloadStatus.QUEUED:
                    fresh_job.status = DownloadStatus.QUEUED
                    fresh_job.stage = DownloadStage.QUEUED
                    if fresh_job.queue_item:
                        fresh_job.queue_item.status = DownloadStatus.QUEUED
                    sync_linked_album_download(session, fresh_job)
                    session.commit()
                    return
                fresh_job.status = DownloadStatus.FAILED
                fresh_job.stage = DownloadStage.FAILED
                fresh_job.error_message = self._friendly_error(exc)
                if fresh_job.queue_item:
                    fresh_job.queue_item.status = DownloadStatus.FAILED
                sync_linked_album_download(session, fresh_job)
                session.commit()
                self._publish(fresh_job.id)

    def _download_job(self, job_id: int) -> None:
        request = self._download_request(job_id)
        if not request:
            return
        source_url, audio_format, video_id = request
        work_dir = self._download_jobs_dir() / str(job_id)
        work_dir.mkdir(parents=True, exist_ok=True)
        info, output_file = self._download_media(
            job_id,
            source_url,
            audio_format,
            work_dir,
            video_id=video_id,
        )
        with library_sync_guard():
            postprocessing = self._save_download(job_id, info, output_file)
        if postprocessing:
            song_id, fetch_lyrics, enrich_metadata = postprocessing
            self._postprocess_download(song_id, fetch_lyrics, enrich_metadata)

    def _download_request(self, job_id: int) -> tuple[str, str, str | None] | None:
        with SessionLocal() as session:
            job = DownloadJobRepository(session).get(job_id)
            if not job or not job.source_url:
                return None
            return job.source_url, job.audio_format, job.video_id

    def _update_progress(self, job_id: int, payload: dict[str, Any]) -> None:
        with SessionLocal() as hook_session:
            hook_job = DownloadJobRepository(hook_session).get(job_id)
            if not hook_job:
                return
            if storage_coordinator.cancel_work.is_set():
                hook_job.status = DownloadStatus.QUEUED
                hook_job.stage = DownloadStage.QUEUED
                if hook_job.queue_item:
                    hook_job.queue_item.status = DownloadStatus.QUEUED
                sync_linked_album_download(hook_session, hook_job)
                hook_session.commit()
                raise RuntimeError("Download returned to queue for storage migration")
            if hook_job.status == DownloadStatus.CANCELLED:
                raise RuntimeError("Download cancelled")
            while hook_job.status == DownloadStatus.PAUSED:
                hook_session.commit()
                time.sleep(0.25)
                hook_session.refresh(hook_job)
                if hook_job.status == DownloadStatus.CANCELLED:
                    raise RuntimeError("Download cancelled")

            status = payload.get("status")
            if status == "downloading":
                progress = self._percent(payload)
                now = time.monotonic()
                if (
                    hook_job.status == DownloadStatus.DOWNLOADING
                    and progress == hook_job.progress
                    and now - self._progress_written_at.get(job_id, 0.0) < PROGRESS_WRITE_INTERVAL_SECONDS
                ):
                    return
                self._progress_written_at[job_id] = now
                hook_job.status = DownloadStatus.DOWNLOADING
                hook_job.stage = DownloadStage.DOWNLOADING
                hook_job.progress = progress
                hook_job.speed = self._format_speed(payload.get("speed"))
                hook_job.eta = self._format_eta(payload.get("eta"))
            elif status == "finished":
                hook_job.status = DownloadStatus.PROCESSING
                hook_job.stage = DownloadStage.EXTRACTING
                hook_job.progress = max(hook_job.progress, 92)
            sync_linked_album_download(hook_session, hook_job)
            hook_session.commit()
            self._publish(job_id)

    def _download_media(
        self,
        job_id: int,
        source_url: str,
        audio_format: str,
        work_dir: Path,
        *,
        video_id: str | None = None,
    ) -> tuple[dict[str, Any], Path]:
        def progress_hook(payload: dict[str, Any]) -> None:
            self._update_progress(job_id, payload)

        options = {
            "format": "bestaudio/best",
            "outtmpl": str(work_dir / "%(title).200B.%(ext)s"),
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
            "progress_hooks": [progress_hook],
            "postprocessors": [
                {
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": audio_format,
                    "preferredquality": "0",
                }
            ],
        }

        resolved_video_id = _safe_video_id(video_id) or _safe_video_id(youtube_video_id(source_url))
        if resolved_video_id:
            # Resolve the player's stream first to bypass yt-dlp media requests
            # rejected by YouTube. Keep yt-dlp available if that stream fails.
            try:
                return self._download_media_direct(
                    job_id,
                    resolved_video_id,
                    audio_format,
                    work_dir,
                )
            except Exception as direct_error:
                if storage_coordinator.cancel_work.is_set() or "cancelled" in str(direct_error).casefold():
                    raise
                logger.warning(
                    "Direct playback download failed; falling back to yt-dlp",
                    extra={"job_id": job_id, "video_id": resolved_video_id},
                    exc_info=True,
                )

        try:
            with YoutubeDL(options) as ydl:
                info = ydl.extract_info(source_url, download=True)
            return info, self._find_output_file(work_dir, audio_format)
        except Exception as ytdlp_error:
            if storage_coordinator.cancel_work.is_set() or "cancelled" in str(ytdlp_error).casefold():
                raise
            if not resolved_video_id:
                raise
            logger.warning(
                "yt-dlp download failed after the direct playback attempt",
                extra={"job_id": job_id, "video_id": resolved_video_id},
                exc_info=True,
            )
            raise ytdlp_error

    def _download_media_direct(
        self,
        job_id: int,
        video_id: str,
        audio_format: str,
        work_dir: Path,
    ) -> tuple[dict[str, Any], Path]:
        """Download a resolved YouTube stream when yt-dlp's media request is blocked."""
        playback = ytmusic_service.playback(video_id, quality="high")
        if not playback.stream_url:
            raise RuntimeError("Playback stream did not contain an audio URL")

        mime_type = str((playback.format or {}).get("mimeType") or "")
        source_suffix = ".m4a" if "audio/mp4" in mime_type or "mp4a" in mime_type else ".webm"
        source_file = work_dir / f".{video_id}.source{source_suffix}"
        output_file = work_dir / f"{video_id}.{audio_format}"
        source_file.unlink(missing_ok=True)
        output_file.unlink(missing_ok=True)

        succeeded = False
        try:
            downloaded, total = self._download_playback_stream(job_id, playback, source_file)
            if downloaded == 0:
                raise RuntimeError("Playback stream returned an empty audio file")

            self._update_progress(
                job_id,
                {
                    "status": "downloading",
                    "downloaded_bytes": downloaded,
                    "total_bytes": total or downloaded,
                },
            )
            self._update_progress(job_id, {"status": "finished"})

            ffmpeg = shutil.which("ffmpeg")
            if not ffmpeg:
                raise RuntimeError("FFmpeg is required to convert the downloaded audio")
            converted = subprocess.run(
                [
                    ffmpeg,
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-y",
                    "-i",
                    str(source_file),
                    "-vn",
                    "-map_metadata",
                    "0",
                    *(["-q:a", "0"] if audio_format == "mp3" else []),
                    str(output_file),
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            if converted.returncode != 0 or not output_file.is_file() or output_file.stat().st_size == 0:
                detail = converted.stderr.strip() or "FFmpeg did not create an audio file"
                raise RuntimeError(detail)

            details = dict(playback.video_details or {})
            details.setdefault("title", playback.title)
            details.setdefault("artist", playback.author)
            details.setdefault("uploader", playback.author)
            if not details.get("duration"):
                duration = _positive_int(details.get("lengthSeconds"))
                if duration:
                    details["duration"] = duration
            succeeded = True
            return details, output_file
        finally:
            source_file.unlink(missing_ok=True)
            if not succeeded:
                output_file.unlink(missing_ok=True)

    def _download_playback_stream(
        self,
        job_id: int,
        playback: PlaybackData,
        target: Path,
    ) -> tuple[int, int | None]:
        """Copy a playback URL with ranged retries so a throttled connection cannot stall a job."""
        playback_format = playback.format or {}
        total_hint = _positive_int(playback_format.get("contentLength") or playback_format.get("clen"))
        opener = build_opener()
        if not total_hint:
            return self._download_playback_sequential(job_id, playback, target, opener)

        downloaded = 0
        range_size = 4 * 1024 * 1024
        while downloaded < total_hint:
            start = downloaded
            end = min(start + range_size - 1, total_hint - 1)
            expected = end - start + 1
            sequential_fallback = False
            for attempt in range(3):
                try:
                    headers = {key: value for key, value in playback.request_headers.items() if key.lower() != "range"}
                    headers["Range"] = f"bytes={start}-{end}"
                    request = Request(playback.stream_url, headers=headers, method="GET")
                    with opener.open(request, timeout=30) as response:
                        response_status = int(getattr(response, "status", 200) or 200)
                        if response_status == 200:
                            if start:
                                sequential_fallback = True
                                break
                            total = _positive_int(response.headers.get("Content-Length")) or total_hint
                            received = self._copy_playback_response(
                                job_id,
                                response,
                                target,
                                total,
                                append=False,
                                expected=total,
                            )
                            return received, total
                        if response_status != 206:
                            raise RuntimeError(f"Playback server returned HTTP {response_status}")
                        content_range = _content_range(response.headers.get("Content-Range"))
                        if not content_range or content_range[0] != start or content_range[1] > end:
                            raise RuntimeError("Playback server returned an unexpected byte range")
                        _, response_end, total_hint = content_range
                        expected = response_end - start + 1
                        received = self._copy_playback_response(
                            job_id,
                            response,
                            target,
                            total_hint,
                            append=True,
                            expected=expected,
                        )
                    downloaded += received
                    break
                except Exception as exc:
                    _truncate_file(target, start)
                    # Cancellation and storage migrations are control flow. Do
                    # not turn them into another network retry, which can make
                    # the queue appear stalled while shutdown is in progress.
                    if storage_coordinator.cancel_work.is_set() or "cancelled" in str(exc).casefold():
                        raise
                    if attempt == 2:
                        raise
                    time.sleep(0.5 * (attempt + 1))
            else:
                raise RuntimeError("Playback stream could not be downloaded")
            if sequential_fallback:
                return self._download_playback_sequential(job_id, playback, target, opener)
        return downloaded, total_hint

    def _download_playback_sequential(
        self,
        job_id: int,
        playback: PlaybackData,
        target: Path,
        opener,
    ) -> tuple[int, int | None]:
        headers = {key: value for key, value in playback.request_headers.items() if key.lower() != "range"}
        request = Request(playback.stream_url, headers=headers, method="GET")
        with opener.open(request, timeout=60) as response:
            total = _positive_int(response.headers.get("Content-Length"))
            if int(getattr(response, "status", 200) or 200) == 206:
                content_range = _content_range(response.headers.get("Content-Range"))
                if not content_range or content_range[0] != 0:
                    raise RuntimeError("Playback server returned an unexpected byte range")
                total = content_range[2]
            received = self._copy_playback_response(
                job_id,
                response,
                target,
                total,
                append=False,
                expected=total,
            )
        return received, total

    def _copy_playback_response(
        self,
        job_id: int,
        response,
        target: Path,
        total: int | None,
        *,
        append: bool,
        expected: int | None = None,
    ) -> int:
        mode = "ab" if append else "wb"
        received = 0
        last_report = 0.0
        with target.open(mode) as output:
            while expected is None or received < expected:
                read_size = 256 * 1024 if expected is None else min(256 * 1024, expected - received)
                chunk = response.read(read_size)
                if not chunk:
                    break
                output.write(chunk)
                received += len(chunk)
                now = time.monotonic()
                if now - last_report >= 0.5:
                    current = target.stat().st_size
                    self._update_progress(
                        job_id,
                        {
                            "status": "downloading",
                            "downloaded_bytes": current,
                            "total_bytes": total,
                        },
                    )
                    last_report = now
        if expected is not None and received != expected:
            raise RuntimeError("Playback stream ended before the requested range was complete")
        return received

    def _save_download(
        self,
        job_id: int,
        info: dict[str, Any],
        output_file: Path,
    ) -> tuple[int, bool, bool] | None:
        with SessionLocal() as session:
            downloads = DownloadJobRepository(session)
            songs = SongRepository(session)
            artists = ArtistRepository(session)
            albums = AlbumRepository(session)
            fresh_job = downloads.get(job_id)
            if not fresh_job:
                return
            while fresh_job.status == DownloadStatus.PAUSED:
                session.commit()
                time.sleep(0.25)
                session.refresh(fresh_job)
            if fresh_job.status == DownloadStatus.CANCELLED:
                return

            fresh_job.stage = DownloadStage.SAVING
            session.commit()
            self._publish(job_id)

            title = fresh_job.title or info.get("title") or "Song"
            artist_name = fresh_job.artist or info.get("artist") or info.get("creator") or info.get("uploader") or "Unknown Artist"
            # Only persist album metadata supplied by ANM Player's provider/library
            # context. yt-dlp frequently reports a standalone release's title as
            # its album, which used to create a fake one-song album in Library.
            album_name = _download_album_name(fresh_job.album)
            storage_album_name = album_name or "Singles"
            target_path = self.naming.build_target_path(
                music_directory=storage_manager.paths.music,
                artist=artist_name,
                album=storage_album_name,
                title=title,
                extension=fresh_job.audio_format,
            )
            target_path.parent.mkdir(parents=True, exist_ok=True)
            if target_path.exists():
                if not target_path.is_file():
                    raise RuntimeError("The download destination is not a file.")
                if not fresh_job.overwrite_existing:
                    raise RuntimeError("A file already exists at the destination.")
            self.tagging.write_tags(
                output_file,
                AudioTagData(
                    title=title,
                    artist=artist_name,
                    album=album_name,
                    album_artist=artist_name,
                    clear_album=album_name is None,
                    year=info.get("release_year") or self._year_from_date(info.get("release_date") or info.get("upload_date")),
                ),
            )

            artist = artists.get_or_create(artist_name)
            album = albums.get_or_create(album_name, artist.id) if album_name else None
            artwork_url = fresh_job.thumbnail_url or info.get("thumbnail")
            runtime = SettingsService(session)
            cached_artwork = self._cache_artwork(artwork_url) if artwork_url and runtime.get_bool("download_artwork", True) else None
            artwork_path = cached_artwork
            if artwork_url and album:
                album.artwork_url = artwork_url
            if artwork_url:
                artist.artwork_url = artwork_url
            if artwork_path and album:
                album.artwork_path = artwork_path
            if artwork_path:
                artist.artwork_path = artwork_path

            # Store library files relative to music_directory when possible.
            file_path_to_save = library_storage_path(target_path)
            
            logger.debug("Saving song with file_path: %s", file_path_to_save)

            album_item = session.query(AlbumDownloadItem).filter(
                AlbumDownloadItem.download_job_id == fresh_job.id
            ).first()
            existing_song = songs.find_by_source_url(fresh_job.source_url)
            if existing_song:
                existing_song.relative_path = file_path_to_save
                existing_song.is_downloaded = True
                if artwork_url:
                    existing_song.artwork_url = artwork_url
                if artwork_path:
                    existing_song.artwork_path = artwork_path
                song_for_enrichment = existing_song
            else:
                new_song = Song(
                    title=title,
                    artist_id=artist.id,
                    album_id=album.id if album else None,
                    duration_seconds=info.get("duration"),
                    source_url=fresh_job.source_url,
                    relative_path=file_path_to_save,
                    artwork_path=artwork_path,
                    artwork_url=artwork_url,
                    is_downloaded=True,
                )
                songs.add(new_song)
                song_for_enrichment = new_song

            if album_item and album_item.track:
                if album and album_item.album_job.album.local_album_id is None:
                    represented = session.query(LibraryAlbum).filter(LibraryAlbum.local_album_id == album.id).first()
                    if represented is None or represented.id == album_item.album_job.album.id:
                        album_item.album_job.album.local_album_id = album.id
                album_item.track.song = song_for_enrichment
                album_item.track.relative_path = file_path_to_save
                album_item.track.is_downloaded = True
                album_item.track.duration_seconds = album_item.track.duration_seconds or info.get("duration")
                album_item.track.artwork_path = artwork_path
                if artwork_url:
                    album_item.track.artwork_url = artwork_url
                    album_item.album_job.album.artwork_url = artwork_url
                if artwork_path:
                    album_item.album_job.album.artwork_path = artwork_path
            fresh_job.status = DownloadStatus.COMPLETED
            fresh_job.stage = DownloadStage.COMPLETED
            fresh_job.progress = 100
            fresh_job.output_relative_path = file_path_to_save
            fresh_job.completed_at = datetime.now(UTC)
            if fresh_job.queue_item:
                fresh_job.queue_item.status = DownloadStatus.COMPLETED
            sync_linked_album_download(session, fresh_job)

            # Flush every constraint before publishing the media file. The
            # final replace and database commit are then compensated together:
            # a failed commit restores an overwritten file or removes the new
            # one, so the filesystem cannot get ahead of the database.
            session.flush()
            stage_path = target_path.with_name(
                f".{target_path.name}.aura-stage-{secrets.token_hex(16)}"
            )
            backup_path = target_path.with_name(
                f".{target_path.name}.aura-backup-{secrets.token_hex(16)}"
            )
            published = False
            backed_up = False
            try:
                shutil.move(str(output_file), stage_path)
                if target_path.exists():
                    # Keep the live file in place until the final atomic
                    # replacement. A crash can therefore never leave its
                    # database path temporarily missing.
                    shutil.copy2(target_path, backup_path)
                    backed_up = True
                os.replace(stage_path, target_path)
                published = True
                session.commit()
            except Exception:
                session.rollback()
                self._rollback_audio_publication(
                    target_path=target_path,
                    stage_path=stage_path,
                    backup_path=backup_path,
                    published=published,
                    backed_up=backed_up,
                )
                raise
            else:
                try:
                    backup_path.unlink(missing_ok=True)
                except OSError:
                    logger.warning(
                        "Download completed, but its replace backup could not be removed",
                        extra={"job_id": job_id},
                        exc_info=True,
                    )

            self._publish(job_id)
            return (
                song_for_enrichment.id,
                runtime.get_bool("auto_fetch_lyrics", True),
                runtime.get_bool("auto_enrich_downloads", True),
            )

    @staticmethod
    def _rollback_audio_publication(
        *,
        target_path: Path,
        stage_path: Path,
        backup_path: Path,
        published: bool,
        backed_up: bool,
    ) -> None:
        restore_error: OSError | None = None
        try:
            if backed_up:
                if not backup_path.is_file():
                    raise OSError("The audio replacement backup is missing")
                os.replace(backup_path, target_path)
            elif published:
                target_path.unlink(missing_ok=True)
        except OSError as exc:
            restore_error = exc
            logger.exception("Could not restore the previous audio file after a failed database commit")
        finally:
            try:
                stage_path.unlink(missing_ok=True)
            except OSError:
                logger.warning("Could not remove an unpublished audio staging file", exc_info=True)
            if not backed_up:
                try:
                    backup_path.unlink(missing_ok=True)
                except OSError:
                    logger.warning("Could not remove an incomplete audio backup", exc_info=True)

        if restore_error is not None:
            raise RuntimeError(
                "The download failed and ANM Player could not fully restore the previous audio file."
            ) from restore_error

    def _postprocess_download(
        self,
        song_id: int,
        fetch_lyrics: bool,
        enrich_metadata: bool,
    ) -> None:
        with SessionLocal() as session:
            if fetch_lyrics:
                try:
                    self._fetch_lyrics(session, song_id)
                except Exception:
                    logger.warning(
                        "Failed to fetch lyrics for completed song %s",
                        song_id,
                        exc_info=True,
                    )
            if enrich_metadata:
                try:
                    self._enrich_song(session, song_id)
                except Exception:
                    logger.warning(
                        "Metadata enrichment failed for completed song %s",
                        song_id,
                        exc_info=True,
                    )

    def _publish(self, job_id: int) -> None:
        with SessionLocal() as session:
            job = DownloadJobRepository(session).get(job_id)
            if not job:
                return
            download_progress_hub.publish_threadsafe(job_id, download_job_response(job).model_dump(mode="json"))

    def _find_output_file(self, work_dir: Path, audio_format: str) -> Path:
        for file_path in work_dir.glob(f"*.{audio_format}"):
            return file_path
        files = [path for path in work_dir.iterdir() if path.is_file()]
        if files:
            return files[0]
        raise RuntimeError("Downloaded audio file was not found.")

    def _percent(self, payload: dict[str, Any]) -> int:
        total = payload.get("total_bytes") or payload.get("total_bytes_estimate")
        downloaded = payload.get("downloaded_bytes")
        if not total or not downloaded:
            return 0
        return min(90, max(0, int((downloaded / total) * 90)))

    def _format_speed(self, speed: Any) -> str | None:
        if not speed:
            return None
        value = float(speed)
        if value > 1_000_000:
            return f"{value / 1_000_000:.1f} MB/s"
        return f"{value / 1_000:.0f} KB/s"

    def _format_eta(self, eta: Any) -> str | None:
        if eta is None:
            return None
        seconds = int(eta)
        minutes, remaining = divmod(seconds, 60)
        return f"{minutes}:{remaining:02d}"

    def _year_from_date(self, value: Any) -> int | None:
        if not value:
            return None
        text = str(value)
        if len(text) < 4:
            return None
        try:
            return int(text[:4])
        except ValueError:
            return None

    def _friendly_error(self, exc: Exception) -> str:
        message = str(exc)
        if "ffmpeg" in message.lower():
            return "Audio conversion failed. Confirm FFmpeg is installed and available."
        if "permission" in message.lower():
            return "ANM Player could not write to the configured music directory."
        if "cancelled" in message.lower():
            return "Download was cancelled."
        return "Download failed. The video may be unavailable or unsupported."

    def _cache_artwork(self, artwork_url: str | None) -> str | None:
        if not artwork_url:
            return None
        try:
            artwork_cache = ArtworkCacheService(storage_manager.paths.artwork_cache)
            cached_path = asyncio.run(artwork_cache.download_and_cache(artwork_url))
            if not cached_path:
                return None
            persistent_dir = storage_manager.paths.download_thumbnails
            persistent_dir.mkdir(parents=True, exist_ok=True)
            persistent_path = persistent_dir / cached_path.name
            temporary = persistent_path.with_name(
                f".{persistent_path.name}.{secrets.token_hex(6)}.tmp"
            )
            try:
                shutil.copyfile(cached_path, temporary)
                os.replace(temporary, persistent_path)
            finally:
                temporary.unlink(missing_ok=True)
            return f"/api/v1/media/artwork/downloads/{persistent_path.name}"
        except Exception as exc:
            logger.warning("Failed to cache artwork: %s", exc)
            return None

    def _fetch_lyrics(self, session, song_id: int) -> None:
        """Fetch and save lyrics from YouTube Music/LRCLIB after download."""
        asyncio.run(LyricsService(session).fetch_and_save_lyrics(song_id, embed=False))
        logger.debug("Finished lyrics lookup for song %s", song_id)

    def _enrich_song(self, session, song_id: int) -> None:
        asyncio.run(MetadataEnrichmentService(session).enrich_song(song_id))

    def _download_jobs_dir(self) -> Path:
        return storage_manager.paths.download_jobs


download_worker = DownloadWorker()


def _safe_video_id(value: str | None) -> str | None:
    if value and re.fullmatch(r"[A-Za-z0-9_-]{1,255}", value):
        return value
    return None


def _positive_int(value: Any) -> int | None:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def _content_range(value: str | None) -> tuple[int, int, int] | None:
    if not value:
        return None
    match = re.fullmatch(r"bytes\s+(\d+)-(\d+)/(\d+)", value.strip(), flags=re.IGNORECASE)
    if not match:
        return None
    start, end, total = map(int, match.groups())
    return (start, end, total) if 0 <= start <= end < total else None


def _truncate_file(path: Path, size: int) -> None:
    try:
        with path.open("r+b") as handle:
            handle.truncate(size)
    except FileNotFoundError:
        return


def _download_album_name(requested_album: str | None) -> str | None:
    value = requested_album.strip() if requested_album else ""
    return value or None
