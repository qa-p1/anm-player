import { audioService } from "@/services/audio-service";
import { usePlayerStore } from "@/stores/player-store";
import { usePlaybackPreferencesStore } from "@/stores/playback-preferences-store";

export function togglePlayback() {
  const player = usePlayerStore.getState();
  if (!player.currentSong) return;
  if (player.playbackStatus === "error") player.retryCurrentSong();
  else player.setIsPlaying(!player.isPlaying);
}

export function previousTrack() {
  const player = usePlayerStore.getState();
  const id = player.currentSong?.id;
  const track = player.playPreviousSong();
  if (!track) return;
  if (track.id === id) audioService.seek(0);
  player.setIsPlaying(true);
}

export function nextTrack() {
  const player = usePlayerStore.getState();
  if (player.playNextManually()) player.setIsPlaying(true);
}

export function seekPlayback(time: number) {
  if (!Number.isFinite(time)) return;
  const duration = audioService.getDuration();
  if (!Number.isFinite(duration) || duration <= 0) return;
  const target = Math.max(0, Math.min(duration, time));
  usePlayerStore.getState().setCurrentTime(target);
  audioService.seek(target);
}

export function seekByStep(direction: number) {
  seekPlayback(audioService.getCurrentTime() + direction * usePlaybackPreferencesStore.getState().seekStepSeconds);
}
