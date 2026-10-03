import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Download, LoaderCircle } from "lucide-react";

import { useDownloadQueueUi } from "@/components/download-queue-state";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DownloadsPanel } from "@/features/search/downloads-panel";
import { musicKeys, useDownloads } from "@/hooks/use-music-queries";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import {
  cancelDownload,
  cancelUnifiedAlbumDownload,
  pauseDownload,
  removeCompletedDownloads,
  resumeDownload,
  retryDownload,
  retryFailedDownloads,
} from "@/services/music-api";
import type { DownloadJob } from "@/types/api";
import { isActiveDownload } from "@/utils/downloads";

const RECENT_WINDOW_MS = 5 * 60 * 1000;

function isVisibleJob(job: DownloadJob) {
  if (isActiveDownload(job)) return true;
  const changedAt = Date.parse(job.completed_at ?? job.cancelled_at ?? job.updated_at);
  return Number.isFinite(changedAt) && Date.now() - changedAt < RECENT_WINDOW_MS;
}

function finishedSummary(jobs: DownloadJob[]) {
  const failed = jobs.filter((job) => job.status === "failed").length;
  const completed = jobs.filter((job) => job.status === "completed").length;
  const parts = [completed > 0 && `${completed} completed`, failed > 0 && `${failed} failed`].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : `${jobs.length} finished`;
}

export function DownloadQueueTrigger({ mobile = false }: { mobile?: boolean }) {
  const { data: jobs = [] } = useDownloads();
  const setOpen = useDownloadQueueUi((state) => state.setOpen);
  const visibleJobs = jobs.filter(isVisibleJob);
  const activeJobs = visibleJobs.filter(isActiveDownload);

  if (visibleJobs.length === 0) return null;

  const completed = activeJobs.length === 0;
  const Icon = completed ? CheckCircle2 : LoaderCircle;

  if (mobile) {
    return (
      <Button
        type="button"
        size="icon"
        onClick={() => setOpen(true)}
        aria-label="Open download queue"
        className="fixed bottom-36 right-3 z-[180] h-12 w-12 rounded-2xl border border-white/15 shadow-2xl lg:hidden"
      >
        <Icon className={cn("h-5 w-5", !completed && "animate-spin")} />
        <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-foreground px-1 text-[10px] font-black text-background">
          {visibleJobs.length}
        </span>
      </Button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="mx-1 flex w-[calc(100%-0.5rem)] items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-left transition hover:bg-white/10"
    >
      <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", completed ? "bg-emerald-500/20 text-emerald-400" : "bg-primary/20 text-primary")}>
        <Icon className={cn("h-4 w-4", !completed && "animate-spin")} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold">Downloads</span>
        <span className="block truncate text-xs text-muted-foreground">
          {activeJobs.length > 0 ? `${activeJobs.length} in progress` : finishedSummary(visibleJobs)}
        </span>
      </span>
      <Download className="h-4 w-4 text-muted-foreground" />
    </button>
  );
}

export function DownloadQueueDialog() {
  const open = useDownloadQueueUi((state) => state.open);
  const setOpen = useDownloadQueueUi((state) => state.setOpen);
  const { data: jobs = [] } = useDownloads();
  const queryClient = useQueryClient();
  const visibleJobs = jobs.filter(isVisibleJob);

  function upsert(job: DownloadJob) {
    queryClient.setQueryData<DownloadJob[]>(musicKeys.downloadsList(), (current = []) => {
      const exists = current.some((item) => item.id === job.id);
      return exists ? current.map((item) => (item.id === job.id ? job : item)) : [job, ...current];
    });
  }

  async function run(action: (jobId: number) => Promise<DownloadJob>, jobId: number) {
    try {
      upsert(await action(jobId));
    } catch (error) {
      toast(error instanceof Error ? error.message : "Download action failed", "error");
    }
  }

  async function removeCompleted() {
    try {
      await removeCompletedDownloads();
      queryClient.setQueryData<DownloadJob[]>(musicKeys.downloadsList(), (current = []) =>
        current.filter((job) => job.status !== "completed"),
      );
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not clear completed downloads", "error");
    }
  }

  async function retryFailed() {
    try {
      const retried = await retryFailedDownloads();
      retried.forEach(upsert);
      toast(`Retrying ${retried.length} ${retried.length === 1 ? "download" : "downloads"}`, "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not retry failed downloads", "error");
    }
  }

  async function cancelAlbum(albumId: string) {
    try {
      const album = await cancelUnifiedAlbumDownload(albumId);
      queryClient.setQueryData(musicKeys.unifiedAlbum(albumId), album);
      await queryClient.invalidateQueries({ queryKey: musicKeys.downloadsList() });
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not cancel album download", "error");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[86dvh] w-[calc(100%-1.25rem)] max-w-2xl overflow-x-hidden overflow-y-auto rounded-3xl p-4 sm:p-6">
        <DialogHeader className="pr-8">
          <DialogTitle>Download queue</DialogTitle>
          <DialogDescription>Live progress for downloads started anywhere in ANM Player.</DialogDescription>
        </DialogHeader>
        <DownloadsPanel
          jobs={visibleJobs}
          onJobUpdate={upsert}
          onCancel={(id) => void run(cancelDownload, id)}
          onRetry={(id) => void run(retryDownload, id)}
          onPause={(id) => void run(pauseDownload, id)}
          onResume={(id) => void run(resumeDownload, id)}
          onRemoveCompleted={() => void removeCompleted()}
          onRetryFailed={() => void retryFailed()}
          onCancelAlbum={(albumId) => void cancelAlbum(albumId)}
        />
      </DialogContent>
    </Dialog>
  );
}
