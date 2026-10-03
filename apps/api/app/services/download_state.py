import threading
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.enums import DownloadStage, DownloadStatus
from app.models import AlbumDownloadItem, AlbumDownloadJob, DownloadJob, QueueItem

_ACTIVE_STATUS_PRIORITY = (
    DownloadStatus.DOWNLOADING,
    DownloadStatus.PROCESSING,
    DownloadStatus.PREPARING,
    DownloadStatus.QUEUED,
    DownloadStatus.PAUSED,
)

# Statuses that only make sense while a worker thread in this process owns the job.
WORKER_OWNED_STATUSES = (
    DownloadStatus.PREPARING,
    DownloadStatus.DOWNLOADING,
    DownloadStatus.PROCESSING,
)

_owned_jobs: set[int] = set()
_owned_jobs_lock = threading.Lock()


def claim_job_ownership(job_id: int) -> None:
    with _owned_jobs_lock:
        _owned_jobs.add(job_id)


def release_job_ownership(job_id: int) -> None:
    with _owned_jobs_lock:
        _owned_jobs.discard(job_id)


def is_job_owned(job_id: int) -> bool:
    with _owned_jobs_lock:
        return job_id in _owned_jobs


def requeue_orphaned_downloads(session: Session) -> list[int]:
    """Return jobs abandoned by a previous process to the queue.

    A crash, restart, or Ctrl+C can stop a worker thread mid-download. Its job
    then keeps an active status forever: it counts toward the concurrency cap,
    blocks re-queueing as a duplicate, and cannot be retried.
    """
    orphaned = [
        job
        for job in session.scalars(select(DownloadJob).where(DownloadJob.status.in_(WORKER_OWNED_STATUSES)))
        if not is_job_owned(job.id)
    ]
    for job in orphaned:
        job.status = DownloadStatus.QUEUED
        job.stage = DownloadStage.QUEUED
        job.progress = 0
        job.speed = None
        job.eta = None
        sync_linked_album_download(session, job)
    if orphaned:
        session.execute(
            update(QueueItem)
            .where(QueueItem.download_job_id.in_([job.id for job in orphaned]))
            .values(status=DownloadStatus.QUEUED)
        )
        session.commit()
    return [job.id for job in orphaned]


def sync_linked_album_download(session: Session, job: DownloadJob) -> None:
    """Mirror a track download into its parent album job and recompute totals."""
    item = session.scalars(
        select(AlbumDownloadItem).where(AlbumDownloadItem.download_job_id == job.id)
    ).first()
    if item is None:
        return

    item.status = job.status
    item.progress = 0 if job.status == DownloadStatus.CANCELLED else job.progress
    item.error_message = job.error_message if job.status == DownloadStatus.FAILED else None
    reconcile_album_download(item.album_job)


def reconcile_album_download(album_job: AlbumDownloadJob) -> None:
    """Derive an album job solely from its items so no child can leave it stale."""
    items = list(album_job.items)
    if not items:
        return

    album_job.completed_tracks = sum(
        1 for item in items if item.status == DownloadStatus.COMPLETED
    )
    album_job.failed_tracks = sum(
        1 for item in items if item.status == DownloadStatus.FAILED
    )
    effective_progress = sum(
        100
        if item.status in {DownloadStatus.COMPLETED, DownloadStatus.FAILED}
        else item.progress
        for item in items
    )
    album_job.progress = int(effective_progress / max(album_job.total_tracks, 1))

    statuses = {item.status for item in items}
    active_status = next(
        (status for status in _ACTIVE_STATUS_PRIORITY if status in statuses),
        None,
    )
    if active_status is not None:
        album_job.status = active_status
        album_job.completed_at = None
        album_job.error_message = None
        return

    album_job.completed_at = album_job.completed_at or datetime.now(UTC)
    if statuses == {DownloadStatus.COMPLETED}:
        album_job.status = DownloadStatus.COMPLETED
        album_job.error_message = None
    elif DownloadStatus.FAILED in statuses:
        album_job.status = DownloadStatus.FAILED
        album_job.error_message = next(
            (
                item.error_message
                for item in items
                if item.status == DownloadStatus.FAILED and item.error_message
            ),
            "One or more tracks could not be downloaded.",
        )
    else:
        album_job.status = DownloadStatus.CANCELLED
        album_job.error_message = "Album download cancelled"
