import { Pause, Play } from "lucide-react";
import type { ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";

import { EqualizerBars } from "@/components/collection/equalizer-bars";
import { usePlaybackSourceContext } from "@/components/collection/playback-source-context";
import { usePlaybackSourceStore } from "@/stores/playback-source-store";
import { TrackActionsMenu } from "@/components/menus/track-actions-menu";
import { ArtworkImage } from "@/components/cards/artwork-image";
import { TrackDuration } from "@/components/cards/track-duration";
import { TrackMetadata } from "@/components/cards/track-metadata";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/stores/player-store";
import type { PlayerTrack } from "@/types/player";

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
  /** "list" renders a flat row for tracklists; "card" keeps the glass card. */
  variant?: "card" | "list";
  /** Track number shown in list rows; hover swaps it for a play icon. */
  number?: number | string;
  explicit?: boolean;
  hideAlbum?: boolean;
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
  variant = "card",
  number,
  explicit = false,
  hideAlbum = false,
}: TrackRowProps) {
  const { currentSong, isPlaying, playSong, setIsPlaying } = usePlayerStore(useShallow((state) => ({
    currentSong: state.currentSong,
    isPlaying: state.isPlaying,
    playSong: state.playSong,
    setIsPlaying: state.setIsPlaying,
  })));
  const playbackSource = usePlaybackSourceContext();
  const isCurrent = currentSong?.id === track.id;
  const isCurrentPlaying = isCurrent && isPlaying;
  const PlayIcon = isCurrentPlaying ? Pause : Play;

  function play() {
    if (isCurrent) setIsPlaying(!isPlaying);
    else {
      if (playbackSource) usePlaybackSourceStore.getState().setSource(playbackSource.kind, playbackSource.id, (context ?? [track]).map((item) => item.id));
      playSong(track, context);
    }
  }

  const menu = (
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
  );

  if (variant === "list") {
    return (
      <article className={cn("group relative flex min-w-0 items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-white/[0.06] focus-within:bg-white/[0.06] sm:px-3", isCurrent && "bg-primary/[0.08] hover:bg-primary/[0.12]", className)}>
        <button
          type="button"
          onClick={play}
          aria-label={isCurrentPlaying ? `Pause ${track.title}` : `Play ${track.title}`}
          className="absolute inset-0 z-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="pointer-events-none relative z-[1] flex min-w-0 flex-1 items-center gap-3">
          {leading}
          {number !== undefined && (
            <span className={cn("grid w-7 shrink-0 place-items-center text-sm tabular-nums text-muted-foreground", isCurrent && "text-primary")}>
              {isCurrentPlaying
                ? <><EqualizerBars className="group-hover:hidden" /><Pause className="hidden h-4 w-4 fill-current text-foreground group-hover:block" /></>
                : <><span className="group-hover:hidden">{number}</span><Play className="hidden h-4 w-4 fill-current text-foreground group-hover:block" /></>}
            </span>
          )}
          {showArtwork && (
            <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-white/10">
              <ArtworkImage src={track.artworkUrl} alt="" className="h-full w-full object-cover" />
              {number === undefined && isCurrent && <span className="absolute inset-0 grid place-items-center bg-black/45 text-white"><EqualizerBars playing={isPlaying} /></span>}
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className={cn("flex min-w-0 items-center gap-1.5 text-sm font-semibold", isCurrent && "text-primary")}>
              <span className="truncate" title={track.title}>{track.title}</span>
              {explicit && <span aria-label="Explicit" title="Explicit" className="grid h-4 w-4 shrink-0 place-items-center rounded-[4px] bg-muted-foreground/25 text-[0.6rem] font-bold text-foreground/80">E</span>}
            </span>
            <TrackMetadata track={track} fallbackArtist={subtitle} hideAlbum={hideAlbum} className="flex text-xs text-muted-foreground" linkClassName="pointer-events-auto" />
          </span>
          {status && <span className="hidden shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[0.65rem] font-semibold text-emerald-400 md:inline">{status}</span>}
          <TrackDuration trackId={track.id} seconds={track.durationSeconds} className="shrink-0 text-xs text-muted-foreground" />
        </div>
        <div className="relative z-10 shrink-0 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 has-[[data-state=open]]:opacity-100 [@media(hover:none)]:opacity-100">{menu}</div>
      </article>
    );
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

        </span>
        {status && <span className="hidden text-xs text-muted-foreground md:inline">{status}</span>}
        <TrackDuration trackId={track.id} seconds={track.durationSeconds} className="hidden shrink-0 text-xs text-muted-foreground sm:block" />
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground group-hover:text-foreground">
          <PlayIcon className="h-4 w-4 fill-current" />
        </span>
      </div>
      <div className="relative z-10 shrink-0">{menu}</div>
    </article>
  );
}
