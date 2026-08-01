from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import app.workers.downloads.worker as worker_module
from app.core.enums import DownloadStage, DownloadStatus
from app.models import AlbumDownloadItem, AlbumDownloadJob, Base, DownloadJob, LibraryAlbum, LibraryTrack, QueueItem, Song
from app.services.settings import SettingsService
from app.workers.downloads.worker import DownloadWorker


def worker_session_factory():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class FakeYoutubeDL:
    def __init__(self, options: dict) -> None:
        self.options = options

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def extract_info(self, source_url: str, *, download: bool) -> dict:
        assert source_url == "https://example.com/song"
        assert download is True
        output_template = Path(self.options["outtmpl"])
        output = output_template.parent / "downloaded.mp3"
        output.write_bytes(b"audio")
        hook = self.options["progress_hooks"][0]
        hook({"status": "downloading", "downloaded_bytes": 50, "total_bytes": 100, "speed": 2_000_000, "eta": 9})
        hook({"status": "finished"})
        return {
            "title": "Provider title",
            "artist": "Provider artist",
            "duration": 123,
            "release_date": "20260722",
        }


def test_download_job_success_updates_file_library_queue_and_postprocessing(
    music_directory, monkeypatch
) -> None:
    Session = worker_session_factory()
    with Session() as session:
        job = DownloadJob(
            status=DownloadStatus.QUEUED,
            stage=DownloadStage.QUEUED,
            source_url="https://example.com/song",
            title="Requested title",
            artist="Requested artist",
            audio_format="mp3",
            overwrite_existing=False,
        )
        session.add(job)
        session.flush()
        session.add(QueueItem(download_job_id=job.id, status=DownloadStatus.QUEUED))
        session.commit()
        job_id = job.id

    worker = DownloadWorker()
    lyrics: list[int] = []
    enrichments: list[int] = []
    monkeypatch.setattr(worker_module, "SessionLocal", Session)
    monkeypatch.setattr(worker_module, "YoutubeDL", FakeYoutubeDL)
    monkeypatch.setattr(worker, "_download_jobs_dir", lambda: music_directory.parent / "downloads" / "jobs")
    monkeypatch.setattr(worker.tagging, "write_tags", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(worker, "_fetch_lyrics", lambda _session, song_id: lyrics.append(song_id))
    monkeypatch.setattr(worker, "_enrich_song", lambda _session, song_id: enrichments.append(song_id))
    monkeypatch.setattr(worker, "_publish", lambda _job_id: None)

    worker._download_job(job_id)

    with Session() as session:
        completed = session.get(DownloadJob, job_id)
        queue = session.query(QueueItem).filter(QueueItem.download_job_id == job_id).one()
        song = session.query(Song).one()
        assert completed is not None
        assert completed.status == DownloadStatus.COMPLETED
        assert completed.stage == DownloadStage.COMPLETED
        assert completed.progress == 100
        assert completed.output_relative_path == song.relative_path
        assert queue.status == DownloadStatus.COMPLETED
        assert song.title == "Requested title"
        assert song.is_downloaded is True
        assert song.relative_path is not None
        assert (music_directory.parent / song.relative_path).read_bytes() == b"audio"
        assert lyrics == [song.id]
        assert enrichments == [song.id]


def test_progress_hook_honors_cancellation(music_directory, monkeypatch) -> None:
    Session = worker_session_factory()
    with Session() as session:
        job = DownloadJob(
            status=DownloadStatus.CANCELLED,
            source_url="https://example.com/song",
            audio_format="mp3",
        )
        session.add(job)
        session.commit()
        job_id = job.id

    worker = DownloadWorker()
    monkeypatch.setattr(worker_module, "SessionLocal", Session)
    monkeypatch.setattr(worker_module, "YoutubeDL", FakeYoutubeDL)
    monkeypatch.setattr(worker, "_download_jobs_dir", lambda: music_directory.parent / "downloads" / "jobs")

    with pytest.raises(RuntimeError, match="cancelled"):
        worker._download_job(job_id)

    with Session() as session:
        assert session.get(DownloadJob, job_id).status == DownloadStatus.CANCELLED


def test_mark_failed_synchronizes_queue_and_album_progress(monkeypatch) -> None:
    Session = worker_session_factory()
    with Session() as session:
        album = LibraryAlbum(public_id="album", external_id="album", title="Album")
        track = LibraryTrack(external_id="track", title="Track", position=0)
        session.add_all([album, track])
        session.flush()
        album_job = AlbumDownloadJob(album_id=album.id, total_tracks=1, max_parallel=1)
        job = DownloadJob(status=DownloadStatus.DOWNLOADING, source_url="https://example.com/fail")
        session.add_all([album_job, job])
        session.flush()
        session.add_all(
            [
                QueueItem(download_job_id=job.id, status=DownloadStatus.DOWNLOADING),
                AlbumDownloadItem(album_job_id=album_job.id, track_id=track.id, download_job_id=job.id),
            ]
        )
        session.commit()
        job_id = job.id

    worker = DownloadWorker()
    monkeypatch.setattr(worker_module, "SessionLocal", Session)
    monkeypatch.setattr(worker, "_publish", lambda _job_id: None)

    worker._mark_failed(job_id, RuntimeError("provider failed"))

    with Session() as session:
        failed = session.get(DownloadJob, job_id)
        item = session.query(AlbumDownloadItem).filter(AlbumDownloadItem.download_job_id == job_id).one()
        album_job = item.album_job
        assert failed.status == DownloadStatus.FAILED
        assert failed.stage == DownloadStage.FAILED
        assert failed.error_message == "Download failed. The video may be unavailable or unsupported."
        assert failed.queue_item.status == DownloadStatus.FAILED
        assert item.status == DownloadStatus.FAILED
        assert album_job.failed_tracks == 1
        assert album_job.progress == 100
        assert album_job.status == DownloadStatus.FAILED


@pytest.mark.parametrize(
    ("error", "message"),
    [
        (RuntimeError("ffmpeg missing"), "Audio conversion failed. Confirm FFmpeg is installed and available."),
        (PermissionError("permission denied"), "ANM Player could not write to the configured music directory."),
        (RuntimeError("cancelled"), "Download was cancelled."),
    ],
)
def test_worker_errors_are_stable_and_do_not_leak_upstream_text(error, message) -> None:
    assert DownloadWorker()._friendly_error(error) == message


def test_worker_progress_formatting_helpers() -> None:
    worker = DownloadWorker()
    assert worker._percent({"downloaded_bytes": 50, "total_bytes": 100}) == 45
    assert worker._percent({}) == 0
    assert worker._format_speed(2_000_000) == "2.0 MB/s"
    assert worker._format_speed(50_000) == "50 KB/s"
    assert worker._format_speed(None) is None
    assert worker._format_eta(65) == "1:05"
    assert worker._format_eta(None) is None
    assert worker._year_from_date("20260722") == 2026
    assert worker._year_from_date(None) is None
    assert worker._year_from_date("bad") is None


def test_worker_start_stop_and_single_run_cycle(monkeypatch) -> None:
    worker = DownloadWorker()
    started: list[str] = []
    joined: list[str] = []

    class FakeThread:
        def __init__(self, *, target, name: str, daemon: bool) -> None:
            assert target == worker._run and daemon is True
            self.name = name
            self.running = False

        def is_alive(self) -> bool:
            return self.running

        def start(self) -> None:
            self.running = True
            started.append(self.name)

        def join(self, *, timeout: int) -> None:
            assert timeout == 5
            self.running = False
            joined.append(self.name)

    monkeypatch.setattr(worker_module.threading, "Thread", FakeThread)
    worker.start()
    worker.start()
    worker.stop()

    assert len(started) == 8
    assert joined == started

    cycles: list[bool] = []

    def work_once() -> None:
        cycles.append(True)
        worker._stop_event.set()

    monkeypatch.setattr(worker, "_work_once", work_once)
    worker._stop_event.clear()
    worker._run()
    assert cycles == [True]


def test_claim_next_job_updates_queue_and_honors_storage_gate(monkeypatch) -> None:
    Session = worker_session_factory()
    with Session() as session:
        job = DownloadJob(status=DownloadStatus.QUEUED, source_url="https://example.com/claim")
        session.add(job)
        session.flush()
        session.add(QueueItem(download_job_id=job.id, status=DownloadStatus.QUEUED))
        session.commit()
        job_id = job.id
    worker = DownloadWorker()
    published: list[int] = []
    monkeypatch.setattr(worker_module, "SessionLocal", Session)
    monkeypatch.setattr(worker, "_publish", published.append)

    assert worker._claim_next_job() == job_id
    assert published == [job_id]
    with Session() as session:
        assert session.get(DownloadJob, job_id).status == DownloadStatus.PREPARING
        assert session.query(QueueItem).one().status == DownloadStatus.PREPARING

    worker_module.storage_coordinator.stop_claiming.set()
    try:
        assert worker._claim_next_job() is None
    finally:
        worker_module.storage_coordinator.stop_claiming.clear()


def test_mark_failed_returns_job_to_queue_during_storage_migration(monkeypatch) -> None:
    Session = worker_session_factory()
    with Session() as session:
        job = DownloadJob(status=DownloadStatus.DOWNLOADING, source_url="https://example.com/migrate")
        session.add(job)
        session.flush()
        session.add(QueueItem(download_job_id=job.id, status=DownloadStatus.DOWNLOADING))
        session.commit()
        job_id = job.id
    worker = DownloadWorker()
    monkeypatch.setattr(worker_module, "SessionLocal", Session)
    worker_module.storage_coordinator.cancel_work.set()
    try:
        worker._mark_failed(job_id, RuntimeError("interrupted"))
    finally:
        worker_module.storage_coordinator.cancel_work.clear()

    with Session() as session:
        job = session.get(DownloadJob, job_id)
        assert job.status == DownloadStatus.QUEUED
        assert job.stage == DownloadStage.QUEUED
        assert job.queue_item.status == DownloadStatus.QUEUED


def test_progress_updates_album_and_storage_migration_requeues(monkeypatch) -> None:
    Session = worker_session_factory()
    with Session() as session:
        album = LibraryAlbum(public_id="progress", external_id="progress", title="Album")
        track = LibraryTrack(external_id="track", title="Track", position=0)
        session.add_all([album, track])
        session.flush()
        album_job = AlbumDownloadJob(album_id=album.id, total_tracks=1, max_parallel=1)
        job = DownloadJob(status=DownloadStatus.QUEUED, source_url="https://example.com/progress")
        session.add_all([album_job, job])
        session.flush()
        session.add_all(
            [
                QueueItem(download_job_id=job.id, status=DownloadStatus.QUEUED),
                AlbumDownloadItem(album_job_id=album_job.id, track_id=track.id, download_job_id=job.id),
            ]
        )
        session.commit()
        job_id = job.id
    worker = DownloadWorker()
    monkeypatch.setattr(worker_module, "SessionLocal", Session)
    monkeypatch.setattr(worker, "_publish", lambda _job_id: None)

    worker._update_progress(job_id, {"status": "downloading", "downloaded_bytes": 25, "total_bytes": 100})
    with Session() as session:
        item = session.query(AlbumDownloadItem).one()
        assert item.status == DownloadStatus.DOWNLOADING
        assert item.album_job.status == DownloadStatus.DOWNLOADING
        assert item.album_job.progress == item.progress

    worker_module.storage_coordinator.cancel_work.set()
    try:
        with pytest.raises(RuntimeError, match="storage migration"):
            worker._update_progress(job_id, {"status": "downloading"})
    finally:
        worker_module.storage_coordinator.cancel_work.clear()


def test_album_download_finalization_links_existing_song_and_artwork(
    music_directory, monkeypatch
) -> None:
    Session = worker_session_factory()
    with Session() as session:
        SettingsService(session).set_value("auto_fetch_lyrics", True)
        SettingsService(session).set_value("auto_enrich_downloads", True)
        album = LibraryAlbum(public_id="album-final", external_id="album-final", title="Album")
        track = LibraryTrack(external_id="track", title="Track", position=0)
        existing = Song(title="Old", source_url="https://example.com/album-track", is_downloaded=False)
        session.add_all([album, track, existing])
        session.flush()
        album_job = AlbumDownloadJob(album_id=album.id, total_tracks=1, max_parallel=1)
        job = DownloadJob(
            status=DownloadStatus.PROCESSING,
            source_url="https://example.com/album-track",
            title="Track",
            artist="Artist",
            album="Album",
            thumbnail_url="https://example.com/art.jpg",
            audio_format="mp3",
        )
        session.add_all([album_job, job])
        session.flush()
        session.add(AlbumDownloadItem(album_job_id=album_job.id, track_id=track.id, download_job_id=job.id))
        session.commit()
        job_id = job.id
        song_id = existing.id
    output = music_directory.parent / "source.mp3"
    output.write_bytes(b"audio")
    worker = DownloadWorker()
    monkeypatch.setattr(worker_module, "SessionLocal", Session)
    monkeypatch.setattr(worker, "_publish", lambda _job_id: None)
    monkeypatch.setattr(worker.tagging, "write_tags", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(worker, "_cache_artwork", lambda _url: "/media/artwork/downloads/cached.jpg")
    monkeypatch.setattr(worker, "_fetch_lyrics", lambda *_args: (_ for _ in ()).throw(RuntimeError("lyrics")))
    monkeypatch.setattr(worker, "_enrich_song", lambda *_args: (_ for _ in ()).throw(RuntimeError("metadata")))

    worker._save_download(job_id, {"duration": 222, "release_year": 2026}, output)

    with Session() as session:
        job = session.get(DownloadJob, job_id)
        song = session.get(Song, song_id)
        item = session.query(AlbumDownloadItem).one()
        assert job.status == DownloadStatus.COMPLETED
        assert song.is_downloaded is True
        assert song.artwork_url == "https://example.com/art.jpg"
        assert song.artwork_path == "/media/artwork/downloads/cached.jpg"
        assert item.status == DownloadStatus.COMPLETED
        assert item.track.song_id == song.id
        assert item.album_job.completed_tracks == 1
        assert item.album_job.status == DownloadStatus.COMPLETED
        assert item.album_job.album.local_album_id is not None


def test_publish_group_fallback_output_and_async_helpers(music_directory, monkeypatch) -> None:
    Session = worker_session_factory()
    with Session() as session:
        job = DownloadJob(
            status=DownloadStatus.QUEUED,
            source_url="https://example.com/publish",
            search_query="album:public-id",
            album="Album",
        )
        session.add(job)
        session.commit()
        job_id = job.id
    worker = DownloadWorker()
    published: list[dict] = []
    monkeypatch.setattr(worker_module, "SessionLocal", Session)
    monkeypatch.setattr(worker_module.download_progress_hub, "publish_threadsafe", lambda _id, payload: published.append(payload))
    worker._publish(job_id)
    assert published[0]["group"]["album_id"] == "public-id"

    work = music_directory.parent / "fallback"
    work.mkdir()
    fallback = work / "download.webm"
    fallback.write_bytes(b"audio")
    assert worker._find_output_file(work, "mp3") == fallback
    fallback.unlink()
    with pytest.raises(RuntimeError, match="not found"):
        worker._find_output_file(work, "mp3")

    cached = music_directory.parent / "cache" / "art.jpg"
    cached.parent.mkdir(exist_ok=True)
    cached.write_bytes(b"image")

    class FakeArtworkCache:
        def __init__(self, _path) -> None:
            pass

        async def download_and_cache(self, _url):
            return cached

    monkeypatch.setattr(worker_module, "ArtworkCacheService", FakeArtworkCache)
    result = worker._cache_artwork("https://example.com/art.jpg")
    assert result == "/media/artwork/downloads/art.jpg"
    assert worker._cache_artwork(None) is None
