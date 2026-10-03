import { Pause, Play } from "lucide-react";
import type { ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";

import { TrackActionsMenu } from "@/components/menus/track-actions-menu";
import { ArtworkImage } from "@/components/cards/artwork-image";
import { TrackMetadata } from "@/components/cards/track-metadata";
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
  const { currentSong, isPlaying, playSong, setIsPlaying } = usePlayerStore(useShallow((state) => ({
    currentSong: state.currentSong,
    isPlaying: state.isPlaying,
    playSong: state.playSong,
    setIsPlaying: state.setIsPlaying,
  })));
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
        "glass-panel group relative flex min-w-0 items-center gap-3 rounded-2xl p-2.5 transition hover:bg-white/10 sm:p-3",
        isCurrent && "ring-1 ring-primary/40",
        className,
      )}
    >
      <button
        type="button"
        onClick={play}
        aria-label={isCurrentPlaying ? `Pause ${track.title}` : `Play ${track.title}`}
        className="absolute inset-0 z-0 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="pointer-events-none relative z-[1] flex min-w-0 flex-1 items-center gap-3">
        {leading}
        {showArtwork && <span className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-white/10">
          {track.artworkUrl ? (
            <ArtworkImage src={track.artworkUrl} alt={track.title} className="h-full w-full object-cover" />
          ) : (
            <span className="block h-full w-full bg-[linear-gradient(135deg,#f43f5e,#14b8a6_52%,#f59e0b)]" />
          )}
        </span>}
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate text-sm font-semibold", isCurrent && "text-primary")}>{track.title}</span>
          <TrackMetadata track={track} fallbackArtist={subtitle} className="flex text-xs text-muted-foreground" linkClassName="pointer-events-auto" />
          <span className="shrink-0 tabular-nums sm:hidden">· {formatDuration(track.durationSeconds)}</span>
        </span>
        {status && <span className="hidden text-xs text-muted-foreground md:inline">{status}</span>}
        <span className="hidden shrink-0 text-xs tabular-nums text-muted-foreground sm:block">{formatDuration(track.durationSeconds)}</span>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground group-hover:text-foreground">
          <PlayIcon className="h-4 w-4 fill-current" />
        </span>
      </div>
      <div className="relative z-10 shrink-0">
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
      </div>
    </article>
  );
}
