import { useUiStore } from "@/stores/ui-store";
import { formatTime } from "@/utils/format";
import { motion } from "framer-motion";
import { LoaderCircle, Pause, Play, SkipBack, SkipForward, WifiOff, ListMusic, Mic2, Volume2, VolumeX } from "lucide-react";
import type { CSSProperties } from "react";
import { useShallow } from "zustand/react/shallow";

import { ArtworkImage } from "@/components/cards/artwork-image";
import { TrackMetadata } from "@/components/cards/track-metadata";
import { Button } from "@/components/ui/button";
import { playbackStatusLabel, useDelayedPlaybackStatus } from "@/hooks/use-delayed-playback-status";
import { audioService } from "@/services/audio-service";
import { usePlayerStore } from "@/stores/player-store";

interface MiniPlayerProps {
  onOpen: () => void;
}

export function MiniPlayer({ onOpen }: MiniPlayerProps) {
  const {
    volume,
    isMuted,
    toggleMute,
    setVolume,
    queue,
    currentSong,
    isPlaying,
    setIsPlaying,
    currentTime,
    duration,
    playbackStatus,
    playbackError,
    bufferedUntil,
    retryAttempt,
    setCurrentTime,
    retryCurrentSong,
    playPreviousSong,
    playNextManually,
  } = usePlayerStore(useShallow((state) => ({
    volume: state.volume,
    isMuted: state.isMuted,
    toggleMute: state.toggleMute,
    setVolume: state.setVolume,
    queue: state.queue,
    currentSong: state.currentSong,
    isPlaying: state.isPlaying,
    setIsPlaying: state.setIsPlaying,
    currentTime: state.currentTime,
    duration: state.duration,
    playbackStatus: state.playbackStatus,
    playbackError: state.playbackError,
    bufferedUntil: state.bufferedUntil,
    retryAttempt: state.retryAttempt,
    setCurrentTime: state.setCurrentTime,
    retryCurrentSong: state.retryCurrentSong,
    playPreviousSong: state.playPreviousSong,
    playNextManually: state.playNextManually,
  })));
  const displayedPlaybackStatus = useDelayedPlaybackStatus(playbackStatus);

  if (!currentSong) return null;

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferedProgress = duration > 0 ? Math.max(progress, Math.min(100, (bufferedUntil / duration) * 100)) : progress;
  const PlayPauseIcon = isPlaying ? Pause : Play;
  const artworkUrl = currentSong.artworkUrl;

  function handlePlayPause() {
    if (playbackStatus === "error") {
      retryCurrentSong();
      return;
    }
    setIsPlaying(!isPlaying);
  }

  function handleSeek(time: number) {
    setCurrentTime(time);
    audioService.seek(time);
  }

  function handlePrevious() {
    const currentId = currentSong?.id;
    const previous = playPreviousSong();
    if (previous) {
      if (previous.id === currentId) audioService.seek(0);
      setIsPlaying(true);
    }
  }

  function handleNext() {
    const next = playNextManually();
    if (next) setIsPlaying(true);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 18, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 18, scale: 0.98 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="glass-panel fixed bottom-24 left-4 right-4 z-40 overflow-hidden rounded-[1.4rem] transition hover:bg-card/80 lg:bottom-5 lg:left-auto lg:right-6 lg:w-[min(40rem,calc(100vw-18rem))]"
    >
      <input
        type="range"
        min={0}
        max={Math.max(duration, 1)}
        step={0.1}
        value={Math.min(currentTime, Math.max(duration, 1))}
        onChange={(event) => handleSeek(Number(event.target.value))}
        className="apple-player-range absolute inset-x-0 top-[-0.44rem] z-10 w-full"
        style={{ "--range-progress": `${progress}%`, "--range-buffered": `${bufferedProgress}%` } as CSSProperties}
        aria-label="Mini-player song progress"
        disabled={duration <= 0}
        aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
      />

      <div className="flex items-center justify-between gap-2 p-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <button type="button" onClick={onOpen} aria-label="Open full-screen player" className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-[linear-gradient(135deg,#f43f5e,#14b8a6_52%,#f59e0b)] shadow-glow outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <ArtworkImage
              src={artworkUrl}
              alt={currentSong.title}
              className="h-full w-full object-cover"
            />
          </button>
          <div className="min-w-0 flex-1">
            <button type="button" onClick={onOpen} className="block max-w-full truncate text-left text-sm font-semibold outline-none focus-visible:text-primary" aria-label={`Open full-screen player for ${currentSong.title}`}>
              {currentSong.title}
            </button>
            <div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
              <TrackMetadata track={currentSong} className="min-w-0" linkClassName="pointer-events-auto" />
              {displayedPlaybackStatus && <span className={displayedPlaybackStatus === "error" ? "inline-flex shrink-0 items-center gap-1 text-red-400" : "inline-flex shrink-0 items-center gap-1 text-primary"} role="status" aria-live={displayedPlaybackStatus === "error" ? "assertive" : "polite"}>{displayedPlaybackStatus === "error" ? <WifiOff className="h-3 w-3" /> : <LoaderCircle className="h-3 w-3 animate-spin" />}{playbackStatusLabel(displayedPlaybackStatus, playbackError, retryAttempt)}</span>}
            </div>
          </div>
        </div>
        <Button size="icon" variant="ghost" className="hidden h-9 w-9 sm:inline-flex" aria-label="Previous track" onClick={handlePrevious}><SkipBack className="h-4 w-4 fill-current" /></Button>
        <Button
          size="icon"
          variant="glass"
          aria-label={playbackStatus === "error" ? "Retry playback" : isPlaying ? "Pause" : "Play"}
          onClick={handlePlayPause}
        >
          <PlayPauseIcon className="h-4 w-4 fill-current" />
        </Button>
        <Button size="icon" variant="ghost" className="h-9 w-9" aria-label="Next track" onClick={handleNext}><SkipForward className="h-4 w-4 fill-current" /></Button>
        <Button size="icon" variant="ghost" className="h-9 w-9" aria-label={`Open queue, ${queue.length} upcoming tracks`} title="Open queue" onClick={() => useUiStore.getState().requestPlayerView("queue")}><ListMusic className="h-4 w-4" /></Button>
      </div>
      <div className="hidden items-center gap-3 border-t border-white/5 px-4 py-2 text-xs text-muted-foreground sm:flex">
        <span className="tabular-nums">{formatTime(currentTime)} / {formatTime(duration)}</span>
        <button type="button" onClick={() => useUiStore.getState().requestPlayerView("lyrics")} className="ml-auto flex items-center gap-1.5 hover:text-foreground"><Mic2 className="h-3.5 w-3.5" />Lyrics</button>
        <button type="button" onClick={toggleMute} aria-label={isMuted ? "Unmute" : "Mute"} className="grid h-7 w-7 place-items-center rounded-full hover:bg-white/10">{isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}</button>
        <input type="range" min={0} max={1} step={0.01} value={isMuted ? 0 : volume} onChange={(event) => setVolume(Number(event.target.value))} aria-label="Mini-player volume" aria-valuetext={`${Math.round((isMuted ? 0 : volume) * 100)} percent`} className="w-20 accent-primary" />
      </div>
    </motion.div>
  );
}
