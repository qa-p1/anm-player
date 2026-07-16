from enum import StrEnum


class DownloadStatus(StrEnum):
    QUEUED = "queued"
    PREPARING = "preparing"
    DOWNLOADING = "downloading"
    PROCESSING = "processing"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class DownloadStage(StrEnum):
    QUEUED = "Queued"
    PREPARING = "Preparing..."
    DOWNLOADING = "Downloading..."
    EXTRACTING = "Extracting Audio..."
    CONVERTING = "Converting..."
    PAUSED = "Paused"
    SAVING = "Saving..."
    COMPLETED = "Completed"
    FAILED = "Failed"
    CANCELLED = "Cancelled"
