import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.enums import DownloadStatus
from app.core.exceptions import ConflictError
from app.models import AlbumDownloadItem, AlbumDownloadJob, Base, DownloadJob, LibraryAlbum, LibraryTrack, QueueItem
from app.repositories.music import DownloadJobRepository, QueueItemRepository
from app.schemas.music import DownloadCreateRequest
from app.services.downloads import DownloadService
from app.services.settings import SettingsService
from app.workers.downloads.worker import DownloadWorker, _download_album_name


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)()


def make_service(session) -> DownloadService:
    return DownloadService(DownloadJobRepository(session), QueueItemRepository(session))


def test_equivalent_youtube_url_cannot_be_queued_concurrently() -> None:
    with make_session() as session:
        service = make_service(session)
        service.enqueue(DownloadCreateRequest(source_url="https://youtu.be/video-id"))

        with pytest.raises(ConflictError):
            service.enqueue(DownloadCreateRequest(source_url="https://music.youtube.com/watch?v=video-id&list=abc"))


def test_download_snapshots_format_and_explicit_false_overrides_global_default() -> None:
    with make_session() as session:
        runtime = SettingsService(session)
        runtime.set_value("download_audio_format", "flac")
        runtime.set_value("download_overwrite_existing", True)
        session.commit()

        response = make_service(session).enqueue(
            DownloadCreateRequest(source_url="https://example.com/snapshot", overwrite_existing=False)
        )
        job = session.get(DownloadJob, response.id)

        assert job is not None
        assert job.audio_format == "flac"
        assert job.overwrite_existing is False


def test_retry_rejects_completed_download() -> None:
    with make_session() as session:
        job = DownloadJob(status=DownloadStatus.COMPLETED, source_url="https://example.com/song")
        session.add(job)
        session.commit()

        with pytest.raises(ConflictError):
            make_service(session).retry(job.id)


def test_pause_and_resume_update_active_job() -> None:
    with make_session() as session:
        service = make_service(session)
        response = service.enqueue(DownloadCreateRequest(source_url="https://example.com/song"))

        paused = service.pause(response.id)
        resumed = service.resume(response.id)

    assert paused.status == DownloadStatus.PAUSED
    assert resumed.status == DownloadStatus.QUEUED


def test_download_response_includes_album_grouping_key() -> None:
    with make_session() as session:
        response = make_service(session).enqueue(
            DownloadCreateRequest(
                source_url="https://example.com/album-track",
                search_query="album:external-album-id",
            )
        )

    assert response.search_query == "album:external-album-id"


def test_database_claim_transition_prevents_second_claim() -> None:
    with make_session() as session:
        session.add(DownloadJob(status=DownloadStatus.QUEUED, source_url="https://example.com/song"))
        session.commit()
        repository = DownloadJobRepository(session)

        first = repository.claim_next_queued()
        second = repository.claim_next_queued()

    assert first is not None
    assert second is None


def test_worker_cleans_partial_job_directory_after_failure(tmp_path, monkeypatch) -> None:
    worker = DownloadWorker()
    monkeypatch.setattr(worker, "_download_jobs_dir", lambda: tmp_path / "jobs")
    monkeypatch.setattr(worker, "_claim_next_job", lambda: 7)
    monkeypatch.setattr(worker, "_mark_failed", lambda job_id, exc: None)

    def fail_download(job_id: int) -> None:
        job_dir = tmp_path / "jobs" / str(job_id)
        job_dir.mkdir(parents=True)
        (job_dir / "partial.webm.part").write_bytes(b"partial")
        raise RuntimeError("Download cancelled")

    monkeypatch.setattr(worker, "_download_job", fail_download)
    worker._work_once()

    assert not (tmp_path / "jobs" / "7").exists()


def test_standalone_download_does_not_invent_an_album() -> None:
    assert _download_album_name(None) is None
    assert _download_album_name("   ") is None
    assert _download_album_name("OK Computer") == "OK Computer"


def test_remove_completed_also_removes_queue_item() -> None:
    with make_session() as session:
        job = DownloadJob(status=DownloadStatus.COMPLETED, source_url="https://example.com/song")
        session.add(job)
        session.flush()
        session.add(QueueItem(download_job=job, status=DownloadStatus.COMPLETED))
        session.commit()

        removed = make_service(session).remove_completed()

        assert removed == 1
        assert session.query(QueueItem).count() == 0


def test_album_job_parallelism_limits_worker_claims() -> None:
    with make_session() as session:
        album = LibraryAlbum(public_id="album", external_id="album", title="Album")
        tracks = [LibraryTrack(external_id=f"track-{index}", title=f"Track {index}", position=index) for index in range(2)]
        session.add_all([album, *tracks])
        session.flush()
        album_job = AlbumDownloadJob(album_id=album.id, max_parallel=1, total_tracks=2)
        session.add(album_job)
        session.flush()
        active = DownloadJob(status=DownloadStatus.DOWNLOADING, source_url="https://example.com/active")
        queued = DownloadJob(status=DownloadStatus.QUEUED, source_url="https://example.com/queued")
        session.add_all([active, queued])
        session.flush()
        session.add_all([
            AlbumDownloadItem(album_job_id=album_job.id, track_id=tracks[0].id, download_job_id=active.id),
            AlbumDownloadItem(album_job_id=album_job.id, track_id=tracks[1].id, download_job_id=queued.id),
        ])
        session.commit()
        repository = DownloadJobRepository(session)

        assert repository.claim_next_queued() is None
        active.status = DownloadStatus.COMPLETED
        session.commit()
        assert repository.claim_next_queued() == queued.id


def test_batch_enqueue_is_atomic_when_any_item_conflicts() -> None:
    with make_session() as session:
        service = make_service(session)
        service.enqueue(DownloadCreateRequest(source_url="https://example.com/existing"))
        before = session.query(DownloadJob).count()

        with pytest.raises(ConflictError):
            service.enqueue_batch([
                DownloadCreateRequest(source_url="https://example.com/new"),
                DownloadCreateRequest(source_url="https://example.com/existing"),
            ])

        assert session.query(DownloadJob).count() == before
        assert session.query(DownloadJob).filter(DownloadJob.source_url.contains("/new")).count() == 0


def test_cancel_updates_queue_and_album_state_together() -> None:
    with make_session() as session:
        album = LibraryAlbum(public_id="album", external_id="album", title="Album")
        track = LibraryTrack(external_id="track", title="Track", position=0)
        session.add_all([album, track])
        session.flush()
        album_job = AlbumDownloadJob(album_id=album.id, status=DownloadStatus.QUEUED, total_tracks=1, max_parallel=1)
        job = DownloadJob(status=DownloadStatus.QUEUED, source_url="https://example.com/song")
        session.add_all([album_job, job])
        session.flush()
        queue = QueueItem(download_job=job, status=DownloadStatus.QUEUED)
        item = AlbumDownloadItem(album_job_id=album_job.id, track_id=track.id, download_job_id=job.id)
        session.add_all([queue, item])
        session.commit()

        make_service(session).cancel(job.id)

        assert job.status == DownloadStatus.CANCELLED
        assert queue.status == DownloadStatus.CANCELLED
        assert item.status == DownloadStatus.CANCELLED
        assert album_job.status == DownloadStatus.CANCELLED
