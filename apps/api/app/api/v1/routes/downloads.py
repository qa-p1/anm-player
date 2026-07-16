from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.deps import LimitQuery, OffsetQuery, get_download_service, get_placeholder_service, require_operator
from app.schemas.common import PlaceholderResponse
from app.schemas.music import DownloadBatchCreateRequest, DownloadCreateRequest, DownloadJobResponse
from app.services import DownloadService, PlaceholderService

router = APIRouter()


@router.get("", response_model=list[DownloadJobResponse], summary="List download jobs")
def list_download_jobs(
    service: Annotated[DownloadService, Depends(get_download_service)],
    limit: LimitQuery = 50,
    offset: OffsetQuery = 0,
) -> list[DownloadJobResponse]:
    return service.list_jobs(limit=limit, offset=offset)


@router.post("", response_model=DownloadJobResponse, status_code=201, summary="Queue a download", dependencies=[Depends(require_operator)])
def queue_download(
    request: DownloadCreateRequest,
    service: Annotated[DownloadService, Depends(get_download_service)],
) -> DownloadJobResponse:
    return service.enqueue(request)


@router.post("/batch", response_model=list[DownloadJobResponse], status_code=201, summary="Queue multiple downloads", dependencies=[Depends(require_operator)])
def queue_download_batch(
    request: DownloadBatchCreateRequest,
    service: Annotated[DownloadService, Depends(get_download_service)],
) -> list[DownloadJobResponse]:
    return [service.enqueue(item) for item in request.items]


@router.post("/{job_id}/cancel", response_model=DownloadJobResponse, summary="Cancel a download", dependencies=[Depends(require_operator)])
def cancel_download(job_id: int, service: Annotated[DownloadService, Depends(get_download_service)]) -> DownloadJobResponse:
    return service.cancel(job_id)


@router.post("/{job_id}/retry", response_model=DownloadJobResponse, summary="Retry a failed or cancelled download", dependencies=[Depends(require_operator)])
def retry_download(job_id: int, service: Annotated[DownloadService, Depends(get_download_service)]) -> DownloadJobResponse:
    return service.retry(job_id)


@router.post("/{job_id}/pause", response_model=DownloadJobResponse, summary="Pause a download", dependencies=[Depends(require_operator)])
def pause_download(job_id: int, service: Annotated[DownloadService, Depends(get_download_service)]) -> DownloadJobResponse:
    return service.pause(job_id)


@router.post("/{job_id}/resume", response_model=DownloadJobResponse, summary="Resume a paused download", dependencies=[Depends(require_operator)])
def resume_download(job_id: int, service: Annotated[DownloadService, Depends(get_download_service)]) -> DownloadJobResponse:
    return service.resume(job_id)


@router.delete("/completed", response_model=dict[str, int], summary="Remove completed downloads", dependencies=[Depends(require_operator)])
def remove_completed_downloads(service: Annotated[DownloadService, Depends(get_download_service)]) -> dict[str, int]:
    return {"removed": service.remove_completed()}


@router.get("/placeholder", response_model=PlaceholderResponse, summary="Download architecture placeholder")
def downloads_placeholder(service: Annotated[PlaceholderService, Depends(get_placeholder_service)]) -> PlaceholderResponse:
    return service.response(
        feature="downloads",
        message="Download queue API structure is active. Pause and resume remain future extension points.",
        extension_points=["parallel workers", "pause/resume", "playlist downloads"],
    )
