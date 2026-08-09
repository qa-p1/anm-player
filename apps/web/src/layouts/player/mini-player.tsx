import { motion } from "framer-motion";
import { LoaderCircle, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import type { CSSProperties } from "react";

import { ArtworkImage } from "@/components/cards/artwork-image";
import { Button } from "@/components/ui/button";
import { audioService } from "@/services/audio-service";
import { usePlayerStore } from "@/stores/player-store";

interface MiniPlayerProps {
  onOpen: () => void;
}

export function MiniPlayer({ onOpen }: MiniPlayerProps) {
  const {
    currentSong,
    isPlaying,
    setIsPlaying,
    currentTime,
    duration,
    playbackStatus,
    playPreviousSong,
    playNextManually,
  } = usePlayerStore();

  // Don't show mini player if no song is loaded
  if (!currentSong) return null;

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const PlayPauseIcon = isPlaying ? Pause : Play;
  const artworkUrl = currentSong.artworkUrl;

  function handlePlayPause() {
    setIsPlaying(!isPlaying);
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
      className="glass-panel fixed bottom-24 left-4 right-4 z-40 overflow-hidden rounded-[1.4rem] transition hover:bg-card/80 lg:bottom-5 lg:left-auto lg:right-6 lg:w-[32rem]"
    >
      <input
        type="range"
        min={0}
        max={Math.max(duration, 1)}
        step={0.1}
        value={Math.min(currentTime, Math.max(duration, 1))}
        onChange={(event) => audioService.seek(Number(event.target.value))}
        className="apple-player-range absolute inset-x-0 top-[-0.44rem] z-10 w-full"
        style={{ "--range-progress": `${progress}%` } as CSSProperties}
        aria-label="Mini-player song progress"
      />

      <div className="flex items-center justify-between gap-2 p-3">
        <button type="button" onClick={onOpen} aria-label="Open full-screen player" className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-[linear-gradient(135deg,#f43f5e,#14b8a6_52%,#f59e0b)] shadow-glow">
            <ArtworkImage
              src={artworkUrl}
              alt={currentSong.title}
              className="h-full w-full object-cover"
            />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {currentSong.title}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {playbackStatus === "loading" || playbackStatus === "buffering" || playbackStatus === "stalled"
                ? <span className="inline-flex items-center gap-1 text-primary"><LoaderCircle className="h-3 w-3 animate-spin" />{playbackStatus === "loading" ? "Loading" : playbackStatus === "stalled" ? "Connection stalled" : "Buffering"}</span>
                : currentSong.artistName || "Unknown Artist"}
            </p>
          </div>
        </button>
        <Button size="icon" variant="ghost" className="hidden h-9 w-9 sm:inline-flex" aria-label="Previous track" onClick={handlePrevious}><SkipBack className="h-4 w-4 fill-current" /></Button>
        <Button
          size="icon"
          variant="glass"
          aria-label={isPlaying ? "Pause" : "Play"}
          onClick={handlePlayPause}
        >
          <PlayPauseIcon className="h-4 w-4 fill-current" />
        </Button>
        <Button size="icon" variant="ghost" className="h-9 w-9" aria-label="Next track" onClick={handleNext}><SkipForward className="h-4 w-4 fill-current" /></Button>
      </div>
    </motion.div>
  );
}
