import { audioService } from "@/services/audio-service";
import { usePlaybackPreferencesStore } from "@/stores/playback-preferences-store";
import { usePlayerStore } from "@/stores/player-store";
import { useUiStore } from "@/stores/ui-store";

export interface PlayerCommand {
  id: string;
  label: string;
  group: "Transport" | "Playback modes" | "Player views";
  keys: string;
  code: string;
  modified?: boolean;
  needsTrack?: boolean;
  run: () => void;
}

function previous() {
  const player = usePlayerStore.getState();
  const id = player.currentSong?.id;
  const track = player.playPreviousSong();
  if (track) {
    if (track.id === id) audioService.seek(0);
    player.setIsPlaying(true);
  }
}

function seek(direction: number) {
  const duration = audioService.getDuration();
  if (!Number.isFinite(duration) || duration <= 0) return;
  audioService.seek(Math.max(0, Math.min(duration, audioService.getCurrentTime() + direction * usePlaybackPreferencesStore.getState().seekStepSeconds)));
}

export const playerCommands: PlayerCommand[] = [
  { id: "play-pause", label: "Play or pause", group: "Transport", keys: "Space", code: "Space", needsTrack: true, run: () => { const p = usePlayerStore.getState(); if (p.playbackStatus === "error") p.retryCurrentSong(); else p.setIsPlaying(!p.isPlaying); } },
  { id: "previous", label: "Previous track", group: "Transport", keys: "Ctrl/⌘ ←", code: "ArrowLeft", modified: true, needsTrack: true, run: previous },
  { id: "next", label: "Next track", group: "Transport", keys: "Ctrl/⌘ →", code: "ArrowRight", modified: true, needsTrack: true, run: () => { const p = usePlayerStore.getState(); if (p.playNextManually()) p.setIsPlaying(true); } },
  { id: "seek-back", label: "Seek backward", group: "Transport", keys: "←", code: "ArrowLeft", needsTrack: true, run: () => seek(-1) },
  { id: "seek-forward", label: "Seek forward", group: "Transport", keys: "→", code: "ArrowRight", needsTrack: true, run: () => seek(1) },
  { id: "volume-up", label: "Volume up", group: "Transport", keys: "↑", code: "ArrowUp", run: () => { const p = usePlayerStore.getState(); p.setVolume(p.volume + 0.1); } },
  { id: "volume-down", label: "Volume down", group: "Transport", keys: "↓", code: "ArrowDown", run: () => { const p = usePlayerStore.getState(); p.setVolume(p.volume - 0.1); } },
  { id: "mute", label: "Mute or unmute", group: "Transport", keys: "M", code: "KeyM", run: () => usePlayerStore.getState().toggleMute() },
  { id: "shuffle", label: "Toggle shuffle", group: "Playback modes", keys: "S", code: "KeyS", run: () => usePlayerStore.getState().toggleShuffle() },
  { id: "repeat", label: "Cycle repeat mode", group: "Playback modes", keys: "R", code: "KeyR", run: () => usePlayerStore.getState().cycleRepeat() },
  { id: "autoplay", label: "Toggle autoplay radio", group: "Playback modes", keys: "A", code: "KeyA", run: () => { const p = usePlaybackPreferencesStore.getState(); p.setAutoplayEnabled(!p.autoplayEnabled); } },
  { id: "slower", label: "Decrease speed", group: "Playback modes", keys: "[", code: "BracketLeft", run: () => { const p = usePlaybackPreferencesStore.getState(); p.setPlaybackRate(p.playbackRate - 0.25); } },
  { id: "faster", label: "Increase speed", group: "Playback modes", keys: "]", code: "BracketRight", run: () => { const p = usePlaybackPreferencesStore.getState(); p.setPlaybackRate(p.playbackRate + 0.25); } },
  { id: "reset-speed", label: "Reset speed to 1×", group: "Playback modes", keys: "0", code: "Digit0", run: () => usePlaybackPreferencesStore.getState().setPlaybackRate(1) },
  { id: "timer", label: "Start or cancel a 30-minute timer", group: "Playback modes", keys: "T", code: "KeyT", needsTrack: true, run: () => { const p = usePlaybackPreferencesStore.getState(); if (p.sleepTimerEndsAt || p.sleepTimerEndOfTrack) p.clearSleepTimer(); else p.startSleepTimer(30); } },
  ...([ ["queue", "Q", "KeyQ"], ["lyrics", "L", "KeyL"], ["tools", "E", "KeyE"], ["player", "F", "KeyF"] ] as const).map(([view, keys, code]): PlayerCommand => ({ id: view, label: `Open ${view === "tools" ? "playback studio" : view}`, group: "Player views", keys, code, needsTrack: true, run: () => useUiStore.getState().requestPlayerView(view) })),
  { id: "bookmark", label: "Bookmark the current position", group: "Player views", keys: "B", code: "KeyB", needsTrack: true, run: () => { const p = usePlayerStore.getState(); if (p.currentSong) usePlaybackPreferencesStore.getState().addBookmark(p.currentSong.id, p.currentTime); } },
];
