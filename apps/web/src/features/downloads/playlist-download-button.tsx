import { useQueryClient } from "@tanstack/react-query";
import { CircleCheck, Download, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";

import { HeroIconButton } from "@/components/collection/collection-hero";
import { toast } from "@/components/ui/toast";
import { useDownloads } from "@/hooks/use-music-queries";
import { cn } from "@/lib/utils";
import { downloadPlaylist } from "@/services/music-api";
import { musicKeys } from "@/services/music-keys";
import { currentBatch, isActiveDownload, summarizeDownloads } from "@/utils/downloads";
import { pluralize } from "@/utils/format";

/**
 * Download → progress ring while the playlist downloads → check when every
 * song is offline. Progress comes from the shared download queue.
 */
export function PlaylistDownloadButton({ playlistId, name, total, offline }: { playlistId: number; name: string; total: number; offline: number }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const { data: jobs = [] } = useDownloads();
  const mine = jobs.filter((job) => job.group?.type === "playlist" && job.group.album_id === String(playlistId));
  const queue = mine.filter(isActiveDownload);
  const summary = summarizeDownloads(currentBatch(mine));
  const complete = total > 0 && offline >= total;

  async function start() {
    setStarting(true);
    try {
      const result = await downloadPlaylist(playlistId);
      void queryClient.invalidateQueries({ queryKey: musicKeys.downloadsList() });
      const parts = [
        result.queued.length > 0 ? `Downloading ${pluralize(result.queued.length, "song")}` : result.already_queued > 0 ? "Already downloading" : "Nothing new to download",
        result.unavailable > 0 && `${pluralize(result.unavailable, "song")} can't be downloaded`,
      ].filter(Boolean);
      toast(parts.join(" · "), result.queued.length > 0 || result.already_queued > 0 ? "success" : "error");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not start the download", "error");
    } finally {
      setStarting(false);
    }
  }

  if (queue.length > 0) {
    const circumference = 2 * Math.PI * 19;
    return (
      <HeroIconButton label={`Downloading ${name}, ${summary.progress}%. Open downloads`} onClick={() => navigate("/downloads")} className="relative text-primary">
        <svg viewBox="0 0 44 44" aria-hidden="true" className="absolute inset-0 h-full w-full -rotate-90">
          <circle cx="22" cy="22" r="19" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - summary.progress / 100)} className={cn("transition-[stroke-dashoffset] duration-700", summary.running === 0 ? "stroke-muted-foreground" : "stroke-primary")} />
        </svg>
        <span className="text-[0.65rem] font-black tabular-nums">{summary.progress}%</span>
      </HeroIconButton>
    );
  }
  if (complete) {
    return <HeroIconButton label="Every song is downloaded" active disabled onClick={() => undefined} className="disabled:opacity-100"><CircleCheck className="h-5 w-5" /></HeroIconButton>;
  }
  return (
    <HeroIconButton label={offline > 0 ? `Download the other ${pluralize(total - offline, "song")}` : "Download playlist"} onClick={() => void start()} disabled={starting || total === 0}>
      {starting ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <Download className="h-5 w-5" />}
    </HeroIconButton>
  );
}
