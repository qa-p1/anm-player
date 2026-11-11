import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Disc3, Download, ListMusic, LoaderCircle, Pause, Play, RotateCcw, Search, Trash2, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";

import { pageTransition } from "@/animations/page-motion";
import { ArtworkImage } from "@/components/cards/artwork-image";
import { EmptyState } from "@/components/empty-states/empty-state";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-bar";
import { toast } from "@/components/ui/toast";
import { useAllPlaylists, useDownloads } from "@/hooks/use-music-queries";
import { cn } from "@/lib/utils";
import { cachedArtworkUrl } from "@/services/api-client";
import {
  cancelAllDownloads,
  cancelDownload,
  cancelUnifiedAlbumDownload,
  clearFinishedDownloads,
  pauseAllDownloads,
  pauseDownload,
  resumeAllDownloads,
  resumeDownload,
  retryDownload,
  retryFailedDownloads,
} from "@/services/music-api";
import { musicKeys } from "@/services/music-keys";
import type { DownloadJob } from "@/types/api";
import { currentBatch, downloadStatusText, groupDownloads, isActiveDownload, isRunningDownload, summarizeDownloads, type DownloadGroup } from "@/utils/downloads";
import { pluralize } from "@/utils/format";

type Tab = "queue" | "done" | "failed";

export function DownloadsPage() {
  const queryClient = useQueryClient();
  const { data: jobs = [], isLoading, error, refetch } = useDownloads({ refetchInterval: (query) => (query.state.data?.some(isActiveDownload) ? 1_000 : 10_000) });
  const { data: playlists = [] } = useAllPlaylists();
  const [tab, setTab] = useState<Tab>("queue");
  const [busy, setBusy] = useState<string | null>(null);
  const playlistNames = useMemo(() => new Map(playlists.map((playlist) => [String(playlist.id), playlist.name])), [playlists]);

  const queue = jobs.filter(isActiveDownload);
  const done = jobs.filter((job) => job.status === "completed");
  const failed = jobs.filter((job) => job.status === "failed" || job.status === "cancelled");
  const batch = currentBatch(jobs);
  const summary = summarizeDownloads(batch);
  const visible = tab === "queue" ? queue : tab === "done" ? done : failed;
  const { groups, singles } = groupDownloads(visible);
  const named = groups.map((group) => (group.type === "playlist" ? { ...group, title: playlistNames.get(group.id) ?? "Playlist" } : group));

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: musicKeys.downloadsList() });
  }

  async function act(key: string, action: () => Promise<unknown>, success?: string) {
    if (busy) return;
    setBusy(key);
    try {
      await action();
      if (success) toast(success, "success");
    } catch (actionError) {
      toast(actionError instanceof Error ? actionError.message : "That didn't work. Try again.", "error");
    } finally {
      setBusy(null);
      refresh();
    }
  }

  const tabs: Array<{ id: Tab; label: string; count: number }> = [
    { id: "queue", label: "Queue", count: queue.length },
    { id: "done", label: "Downloaded", count: done.length },
    { id: "failed", label: "Failed", count: failed.length },
  ];

  return (
    <motion.div {...pageTransition} className="mx-auto max-w-7xl space-y-6 px-3 py-4 sm:px-6 lg:px-8 lg:py-7">
      <header className="space-y-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <h1 className="text-4xl font-black tracking-tight sm:text-6xl">Downloads</h1>
          {queue.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {summary.running + summary.waiting > 0 && <Button variant="glass" size="sm" disabled={Boolean(busy)} onClick={() => void act("pause-all", pauseAllDownloads)}><Pause className="h-4 w-4" />Pause all</Button>}
              {summary.paused > 0 && <Button variant="glass" size="sm" disabled={Boolean(busy)} onClick={() => void act("resume-all", resumeAllDownloads)}><Play className="h-4 w-4" />Resume all</Button>}
              <Button variant="glass" size="sm" className="text-red-400" disabled={Boolean(busy)} onClick={() => void act("cancel-all", cancelAllDownloads, "Downloads cancelled")}><X className="h-4 w-4" />Cancel all</Button>
            </div>
          )}
        </div>

        {queue.length > 0 && (
          <div className="rounded-[1.6rem] border border-white/[0.06] bg-card/40 p-4 sm:p-5">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-semibold">
                {summary.running > 0 ? `Downloading ${summary.running}` : summary.paused === queue.length ? "Paused" : "Starting…"}
                <span className="font-normal text-muted-foreground">{[summary.waiting && ` · ${summary.waiting} waiting`, summary.paused && summary.paused !== queue.length && ` · ${summary.paused} paused`].filter(Boolean).join("")}</span>
              </p>
              <span className="text-2xl font-black tabular-nums">{summary.progress}%</span>
            </div>
            <ProgressBar value={summary.progress} className="mt-3 h-2" paused={summary.running === 0} />
          </div>
        )}

        <div role="tablist" aria-label="Download lists" className="flex w-fit rounded-full border border-white/10 bg-white/[0.04] p-1">
          {tabs.map((item) => (
            <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)} className={cn("flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold text-muted-foreground transition hover:text-foreground", tab === item.id && "bg-foreground text-background hover:text-background")}>
              {item.label}{item.count > 0 && <span className={cn("tabular-nums", tab === item.id ? "opacity-70" : "opacity-60")}>{item.count}</span>}
            </button>
          ))}
        </div>
      </header>

      {error && <div role="alert" className="flex items-center gap-2 rounded-2xl border border-red-400/20 bg-red-500/5 p-3 text-sm text-red-400">{error.message}<Button variant="ghost" size="sm" onClick={() => void refetch()}>Retry</Button></div>}

      {tab !== "queue" && visible.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {tab === "failed" && failed.some((job) => job.status === "failed") && <Button variant="glass" size="sm" disabled={Boolean(busy)} onClick={() => void act("retry-all", retryFailedDownloads, "Retrying failed downloads")}><RotateCcw className="h-4 w-4" />Retry all</Button>}
          <Button variant="glass" size="sm" disabled={Boolean(busy)} onClick={() => void act("clear", () => clearFinishedDownloads(tab === "done" ? ["completed"] : ["failed", "cancelled"]))}><Trash2 className="h-4 w-4" />Clear list</Button>
        </div>
      )}

      {isLoading ? (
        <div role="status" aria-label="Loading downloads" className="space-y-2">{Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-16 animate-pulse rounded-2xl bg-white/[0.04]" />)}</div>
      ) : visible.length === 0 ? (
        tab === "queue"
          ? <EmptyState icon={Download} title="Nothing downloading" description="Download a song, album or playlist and it shows up here."><Button asChild variant="glass"><Link to="/search"><Search className="h-4 w-4" />Find music</Link></Button></EmptyState>
          : <EmptyState icon={tab === "done" ? Download : RotateCcw} title={tab === "done" ? "No finished downloads" : "No failed downloads"} description={tab === "done" ? "Finished downloads are listed here until you clear them." : "Everything went through."} />
      ) : (
        <div className="space-y-3">
          {named.map((group) => <GroupCard key={group.key} group={group} batch={batch.filter((job) => job.group?.type === group.type && job.group.album_id === group.id)} tab={tab} busy={busy} act={act} />)}
          {singles.length > 0 && (
            <section aria-label="Songs" className="rounded-[1.6rem] border border-white/[0.06] bg-card/30 p-1.5 sm:p-2">
              <AnimatePresence initial={false}>
                {singles.map((job) => <DownloadRow key={job.id} job={job} busy={busy} act={act} />)}
              </AnimatePresence>
            </section>
          )}
        </div>
      )}
    </motion.div>
  );
}

