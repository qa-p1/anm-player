import { motion } from "framer-motion";
import { Pause, Play } from "lucide-react";
import type { KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { usePlayerStore } from "@/stores/player-store";

interface MiniPlayerProps {
  onOpen: () => void;
}

export function MiniPlayer({ onOpen }: MiniPlayerProps) {
  const { currentSong, isPlaying, setIsPlaying, currentTime, duration } = usePlayerStore();

  // Don't show mini player if no song is loaded
  if (!currentSong) return null;

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const PlayPauseIcon = isPlaying ? Pause : Play;
  const artworkUrl = currentSong.artworkUrl;

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen();
    }
  }

  function handlePlayPause(event: React.MouseEvent) {
    event.stopPropagation();
    setIsPlaying(!isPlaying);
  }

  return (
    <motion.div
      role="button"
      tabIndex={0}
      aria-label="Open player"
      onClick={onOpen}
      onKeyDown={handleKeyDown}
      initial={{ opacity: 0, y: 18, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 18, scale: 0.98 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="glass-panel fixed bottom-24 left-4 right-4 z-40 overflow-hidden rounded-[1.4rem] outline-none transition hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-ring lg:bottom-5 lg:left-auto lg:right-6 lg:w-[28rem]"
    >
      {/* Progress bar */}
      <div className="absolute inset-x-0 top-0 h-0.5 bg-white/10">
        <div
          className="h-full bg-primary transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="flex cursor-pointer items-center justify-between gap-3 p-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl shadow-glow">
            {artworkUrl ? (
              <img
                src={artworkUrl}
                alt={currentSong.title}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="h-full w-full bg-[linear-gradient(135deg,#f43f5e,#14b8a6_52%,#f59e0b)]" />
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {currentSong.title}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {currentSong.artistName || "Unknown Artist"}
            </p>
          </div>
        </div>
        <Button
          size="icon"
          variant="glass"
          aria-label={isPlaying ? "Pause" : "Play"}
          onClick={handlePlayPause}
        >
          <PlayPauseIcon className="h-4 w-4 fill-current" />
        </Button>
      </div>
    </motion.div>
  );
}
