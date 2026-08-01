import { motion } from "framer-motion";
import { ChevronDown, Disc3, Pause, Play, RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { ArtworkImage } from "@/components/cards/artwork-image";
import { Button } from "@/components/ui/button";
import { cachedArtworkUrl, getDownloadEventsUrl } from "@/services/api-client";
import { listAllDownloads } from "@/services/music-api";
import type { DownloadJob } from "@/types/api";

interface DownloadsPanelProps {
  jobs: DownloadJob[];
  onJobUpdate: (job: DownloadJob) => void;
  onCancel: (jobId: number) => void;
  onRetry: (jobId: number) => void;
  onPause: (jobId: number) => void;
  onResume: (jobId: number) => void;
  onRemoveCompleted: () => void;
  onCancelAlbum: (albumId: string) => void;
}

export function DownloadsPanel({ jobs, onJobUpdate, onCancel, onRetry, onPause, onResume, onRemoveCompleted, onCancelAlbum }: DownloadsPanelProps) {
  const updateRef = useRef(onJobUpdate);
  useEffect(() => {
    updateRef.current = onJobUpdate;
  }, [onJobUpdate]);
  const activeIds = jobs
    .filter((job) => ["queued", "preparing", "downloading", "processing", "paused"].includes(job.status))
    .map((job) => job.id);
  const activeKey = activeIds.join(",");

  useEffect(() => {
    const jobIds = activeKey ? activeKey.split(",").map(Number) : [];
    const sockets = new Set<WebSocket>();
    const reconnectTimers = new Set<number>();
    let pollTimer: number | null = null;
    let stopped = false;

    function poll() {
      void listAllDownloads()
        .then((snapshot) => snapshot.forEach((job) => updateRef.current(job)))
        .catch(() => undefined);
    }

    function startPolling() {
      if (pollTimer !== null || stopped) return;
      poll();
      pollTimer = window.setInterval(poll, 5000);
    }

    function connect(jobId: number, failures = 0) {
      if (stopped) return;
      let socket: WebSocket;
      try {
        socket = new WebSocket(getDownloadEventsUrl(jobId));
      } catch {
        scheduleReconnect(jobId, failures + 1);
        return;
      }
      sockets.add(socket);
      let receivedValidMessage = false;
      socket.onmessage = (event) => {
        const job = parseDownloadEvent(event.data);
        if (!job || job.id !== jobId) return;
        receivedValidMessage = true;
        updateRef.current(job);
      };
      socket.onerror = () => socket.close();
      socket.onclose = () => {
        sockets.delete(socket);
        if (!stopped) scheduleReconnect(jobId, receivedValidMessage ? 0 : failures + 1);
      };
    }

    function scheduleReconnect(jobId: number, failures: number) {
      if (failures >= 5) {
        startPolling();
        return;
      }
      const delay = Math.min(1000 * 2 ** failures, 16_000);
      const timer = window.setTimeout(() => {
        reconnectTimers.delete(timer);
        connect(jobId, failures);
      }, delay);
      reconnectTimers.add(timer);
    }

    jobIds.forEach((jobId) => connect(jobId));

    return () => {
      stopped = true;
      sockets.forEach((socket) => socket.close());
      reconnectTimers.forEach((timer) => window.clearTimeout(timer));
      if (pollTimer !== null) window.clearInterval(pollTimer);
    };
  }, [activeKey]);

  const activeJobs = jobs.filter((job) => ["queued", "preparing", "downloading", "processing", "paused"].includes(job.status));
  const completedJobs = jobs.filter((job) => job.status === "completed");
  const failedJobs = jobs.filter((job) => ["failed", "cancelled"].includes(job.status));
  const orderedJobs = [...activeJobs, ...failedJobs, ...completedJobs];
  const albumGroups = new Map<string, DownloadJob[]>();
  for (const job of orderedJobs) {
    if (!job.group) continue;
    const key = job.group.album_id;
    albumGroups.set(key, [...(albumGroups.get(key) ?? []), job]);
  }
  const standaloneJobs = orderedJobs.filter((job) => !job.group);

  return (
    <section className="min-w-0 max-w-full space-y-4 overflow-x-hidden">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-xl font-bold tracking-normal">Downloads</h2>
          <p className="text-sm text-muted-foreground">Active queue, completed songs, and failed downloads.</p>
        </div>
        {completedJobs.length > 0 && (
          <Button variant="glass" size="sm" onClick={onRemoveCompleted}>
            <Trash2 className="h-4 w-4" />
            Clear completed
          </Button>
        )}
      </div>

      <div className="grid min-w-0 max-w-full gap-3 overflow-x-hidden">
        {[...albumGroups.entries()].map(([key, albumJobs]) => (
          <AlbumDownloadGroup
            key={key}
            jobs={albumJobs}
            onCancel={onCancel}
            onRetry={onRetry}
            onPause={onPause}
            onResume={onResume}
            onCancelAlbum={onCancelAlbum}
          />
        ))}
        {standaloneJobs.map((job) => (
          <DownloadJobRow key={job.id} job={job} onCancel={onCancel} onRetry={onRetry} onPause={onPause} onResume={onResume} />
        ))}
        {jobs.length === 0 && (
          <div className="glass-panel rounded-3xl p-6 text-sm text-muted-foreground">
            Downloads you queue from search results will appear here with live progress.
          </div>
        )}
      </div>
    </section>
  );
}

function parseDownloadEvent(value: unknown): DownloadJob | null {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object") return null;
    const candidate = parsed as Partial<DownloadJob>;
    if (typeof candidate.id !== "number" || typeof candidate.status !== "string") return null;
    if (typeof candidate.progress !== "number" || candidate.progress < 0 || candidate.progress > 100) return null;
    return candidate as DownloadJob;
  } catch {
    return null;
  }
}

