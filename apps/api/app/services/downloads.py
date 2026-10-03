from datetime import UTC, datetime

from app.core.enums import DownloadStage, DownloadStatus
from app.core.exceptions import ConflictError, ResourceNotFoundError
from app.models import DownloadJob, QueueItem
from app.repositories.music import DownloadJobRepository, QueueItemRepository
from app.schemas.music import DownloadCreateRequest, DownloadGroupRef, DownloadJobResponse
from app.services.download_state import is_job_owned, sync_linked_album_download
from app.services.websocket_manager import download_progress_hub
from app.services.settings import SettingsService


class DownloadService:
    def __init__(self, downloads: DownloadJobRepository, queue_items: QueueItemRepository) -> None:
        self.downloads = downloads
        self.queue_items = queue_items

    def list_jobs(self, *, limit: int = 50, offset: int = 0) -> list[DownloadJobResponse]:
        return [
            self._response(job)
            for job in self.downloads.list_in_queue_order(limit=limit, offset=offset)
        ]

    def enqueue(self, request: DownloadCreateRequest) -> DownloadJobResponse:
        try:
            job = self._prepare(request)
            self.downloads.session.commit()
        except Exception:
            self.downloads.session.rollback()
            raise
        download_progress_hub.publish_threadsafe(job.id, self._to_event(job))
        return self._response(job)

    def enqueue_batch(self, requests: list[DownloadCreateRequest]) -> list[DownloadJobResponse]:
        jobs: list[DownloadJob] = []
        try:
            for request in requests:
                jobs.append(self._prepare(request))
            self.downloads.session.commit()
        except Exception:
            self.downloads.session.rollback()
            raise
        for job in jobs:
            download_progress_hub.publish_threadsafe(job.id, self._to_event(job))
        return [self._response(job) for job in jobs]

    def _prepare(self, request: DownloadCreateRequest) -> DownloadJob:
        source_url = str(request.source_url)
        duplicate = self.downloads.find_duplicate(source_url)
        runtime = SettingsService(self.downloads.session)
        overwrite = (
            runtime.get_bool("download_overwrite_existing", False)
            if request.overwrite_existing is None
            else request.overwrite_existing
        )
        if duplicate and (duplicate.status != DownloadStatus.COMPLETED or not overwrite):
            raise ConflictError(
                "This song is already queued, downloading, or downloaded.",
                details={"download_job_id": duplicate.id},
            )

        job = DownloadJob(
            status=DownloadStatus.QUEUED,
            stage=DownloadStage.QUEUED,
            source_url=source_url,
            video_id=request.video_id,
            title=request.title,
            artist=request.artist,
            album=request.album,
            thumbnail_url=request.thumbnail_url,
            search_query=request.search_query,
            overwrite_existing=overwrite,
            audio_format=runtime.get_str("download_audio_format", "mp3"),
        )
        self.downloads.add(job)
        self.queue_items.add(QueueItem(download_job=job, status=DownloadStatus.QUEUED, item_type="download"))
        return job

    def cancel(self, job_id: int) -> DownloadJobResponse:
        job = self._get_job(job_id)
        if job.status in {DownloadStatus.COMPLETED, DownloadStatus.FAILED, DownloadStatus.CANCELLED}:
            return self._response(job)
        job.status = DownloadStatus.CANCELLED
        job.stage = DownloadStage.CANCELLED
        job.cancelled_at = datetime.now(UTC)
        if job.queue_item:
            job.queue_item.status = DownloadStatus.CANCELLED
        sync_linked_album_download(self.downloads.session, job)
        self.downloads.session.commit()
        download_progress_hub.publish_threadsafe(job.id, self._to_event(job))
        return self._response(job)

    def retry(self, job_id: int) -> DownloadJobResponse:
        job = self._get_job(job_id)
        if job.status not in {DownloadStatus.FAILED, DownloadStatus.CANCELLED}:
            raise ConflictError(
                "Only failed or cancelled downloads can be retried.",
                details={"download_job_id": job.id, "status": job.status},
            )
        job.status = DownloadStatus.QUEUED
        job.stage = DownloadStage.QUEUED
        job.progress = 0
        job.error_message = None
        job.cancelled_at = None
        job.completed_at = None
        if job.queue_item:
            job.queue_item.status = DownloadStatus.QUEUED
        else:
            self.queue_items.add(QueueItem(download_job=job, status=DownloadStatus.QUEUED, item_type="download"))
        sync_linked_album_download(self.downloads.session, job)
        self.downloads.session.commit()
        download_progress_hub.publish_threadsafe(job.id, self._to_event(job))
        return self._response(job)

    def pause(self, job_id: int) -> DownloadJobResponse:
        job = self._get_job(job_id)
        if job.status not in {
            DownloadStatus.QUEUED,
            DownloadStatus.DOWNLOADING,
            DownloadStatus.PROCESSING,
        }:
            raise ConflictError("Only active downloads can be paused.", details={"download_job_id": job.id, "status": job.status})
        job.status = DownloadStatus.PAUSED
        job.stage = DownloadStage.PAUSED
        if job.queue_item:
            job.queue_item.status = DownloadStatus.PAUSED
        sync_linked_album_download(self.downloads.session, job)
        self.downloads.session.commit()
        download_progress_hub.publish_threadsafe(job.id, self._to_event(job))
        return self._response(job)

    def resume(self, job_id: int) -> DownloadJobResponse:
        job = self._get_job(job_id)
        if job.status != DownloadStatus.PAUSED:
            raise ConflictError("Only paused downloads can be resumed.", details={"download_job_id": job.id, "status": job.status})
        # Only a job still held by a live worker thread can continue in place.
        # A job paused before a restart has no owner and must be claimed again.
        resumed_status = (
            DownloadStatus.DOWNLOADING
            if job.progress > 0 and is_job_owned(job.id)
            else DownloadStatus.QUEUED
        )
        job.status = resumed_status
        job.stage = DownloadStage.DOWNLOADING if resumed_status == DownloadStatus.DOWNLOADING else DownloadStage.QUEUED
        if job.queue_item:
            job.queue_item.status = resumed_status
        sync_linked_album_download(self.downloads.session, job)
        self.downloads.session.commit()
        download_progress_hub.publish_threadsafe(job.id, self._to_event(job))
        return self._response(job)

    def remove_completed(self) -> int:
        removed = 0
        while True:
            completed = self.downloads.list_by_statuses([DownloadStatus.COMPLETED], limit=500)
            if not completed:
                return removed
            for job in completed:
                if job.queue_item:
                    self.queue_items.delete(job.queue_item)
                self.downloads.delete(job)
            self.downloads.session.commit()
            removed += len(completed)
            if len(completed) < 500:
                return removed

    def _get_job(self, job_id: int) -> DownloadJob:
        job = self.downloads.get(job_id)
        if not job:
            raise ResourceNotFoundError("Download job not found.", details={"job_id": job_id})
        return job

    def _to_event(self, job: DownloadJob) -> dict[str, object]:
        return self._response(job).model_dump(mode="json")

    def _response(self, job: DownloadJob) -> DownloadJobResponse:
        return download_job_response(job)


def download_job_response(job: DownloadJob) -> DownloadJobResponse:
    response = DownloadJobResponse.model_validate(job, from_attributes=True)
    if job.search_query and job.search_query.startswith("album:"):
        public_id = job.search_query.removeprefix("album:")
        response.group = DownloadGroupRef(
            album_id=public_id,
            title=job.album or "Album download",
            canonical_url=f"/albums/{public_id}",
        )
    return response
