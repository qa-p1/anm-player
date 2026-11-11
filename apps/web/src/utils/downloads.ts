import type { DownloadJob } from "@/types/api";

const ACTIVE_DOWNLOAD_STATUSES = new Set<DownloadJob["status"]>(["queued", "preparing", "downloading", "processing", "paused"]);

export function isActiveDownload(job: Pick<DownloadJob, "status">): boolean {
  return ACTIVE_DOWNLOAD_STATUSES.has(job.status);
}

export function isRunningDownload(job: Pick<DownloadJob, "status">): boolean {
  return job.status === "preparing" || job.status === "downloading" || job.status === "processing";
}

/** Short, human status line for one job. */
export function downloadStatusText(job: DownloadJob): string {
  switch (job.status) {
    case "queued": return "Waiting";
    case "preparing": return "Starting…";
    case "downloading": return [`${Math.round(job.progress)}%`, job.speed, job.eta && `${job.eta} left`].filter(Boolean).join(" · ");
    case "processing": return /convert|extract/i.test(job.stage) ? "Converting…" : "Saving…";
    case "paused": return `Paused · ${Math.round(job.progress)}%`;
    case "completed": return "Downloaded";
    case "cancelled": return "Cancelled";
    case "failed": return job.error_message || "Failed";
    default: return job.stage;
  }
}

/**
 * The jobs of the current download run: everything unfinished plus whatever
 * finished since it started, so progress only ever moves forward.
 */
export function currentBatch(jobs: DownloadJob[]): DownloadJob[] {
  const active = jobs.filter(isActiveDownload);
  if (active.length === 0) return [];
  const since = active.reduce((earliest, job) => (job.created_at < earliest ? job.created_at : earliest), active[0].created_at);
  return jobs.filter((job) => isActiveDownload(job) || (job.status === "completed" && job.created_at >= since));
}

export interface DownloadSummary {
  total: number;
  running: number;
  waiting: number;
  paused: number;
  failed: number;
  done: number;
  /** 0-100 across unfinished work, counting finished jobs of the same batch. */
  progress: number;
}

export function summarizeDownloads(jobs: DownloadJob[]): DownloadSummary {
  const running = jobs.filter(isRunningDownload).length;
  const waiting = jobs.filter((job) => job.status === "queued").length;
  const paused = jobs.filter((job) => job.status === "paused").length;
  const failed = jobs.filter((job) => job.status === "failed").length;
  const done = jobs.filter((job) => job.status === "completed").length;
  const counted = jobs.filter((job) => job.status !== "cancelled");
  const progress = counted.length ? counted.reduce((sum, job) => sum + (job.status === "completed" ? 100 : job.progress), 0) / counted.length : 0;
  return { total: jobs.length, running, waiting, paused, failed, done, progress: Math.round(progress) };
}

export interface DownloadGroup {
  key: string;
  type: "album" | "playlist";
  id: string;
  title: string;
  href: string;
  jobs: DownloadJob[];
}

/** Albums and playlists become one group each; everything else stays a single row. */
export function groupDownloads(jobs: DownloadJob[]): { groups: DownloadGroup[]; singles: DownloadJob[] } {
  const groups = new Map<string, DownloadGroup>();
  const singles: DownloadJob[] = [];
  for (const job of jobs) {
    if (!job.group) {
      singles.push(job);
      continue;
    }
    const key = `${job.group.type}:${job.group.album_id}`;
    const group = groups.get(key) ?? { key, type: job.group.type, id: job.group.album_id, title: job.group.type === "album" ? job.album || job.group.title : job.group.title, href: job.group.canonical_url, jobs: [] };
    group.jobs.push(job);
    groups.set(key, group);
  }
  return { groups: [...groups.values()], singles };
}
