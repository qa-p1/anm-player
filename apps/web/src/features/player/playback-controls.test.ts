import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTrack, previousTrack, seekPlayback, togglePlayback } from "@/features/player/playback-controls";
import { usePlayerStore } from "@/stores/player-store";
import { audioService } from "@/services/audio-service";
import { playerTrack } from "@/test/music-fixtures";
vi.mock("@/services/audio-service", () => ({ audioService: { seek: vi.fn(), getDuration: () => 120 } }));
beforeEach(() => {
  vi.clearAllMocks();
  usePlayerStore.setState({ currentSong: null, isPlaying: false, queue: [], queueHistory: [], currentTime: 0, playbackStatus: "idle", shuffle: false, repeat: "off" });
});
describe("shared playback controls", () => {
  it("restarts the current track before navigating back through history", () => {
    const player = usePlayerStore.getState();
    player.playPlaylist([playerTrack(1), playerTrack(2)]);
    nextTrack();
    player.setCurrentTime(10);
    previousTrack();
    expect(audioService.seek).toHaveBeenCalledWith(0);
    expect(usePlayerStore.getState().currentSong?.id).toBe("local:2");
    previousTrack();
    expect(usePlayerStore.getState()).toMatchObject({ currentSong: { id: "local:1" }, isPlaying: true });
  });
  it("retries an errored track and cannot start an empty player", () => {
    togglePlayback();
    expect(usePlayerStore.getState().isPlaying).toBe(false);
    usePlayerStore.getState().playSong(playerTrack());
    usePlayerStore.getState().setPlaybackStatus("error", "Failed");
    togglePlayback();
    expect(usePlayerStore.getState()).toMatchObject({ isPlaying: true, playbackStatus: "loading", playbackError: null, retryAttempt: 1 });
  });
  it("clamps seek targets and keeps the visible position synchronized", () => {
    usePlayerStore.getState().playSong(playerTrack());
    seekPlayback(300);
    expect(audioService.seek).toHaveBeenLastCalledWith(120);
    expect(usePlayerStore.getState().currentTime).toBe(120);
    seekPlayback(-10);
    expect(audioService.seek).toHaveBeenLastCalledWith(0);
    seekPlayback(Number.NaN);
    expect(audioService.seek).toHaveBeenCalledTimes(2);
  });
});
