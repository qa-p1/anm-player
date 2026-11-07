import { motion, useReducedMotion } from "framer-motion";
import { ChevronUp, Heart, ListMusic, Mic2, Pause, Play, Repeat, Repeat1, RotateCcw, Shuffle, SkipBack, SkipForward } from "lucide-react";
import { useRef, type ReactNode } from "react";
import type { PanInfo } from "framer-motion";
import { useShallow } from "zustand/react/shallow";

import { ArtworkImage } from "@/components/cards/artwork-image";
import { TrackMetadata } from "@/components/cards/track-metadata";
import { EqualizerBars } from "@/components/collection/equalizer-bars";
import { PlayerSeek } from "@/components/player/player-seek";
import { nextTrack, previousTrack, togglePlayback } from "@/features/player/playback-controls";
import { usePlayerFavorite } from "@/features/player/use-player-favorite";
import { useDominantArtworkPalette } from "@/hooks/use-artwork-palette";
import { useDelayedPlaybackStatus } from "@/hooks/use-delayed-playback-status";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/stores/player-store";
import { useUiStore } from "@/stores/ui-store";
import { withAlpha } from "@/utils/color";
import { formatTime } from "@/utils/format";

interface MiniPlayerProps {
  onOpen: () => void;
}

export function MiniPlayer({ onOpen }: MiniPlayerProps) {
  const { queueCount, currentSong, isPlaying, currentTime, duration, playbackStatus, bufferedUntil, shuffle, repeat } = usePlayerStore(useShallow((state) => ({
    queueCount: state.queue.length,
    currentSong: state.currentSong,
    isPlaying: state.isPlaying,
    currentTime: state.currentTime,
    duration: state.duration,
    playbackStatus: state.playbackStatus,
    bufferedUntil: state.bufferedUntil,
    shuffle: state.shuffle,
    repeat: state.repeat,
  })));
  const { canFavorite, isFavorited, isUpdating, toggleFavorite } = usePlayerFavorite(currentSong);
  const palette = useDominantArtworkPalette(currentSong?.artworkUrl ?? null);
  const visibleStatus = useDelayedPlaybackStatus(playbackStatus);
  const reduceMotion = useReducedMotion();
  const swipedAt = useRef(0);

  if (!currentSong) return null;

  // Touch gestures: swipe left/right to skip, swipe up to expand.
  function handlePanEnd(event: PointerEvent | MouseEvent | TouchEvent, info: PanInfo) {
    if ("pointerType" in event && event.pointerType === "mouse") return;
    const { x, y } = info.offset;
    if (Math.abs(x) > 64 && Math.abs(x) > Math.abs(y) * 1.4) {
      swipedAt.current = Date.now();
      if (x < 0) nextTrack();
      else previousTrack();
    } else if (y < -48 && Math.abs(y) > Math.abs(x)) {
      swipedAt.current = Date.now();
      onOpen();
    }
  }

  function openFromTap() {
    // The click that ends a swipe must not also expand the player.
    if (Date.now() - swipedAt.current < 400) return;
    onOpen();
  }

  const isError = playbackStatus === "error";
  const isWaiting = visibleStatus !== null && visibleStatus !== "error";
  const PlayPauseIcon = isError ? RotateCcw : isPlaying ? Pause : Play;
  const RepeatIcon = repeat === "one" ? Repeat1 : Repeat;
  const validDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const elapsed = Number.isFinite(currentTime) ? Math.max(0, Math.min(currentTime, validDuration || currentTime)) : 0;
  const tint = palette.base;

  return (
    <motion.section
      aria-label="Mini-player"
      initial={{ opacity: 0, y: reduceMotion ? 0 : 24, scale: reduceMotion ? 1 : 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: reduceMotion ? 0 : 24, scale: reduceMotion ? 1 : 0.98 }}
      transition={{ duration: reduceMotion ? 0 : 0.24, ease: [0.22, 1, 0.36, 1] }}
      onPanEnd={handlePanEnd}
      className="group/mini glass-panel fixed bottom-24 touch-none lg:touch-auto left-3 right-3 z-40 isolate rounded-2xl sm:left-6 sm:right-6 lg:bottom-5 lg:left-72 lg:right-8"
      style={{ boxShadow: `0 24px 60px -28px ${withAlpha(tint, 0.85)}, 0 20px 70px -36px rgb(0 0 0 / 0.65)` }}
    >
      {/* Artwork tint lives in its own clipped layer so the scrubber can sit on the border. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-[inherit]">
        <div className="absolute inset-0 transition-[background] duration-700" style={{ backgroundImage: `radial-gradient(70% 160% at 0% 50%, ${withAlpha(tint, 0.42)}, transparent 70%), radial-gradient(40% 120% at 100% 50%, ${withAlpha(tint, 0.14)}, transparent 70%)` }} />
      </div>

      {/* A sibling button covers empty space without nesting links or controls. */}
      <button type="button" onClick={openFromTap} aria-label={`Open full-screen player for ${currentSong.title}`} className="absolute inset-0 z-0 rounded-[inherit] outline-none transition hover:bg-foreground/[0.025] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" />

      <PlayerSeek currentTime={currentTime} duration={duration} bufferedUntil={bufferedUntil} />

      <div className="pointer-events-none relative z-10 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-2.5 py-2 sm:px-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <div className="flex min-w-0 items-center gap-3">
          <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-muted shadow-lg ring-1 ring-white/10 sm:h-12 sm:w-12">
            <ArtworkImage src={currentSong.artworkUrl} alt="" className={cn("h-full w-full object-cover transition duration-300 group-hover/mini:scale-105", isWaiting && "opacity-60")} />
            <span aria-hidden="true" className="absolute inset-0 grid place-items-center bg-black/45 text-white opacity-0 transition group-hover/mini:opacity-100">
              <ChevronUp className="h-5 w-5" />
            </span>
          </div>
          <div className="min-w-0">
            <p className="flex min-w-0 items-center gap-2 text-sm font-semibold leading-tight tracking-tight sm:text-[0.95rem]">
              {isPlaying && !isWaiting && !isError && <EqualizerBars className="hidden h-3 shrink-0 text-primary sm:inline-flex" />}
              <span className="truncate" title={currentSong.title}>{currentSong.title}</span>
            </p>
            <TrackMetadata track={currentSong} className={cn("mt-0.5 flex text-xs text-muted-foreground", isError && "hidden")} linkClassName="pointer-events-auto" />
            {isError && <p role="status" className="mt-0.5 truncate text-xs font-medium text-red-400">Playback stopped · tap retry</p>}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-0.5 [&_button]:pointer-events-auto sm:gap-1">
          <MiniButton label={shuffle ? "Shuffle on" : "Shuffle off"} pressed={shuffle} onClick={() => usePlayerStore.getState().toggleShuffle()} className="hidden md:grid"><Shuffle className="h-4 w-4" /></MiniButton>
          <MiniButton label="Previous track" onClick={previousTrack} className="hidden min-[400px]:grid"><SkipBack className="h-4 w-4 fill-current" /></MiniButton>
          <button
            type="button"
            aria-label={isError ? "Retry playback" : isPlaying ? "Pause" : "Play"}
            title={isError ? "Retry playback" : isPlaying ? "Pause" : "Play"}
            onClick={togglePlayback}
            className={cn(
              "relative mx-0.5 grid h-10 w-10 place-items-center rounded-full shadow-md transition hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              isError ? "bg-red-500 text-white" : "bg-foreground text-background",
            )}
          >
            {isWaiting && <span aria-hidden="true" className="absolute -inset-1 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />}
            <PlayPauseIcon className={cn("h-[1.1rem] w-[1.1rem]", !isError && "fill-current", !isPlaying && !isError && "translate-x-[1px]")} />
          </button>
          <MiniButton label="Next track" onClick={nextTrack}><SkipForward className="h-4 w-4 fill-current" /></MiniButton>
          <MiniButton label={repeat === "one" ? "Repeat one" : repeat === "all" ? "Repeat all" : "Repeat off"} pressed={repeat !== "off"} onClick={() => usePlayerStore.getState().cycleRepeat()} className="hidden md:grid"><RepeatIcon className="h-4 w-4" /></MiniButton>
        </div>

        <div className="hidden min-w-0 items-center justify-end gap-1 md:flex">
          <span className="mr-2 hidden shrink-0 text-xs tabular-nums text-muted-foreground lg:inline">
            <span className="text-foreground/85">{formatTime(elapsed)}</span>{validDuration > 0 && <><span className="mx-1 opacity-50">/</span>{formatTime(validDuration)}</>}
          </span>
          <div className="flex shrink-0 items-center [&_button]:pointer-events-auto">
            {canFavorite && <MiniButton label={isFavorited ? "Remove from favorites" : "Add to favorites"} pressed={isFavorited} disabled={isUpdating} onClick={toggleFavorite} activeClassName="text-primary hover:text-primary"><Heart className={cn("h-4 w-4", isFavorited && "fill-current")} /></MiniButton>}
            <MiniButton label="Lyrics" onClick={() => useUiStore.getState().requestPlayerView("lyrics")}><Mic2 className="h-4 w-4" /></MiniButton>
            <MiniButton label={`Open queue, ${queueCount} upcoming ${queueCount === 1 ? "track" : "tracks"}`} title="Queue" onClick={() => useUiStore.getState().requestPlayerView("queue")}>
              <ListMusic className="h-4 w-4" />
              {queueCount > 0 && <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[0.6rem] font-bold leading-none text-primary-foreground">{queueCount > 99 ? "99+" : queueCount}</span>}
            </MiniButton>
          </div>
        </div>
      </div>
    </motion.section>
  );
}

function MiniButton({ label, title, onClick, pressed, disabled, className, activeClassName = "text-primary hover:text-primary", children }: { label: string; title?: string; onClick: () => void; pressed?: boolean; disabled?: boolean; className?: string; activeClassName?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title ?? label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "relative grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition hover:bg-foreground/[0.08] hover:text-foreground active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40",
        pressed && activeClassName,
        className,
      )}
    >
      {children}
    </button>
  );
}
