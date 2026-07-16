import { Download, Loader2, MoreHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SearchResult } from "@/types/api";
import type { ArtworkTone } from "@/types/music";

const toneClasses: Record<ArtworkTone, string> = {
  rose: "from-rose-500 to-orange-400",
  teal: "from-teal-400 to-emerald-600",
  amber: "from-amber-300 to-red-500",
  violet: "from-fuchsia-500 to-violet-500",
  blue: "from-sky-400 to-cyan-600",
  green: "from-lime-300 to-emerald-500",
};

interface SearchResultCardProps {
  result: SearchResult;
  isDownloading?: boolean;
  onDownload?: (result: SearchResult) => void;
}

export function SearchResultCard({ result, isDownloading = false, onDownload }: SearchResultCardProps) {
  return (
    <article className="glass-panel flex items-center gap-3 rounded-2xl p-3 transition hover:bg-white/10">
      {result.thumbnail ? (
        <img src={result.thumbnail} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
      ) : (
        <div className={cn("h-14 w-14 shrink-0 rounded-xl bg-gradient-to-br", toneClasses.rose)} />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{result.title}</p>
        <p className="truncate text-xs text-muted-foreground">
          {result.artist ?? result.channel ?? "Unknown artist"} · {formatDuration(result.duration)} · {formatViews(result.view_count)}
        </p>
      </div>
      <Button
        size="icon"
        variant="ghost"
        aria-label={`Download ${result.title}`}
        disabled={isDownloading}
        onClick={() => onDownload?.(result)}
      >
        {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      </Button>
      <Button size="icon" variant="ghost" aria-label={`More actions for ${result.title}`}>
        <MoreHorizontal className="h-4 w-4" />
      </Button>
    </article>
  );
}

function formatDuration(duration: number | null) {
  if (!duration) return "Unknown length";
  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatViews(views: number | null) {
  if (!views) return "views unavailable";
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1)}M views`;
  if (views >= 1_000) return `${Math.round(views / 1_000)}K views`;
  return `${views} views`;
}
