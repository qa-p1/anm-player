import { useEffect } from "react";

import { audioService } from "@/services/audio-service";
import { usePlayerStore } from "@/stores/player-store";

export function useKeyboardShortcuts() {
  useEffect(() => {
    function handleKeyPress(event: KeyboardEvent) {
      // Ignore if user is typing in an input
      const target = event.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      const {
        isPlaying,
        setIsPlaying,
        playNextSong,
        playPreviousSong,
        toggleMute,
        setVolume,
        volume,
      } = usePlayerStore.getState();

      // Space - Play/Pause
      if (event.code === "Space") {
        event.preventDefault();
        setIsPlaying(!isPlaying);
        return;
      }

      // M - Mute
      if (event.code === "KeyM") {
        event.preventDefault();
        toggleMute();
        return;
      }

      // Arrow keys with modifiers
      if (event.ctrlKey || event.metaKey) {
        // Ctrl/Cmd + Left Arrow - Previous track
        if (event.code === "ArrowLeft") {
          event.preventDefault();
          const currentId = usePlayerStore.getState().currentSong?.id;
          const prevSong = playPreviousSong();
          if (prevSong) {
            if (prevSong.id === currentId) audioService.seek(0);
            setIsPlaying(true);
          }
          return;
        }

        // Ctrl/Cmd + Right Arrow - Next track
        if (event.code === "ArrowRight") {
          event.preventDefault();
          const nextSong = playNextSong();
          if (nextSong) setIsPlaying(true);
          return;
        }
      } else {
        // Left Arrow - Seek backward 10s
        if (event.code === "ArrowLeft") {
          event.preventDefault();
          const newTime = Math.max(0, audioService.getCurrentTime() - 10);
          audioService.seek(newTime);
          return;
        }

        // Right Arrow - Seek forward 10s
        if (event.code === "ArrowRight") {
          event.preventDefault();
          const newTime = Math.min(
            audioService.getDuration(),
            audioService.getCurrentTime() + 10,
          );
          audioService.seek(newTime);
          return;
        }

        // Up Arrow - Volume up
        if (event.code === "ArrowUp") {
          event.preventDefault();
          setVolume(Math.min(1, volume + 0.1));
          return;
        }

        // Down Arrow - Volume down
        if (event.code === "ArrowDown") {
          event.preventDefault();
          setVolume(Math.max(0, volume - 0.1));
          return;
        }
      }
    }

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, []);
}
