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
  const state = usePlayerStore.getState();
  const loaded = audioService.getDuration();
  const isLoaded = Number.isFinite(loaded) && loaded > 0;
  // Before the song loads (e.g. right after reopening the app) the position is
  // only remembered; loading resumes from it.
  const duration = isLoaded ? loaded : state.currentSong?.durationSeconds ?? 0;
  if (!Number.isFinite(duration) || duration <= 0) return;
  const target = Math.max(0, Math.min(duration, time));
  state.setCurrentTime(target);
  if (isLoaded) audioService.seek(target);
}

export function seekByStep(direction: number) {
  const loaded = audioService.getDuration() > 0;
  seekPlayback((loaded ? audioService.getCurrentTime() : usePlayerStore.getState().currentTime) + direction * usePlaybackPreferencesStore.getState().seekStepSeconds);
}
