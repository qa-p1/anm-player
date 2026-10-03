import type { DownloadJob } from "@/types/api";

const ACTIVE_DOWNLOAD_STATUSES = new Set<DownloadJob["status"]>(["queued", "preparing", "downloading", "processing", "paused"]);

export function isActiveDownload(job: Pick<DownloadJob, "status">): boolean {
  return ACTIVE_DOWNLOAD_STATUSES.has(job.status);
}
