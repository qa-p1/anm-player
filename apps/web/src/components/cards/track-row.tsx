import { Pause, Play } from "lucide-react";
import type { ReactNode } from "react";

import { TrackActionsMenu } from "@/components/menus/track-actions-menu";
import { ArtworkImage } from "@/components/cards/artwork-image";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/stores/player-store";
import type { PlayerTrack } from "@/types/player";
import { formatDuration } from "@/utils/format";

interface TrackRowProps {
  track: PlayerTrack;
  context?: PlayerTrack[];
  subtitle?: string | null;
  leading?: ReactNode;
  status?: string | null;
  className?: string;
  isFavorited?: boolean;
  onToggleFavorite?: () => void | Promise<void>;
  onGoToArtist?: () => void;
  onGoToAlbum?: () => void;
  onRemoveFromPlaylist?: () => void | Promise<void>;
  isDownloaded?: boolean;
  onRemoveDownload?: () => void | Promise<void>;
  onEnrich?: () => void | Promise<void>;
  showArtwork?: boolean;
}

export function TrackRow({
  track,
  context,
  subtitle,
  leading,
  status,
  className,
  isFavorited,
  onToggleFavorite,
  onGoToArtist,
  onGoToAlbum,
  onRemoveFromPlaylist,
  isDownloaded,
  onRemoveDownload,
  onEnrich,
  showArtwork = true,
}: TrackRowProps) {
  const { currentSong, isPlaying, playSong, setIsPlaying } = usePlayerStore();
  const isCurrent = currentSong?.id === track.id;
  const isCurrentPlaying = isCurrent && isPlaying;
  const PlayIcon = isCurrentPlaying ? Pause : Play;

  function play() {
    if (isCurrent) setIsPlaying(!isPlaying);
    else playSong(track, context);
  }

  return (
    <article
      className={cn(
        "glass-panel group flex min-w-0 items-center gap-3 rounded-2xl p-2.5 transition hover:bg-white/10 sm:p-3",
        isCurrent && "ring-1 ring-primary/40",
        className,
      )}
    >
      {leading}
      {showArtwork && <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-white/10">
        {track.artworkUrl ? (
          <ArtworkImage src={track.artworkUrl} alt={track.title} className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full bg-[linear-gradient(135deg,#f43f5e,#14b8a6_52%,#f59e0b)]" />
        )}
      </div>}
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-sm font-semibold", isCurrent && "text-primary")}>{track.title}</p>
        <p className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <span className="truncate">{subtitle || track.artistName || "Unknown Artist"}</span>
          <span className="shrink-0 tabular-nums sm:hidden">· {formatDuration(track.durationSeconds)}</span>
        </p>
      </div>
      {status && <span className="hidden text-xs text-muted-foreground md:inline">{status}</span>}
      <span className="hidden shrink-0 text-xs tabular-nums text-muted-foreground sm:block">{formatDuration(track.durationSeconds)}</span>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-9 w-9 shrink-0"
        aria-label={isCurrentPlaying ? `Pause ${track.title}` : `Play ${track.title}`}
        onClick={(event) => {
          event.stopPropagation();
          play();
        }}
      >
        <PlayIcon className="h-4 w-4 fill-current" />
      </Button>
      <TrackActionsMenu
        track={track}
        isFavorited={isFavorited}
        onToggleFavorite={onToggleFavorite}
        onGoToArtist={onGoToArtist}
        onGoToAlbum={onGoToAlbum}
        onRemoveFromPlaylist={onRemoveFromPlaylist}
        isDownloaded={isDownloaded}
        onRemoveDownload={onRemoveDownload}
        onEnrich={onEnrich}
        triggerClassName="h-9 w-9"
        iconClassName="h-4 w-4"
      />
    </article>
  );
}
