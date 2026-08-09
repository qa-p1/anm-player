import { useEffect } from "react";

import { audioService } from "@/services/audio-service";
import { usePlaybackPreferencesStore } from "@/stores/playback-preferences-store";
import { usePlayerStore } from "@/stores/player-store";
import { useUiStore } from "@/stores/ui-store";

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
        playNextManually,
        playPreviousSong,
        toggleMute,
        setVolume,
        volume,
        toggleShuffle,
        cycleRepeat,
      } = usePlayerStore.getState();
      const preferences = usePlaybackPreferencesStore.getState();

      if (event.key === "?" || (event.code === "Slash" && event.shiftKey)) {
        event.preventDefault();
        const ui = useUiStore.getState();
        ui.setShortcutHelpOpen(!ui.isShortcutHelpOpen);
        return;
      }

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

      if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        if (event.code === "KeyS") {
          event.preventDefault();
          toggleShuffle();
          return;
        }
        if (event.code === "KeyR") {
          event.preventDefault();
          cycleRepeat();
          return;
        }
        if (event.code === "KeyA") {
          event.preventDefault();
          preferences.setAutoplayEnabled(!preferences.autoplayEnabled);
          return;
        }
        if (event.code === "KeyQ") {
          event.preventDefault();
          useUiStore.getState().requestPlayerView("queue");
          return;
        }
        if (event.code === "KeyL") {
          event.preventDefault();
          useUiStore.getState().requestPlayerView("lyrics");
          return;
        }
        if (event.code === "KeyE") {
          event.preventDefault();
          useUiStore.getState().requestPlayerView("tools");
          return;
        }
        if (event.code === "KeyB") {
          event.preventDefault();
          const current = usePlayerStore.getState();
          if (current.currentSong) preferences.addBookmark(current.currentSong.id, current.currentTime);
          return;
        }
        if (event.code === "BracketLeft") {
          event.preventDefault();
          preferences.setPlaybackRate(preferences.playbackRate - 0.25);
          return;
        }
        if (event.code === "BracketRight") {
          event.preventDefault();
          preferences.setPlaybackRate(preferences.playbackRate + 0.25);
          return;
        }
        if (event.code === "Digit0") {
          event.preventDefault();
          preferences.setPlaybackRate(1);
          return;
        }
        if (event.code === "KeyT") {
          event.preventDefault();
          if (preferences.sleepTimerEndsAt || preferences.sleepTimerEndOfTrack) preferences.clearSleepTimer();
          else preferences.startSleepTimer(30);
          return;
        }
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
          const nextSong = playNextManually();
          if (nextSong) setIsPlaying(true);
          return;
        }
      } else {
        // Left Arrow - Seek backward 10s
        if (event.code === "ArrowLeft") {
          event.preventDefault();
          const newTime = Math.max(0, audioService.getCurrentTime() - usePlaybackPreferencesStore.getState().seekStepSeconds);
          audioService.seek(newTime);
          return;
        }

        // Right Arrow - Seek forward 10s
        if (event.code === "ArrowRight") {
          event.preventDefault();
          const newTime = Math.min(
            audioService.getDuration(),
            audioService.getCurrentTime() + usePlaybackPreferencesStore.getState().seekStepSeconds,
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