type Act = (key: string, action: () => Promise<unknown>, success?: string) => Promise<void>;

function GroupCard({ group, batch, tab, busy, act }: { group: DownloadGroup; batch: DownloadJob[]; tab: Tab; busy: string | null; act: Act }) {
  const summary = summarizeDownloads(group.jobs);
  const progress = summarizeDownloads(batch.length ? batch : group.jobs).progress;
  const [open, setOpen] = useState(tab !== "queue" || group.jobs.length <= 6);
  const cover = group.jobs.find((job) => job.thumbnail_url)?.thumbnail_url ?? null;
  const Icon = group.type === "album" ? Disc3 : ListMusic;
  const running = group.jobs.filter((job) => isRunningDownload(job) || job.status === "queued");
  const pausedJobs = group.jobs.filter((job) => job.status === "paused");
  const detail = tab === "queue"
    ? [summary.running && `${summary.running} downloading`, summary.waiting && `${summary.waiting} waiting`, summary.paused && `${summary.paused} paused`].filter(Boolean).join(" · ")
    : pluralize(group.jobs.length, "song");

  return (
    <section aria-label={group.title} className="overflow-hidden rounded-[1.6rem] border border-white/[0.06] bg-card/40">
      <div className="flex items-center gap-3 p-3 sm:p-4">
        <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-white/10">
          {cover ? <ArtworkImage src={cachedArtworkUrl(cover)} alt="" className="h-full w-full object-cover" /> : <span className="grid h-full w-full place-items-center"><Icon className="h-6 w-6 text-muted-foreground" /></span>}
        </span>
        <div className="min-w-0 flex-1">
          <Link to={group.href} className="block truncate text-base font-bold hover:underline">{group.title}</Link>
          <p className="truncate text-xs text-muted-foreground"><span className="capitalize">{group.type}</span> · {detail}</p>
          {tab === "queue" && <ProgressBar value={progress} className="mt-2 h-1.5" paused={summary.running === 0} />}
        </div>
        {tab === "queue" && <span className="hidden w-12 shrink-0 text-right text-sm font-bold tabular-nums sm:block">{progress}%</span>}
        <div className="flex shrink-0 items-center">
          {tab === "queue" && running.length > 0 && <IconAction label={`Pause ${group.title}`} disabled={Boolean(busy)} onClick={() => void act(group.key + ":pause", () => Promise.all(running.map((job) => pauseDownload(job.id))))}><Pause className="h-4 w-4" /></IconAction>}
          {tab === "queue" && pausedJobs.length > 0 && <IconAction label={`Resume ${group.title}`} disabled={Boolean(busy)} onClick={() => void act(group.key + ":resume", () => Promise.all(pausedJobs.map((job) => resumeDownload(job.id))))}><Play className="h-4 w-4" /></IconAction>}
          {tab === "queue" && <IconAction label={`Cancel ${group.title}`} danger disabled={Boolean(busy)} onClick={() => void act(group.key + ":cancel", () => (group.type === "album" ? cancelUnifiedAlbumDownload(group.id) : Promise.all(group.jobs.map((job) => cancelDownload(job.id)))), `${group.title} cancelled`)}><X className="h-4 w-4" /></IconAction>}
          {tab === "failed" && group.jobs.some((job) => job.status === "failed" || job.status === "cancelled") && <IconAction label={`Retry ${group.title}`} disabled={Boolean(busy)} onClick={() => void act(group.key + ":retry", () => Promise.all(group.jobs.map((job) => retryDownload(job.id))))}><RotateCcw className="h-4 w-4" /></IconAction>}
          <IconAction label={open ? "Hide songs" : "Show songs"} onClick={() => setOpen(!open)}><ChevronDown className={cn("h-4 w-4 transition", open && "rotate-180")} /></IconAction>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="border-t border-white/[0.06] p-1.5 sm:p-2">
            {group.jobs.map((job) => <DownloadRow key={job.id} job={job} busy={busy} act={act} compact />)}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function DownloadRow({ job, busy, act, compact = false }: { job: DownloadJob; busy: string | null; act: Act; compact?: boolean }) {
  const title = job.title ?? "Untitled song";
  const active = isActiveDownload(job);
  const canPause = job.status === "queued" || job.status === "downloading" || job.status === "processing";
  const failed = job.status === "failed";
  return (
    <motion.article layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="group flex min-w-0 items-center gap-3 rounded-xl p-2 transition hover:bg-white/[0.05]">
      {!compact && (
        <span className="h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-white/10">
          <ArtworkImage src={cachedArtworkUrl(job.thumbnail_url)} alt="" className="h-full w-full object-cover" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <p className="truncate text-sm font-semibold" title={title}>{title}</p>
          {job.artist && <p className="hidden min-w-0 truncate text-xs text-muted-foreground sm:block">{job.artist}</p>}
        </div>
        <p className={cn("truncate text-xs", failed ? "text-red-400" : job.status === "completed" ? "text-emerald-400" : "text-muted-foreground")} title={failed ? job.error_message ?? undefined : undefined}>
          {isRunningDownload(job) && job.status !== "downloading" && <LoaderCircle className="mr-1 inline h-3 w-3 animate-spin" />}
          {downloadStatusText(job)}
        </p>
        {active && <ProgressBar value={job.progress} className="mt-1.5 h-1" paused={!isRunningDownload(job)} />}
      </div>
      <div className="flex shrink-0 items-center opacity-100 transition sm:opacity-60 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
        {canPause && <IconAction label={`Pause ${title}`} disabled={Boolean(busy)} onClick={() => void act(`pause:${job.id}`, () => pauseDownload(job.id))}><Pause className="h-4 w-4" /></IconAction>}
        {job.status === "paused" && <IconAction label={`Resume ${title}`} disabled={Boolean(busy)} onClick={() => void act(`resume:${job.id}`, () => resumeDownload(job.id))}><Play className="h-4 w-4" /></IconAction>}
        {active && <IconAction label={`Cancel ${title}`} danger disabled={Boolean(busy)} onClick={() => void act(`cancel:${job.id}`, () => cancelDownload(job.id))}><X className="h-4 w-4" /></IconAction>}
        {(failed || job.status === "cancelled") && <IconAction label={`Retry ${title}`} disabled={Boolean(busy)} onClick={() => void act(`retry:${job.id}`, () => retryDownload(job.id))}><RotateCcw className="h-4 w-4" /></IconAction>}
      </div>
    </motion.article>
  );
}

function IconAction({ label, onClick, disabled, danger = false, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled} className={cn("grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition hover:bg-white/10 hover:text-foreground disabled:opacity-40", danger && "hover:text-red-400")}>
      {children}
    </button>
  );
}
