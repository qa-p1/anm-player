import { useQueryClient } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useEffect, useRef } from "react";
import { NavLink } from "react-router";

import { toast } from "@/components/ui/toast";
import { useAllPlaylists, useDownloads } from "@/hooks/use-music-queries";
import { cn } from "@/lib/utils";
import { invalidateLibrary, invalidatePlaylists } from "@/services/music-invalidation";
import { musicKeys } from "@/services/music-keys";
import { usePlayerStore } from "@/stores/player-store";
import { currentBatch, groupDownloads, isActiveDownload, summarizeDownloads } from "@/utils/downloads";

/** Circular progress around the download icon while anything is in the queue. */
function ProgressRing({ value, paused }: { value: number; paused: boolean }) {
  const circumference = 2 * Math.PI * 9;
  return (
    <svg viewBox="0 0 22 22" aria-hidden="true" className="absolute inset-0 h-full w-full -rotate-90">
      <circle cx="11" cy="11" r="9" fill="none" strokeWidth="2" className="stroke-white/10" />
      <circle cx="11" cy="11" r="9" fill="none" strokeWidth="2" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - value / 100)} className={cn("transition-[stroke-dashoffset] duration-700", paused ? "stroke-muted-foreground" : "stroke-primary")} />
    </svg>
  );
}

export function DownloadsNavLink({ className }: { className: (state: { isActive: boolean }) => string }) {
  const { data: jobs = [] } = useDownloads();
  const queue = jobs.filter(isActiveDownload);
  const summary = summarizeDownloads(currentBatch(jobs));
  return (
    <NavLink to="/downloads" className={className}>
      <span className="relative grid h-4 w-4 place-items-center">
        {queue.length > 0 ? <><ProgressRing value={summary.progress} paused={summary.running === 0} /><Download className="h-2.5 w-2.5" /></> : <Download className="h-4 w-4" />}
      </span>
      Downloads
      {queue.length > 0 && <span className="ml-auto rounded-full bg-primary/15 px-2 py-0.5 text-[0.65rem] font-bold tabular-nums text-primary">{summary.running === 0 && summary.paused === queue.length ? "Paused" : `${summary.progress}%`}</span>}
    </NavLink>
  );
}

/** Phones have no sidebar: a floating shortcut appears while something downloads. */
export function DownloadsMobileButton() {
  const { data: jobs = [] } = useDownloads();
  const hasCurrentSong = usePlayerStore((state) => Boolean(state.currentSong));
  const queue = jobs.filter(isActiveDownload);
  if (queue.length === 0) return null;
  const summary = summarizeDownloads(currentBatch(jobs));
  return (
    <NavLink to="/downloads" aria-label={`Downloads, ${summary.progress}% done`} className={cn("fixed right-3 z-[45] grid h-12 w-12 place-items-center rounded-full border border-white/15 bg-background/85 shadow-2xl backdrop-blur-xl lg:hidden", hasCurrentSong ? "bottom-44" : "bottom-24")}>
      <span className="relative grid h-8 w-8 place-items-center"><ProgressRing value={summary.progress} paused={summary.running === 0} /><Download className="h-3.5 w-3.5" /></span>
    </NavLink>
  );
}

/** Keeps library views fresh as downloads finish, and says when a whole album or playlist is done. */
export function DownloadsMonitor() {
  const queryClient = useQueryClient();
  const { data: jobs } = useDownloads();
  const { data: playlists = [] } = useAllPlaylists();
  const previous = useRef<Map<number, string> | null>(null);
  useEffect(() => {
    if (!jobs) return;
    const before = previous.current;
    previous.current = new Map(jobs.map((job) => [job.id, job.status]));
    if (!before) return;
    const finished = jobs.filter((job) => job.status === "completed" && before.has(job.id) && before.get(job.id) !== "completed");
    if (finished.length === 0) return;
    void invalidateLibrary(queryClient);
    void invalidatePlaylists(queryClient);
    for (const group of groupDownloads(finished).groups) {
      if (group.type === "album") void queryClient.invalidateQueries({ queryKey: musicKeys.unifiedAlbum(group.id) });
      const all = jobs.filter((job) => job.group?.type === group.type && job.group.album_id === group.id);
      if (all.length > 1 && !all.some(isActiveDownload)) {
        const name = group.type === "playlist" ? playlists.find((playlist) => String(playlist.id) === group.id)?.name ?? "Playlist" : group.title;
        toast(`${name} is downloaded`, "success");
      }
    }
  }, [jobs, playlists, queryClient]);
  return null;
}