function AlbumDownloadGroup({
  jobs,
  onCancel,
  onRetry,
  onPause,
  onResume,
  onCancelAlbum,
}: {
  jobs: DownloadJob[];
  onCancel: (jobId: number) => void;
  onRetry: (jobId: number) => void;
  onPause: (jobId: number) => void;
  onResume: (jobId: number) => void;
  onCancelAlbum: (albumId: string) => void;
}) {
  const navigate = useNavigate();
  const completed = jobs.filter((job) => job.status === "completed").length;
  const active = jobs.filter((job) => ["queued", "preparing", "downloading", "processing", "paused"].includes(job.status)).length;
  const progress = Math.round(jobs.reduce((sum, job) => sum + job.progress, 0) / Math.max(jobs.length, 1));
  const [open, setOpen] = useState(active > 0);

  useEffect(() => {
    if (active > 0) setOpen(true);
  }, [active]);

  return (
    <details
      className="glass-panel group/details min-w-0 max-w-full overflow-hidden rounded-2xl"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex min-w-0 cursor-pointer list-none items-center gap-3 p-3 [&::-webkit-details-marker]:hidden">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
          <Disc3 className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold">{jobs[0]?.album || "Album download"}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {active > 0 ? `${active} downloading` : `${completed} of ${jobs.length} downloaded`} · {progress}%
          </span>
        </span>
        <Button size="sm" variant="ghost" onClick={(event) => { event.preventDefault(); navigate(jobs[0]?.group?.canonical_url || "/library/albums"); }}>Open</Button>
        {active > 0 && <Button size="sm" variant="ghost" className="text-red-400" onClick={(event) => { event.preventDefault(); onCancelAlbum(jobs[0]!.group!.album_id); }}>Cancel</Button>}
        <ChevronDown className="h-4 w-4 shrink-0 transition group-open/details:rotate-180" />
      </summary>
      <div className="grid min-w-0 gap-2 border-t border-white/10 p-2 sm:p-3">
        {jobs.map((job) => (
          <DownloadJobRow key={job.id} job={job} onCancel={onCancel} onRetry={onRetry} onPause={onPause} onResume={onResume} nested />
        ))}
      </div>
    </details>
  );
}

function DownloadJobRow({
  job,
  onCancel,
  onRetry,
  onPause,
  onResume,
  nested = false,
}: {
  job: DownloadJob;
  onCancel: (jobId: number) => void;
  onRetry: (jobId: number) => void;
  onPause: (jobId: number) => void;
  onResume: (jobId: number) => void;
  nested?: boolean;
}) {
  const canCancel = !nested && ["queued", "preparing", "downloading", "processing"].includes(job.status);
  const canRetry = !nested && ["failed", "cancelled"].includes(job.status);
  const canPause = !nested && ["queued", "downloading", "processing"].includes(job.status);

  return (
    <motion.article layout className={nested ? "grid min-w-0 max-w-full grid-cols-[auto_minmax(0,1fr)] gap-3 overflow-hidden rounded-xl bg-white/5 p-2.5 sm:flex sm:items-center" : "glass-panel grid min-w-0 max-w-full grid-cols-[auto_minmax(0,1fr)] gap-3 overflow-hidden rounded-2xl p-3 sm:flex sm:items-center"}>
      {job.thumbnail_url ? (
        <ArtworkImage src={cachedArtworkUrl(job.thumbnail_url)} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
      ) : (
        <div className="h-14 w-14 shrink-0 rounded-xl bg-[linear-gradient(135deg,#f43f5e,#14b8a6_52%,#f59e0b)]" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{job.title ?? "Untitled download"}</p>
            <p className="truncate text-xs text-muted-foreground">{job.artist ?? "Unknown artist"}</p>
          </div>
          <span className="shrink-0 text-xs font-semibold text-muted-foreground">{job.progress}%</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${job.progress}%` }} />
        </div>
        <p className="mt-2 truncate text-xs text-muted-foreground">
          {job.error_message ?? `${job.stage}${job.speed ? ` · ${job.speed}` : ""}${job.eta ? ` · ETA ${job.eta}` : ""}`}
        </p>
      </div>
      {(canCancel || canPause || (!nested && job.status === "paused") || canRetry) && (
        <div className="col-span-2 flex min-w-0 justify-end gap-1 border-t border-white/5 pt-1 sm:col-span-1 sm:border-0 sm:pt-0">
          {canCancel && (
            <Button variant="ghost" size="icon" aria-label={`Cancel ${job.title ?? "download"}`} onClick={() => onCancel(job.id)}>
              <X className="h-4 w-4" />
            </Button>
          )}
          {canPause && (
            <Button variant="ghost" size="icon" aria-label={`Pause ${job.title ?? "download"}`} onClick={() => onPause(job.id)}>
              <Pause className="h-4 w-4" />
            </Button>
          )}
          {!nested && job.status === "paused" && (
            <Button variant="ghost" size="icon" aria-label={`Resume ${job.title ?? "download"}`} onClick={() => onResume(job.id)}>
              <Play className="h-4 w-4" />
            </Button>
          )}
          {canRetry && (
            <Button variant="ghost" size="icon" aria-label={`Retry ${job.title ?? "download"}`} onClick={() => onRetry(job.id)}>
              <RotateCcw className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}
    </motion.article>
  );
}
