import { beforeEach, describe, expect, it, vi } from "vitest";
import { playerTrack } from "@/test/music-fixtures";
beforeEach(() => { vi.resetModules(); localStorage.clear(); });
describe("restoring a listening session", () => {
  it("restores a valid current-version queue paused without trusting invalid saved settings", async () => {
    localStorage.setItem("aura-player-storage", JSON.stringify({ version: 3, state: { currentSong: playerTrack(1), queue: [null, playerTrack(2)], currentTime: -5, volume: "loud", repeat: "broken", shuffle: "false", isPlaying: true, playSong: "overwritten" } }));
    const { usePlayerStore } = await import("@/stores/player-store");
    expect(usePlayerStore.getState()).toMatchObject({ currentSong: { id: "local:1" }, queue: [{ id: "local:2" }], currentTime: 0, volume: 0.8, repeat: "off", shuffle: false, isPlaying: false });
    usePlayerStore.getState().playSong(playerTrack(3));
    expect(usePlayerStore.getState().currentSong?.id).toBe("local:3");
  });
  it("recovers damaged playlist pins without preventing navigation", async () => {
    localStorage.setItem("anm-library-preferences", JSON.stringify({ state: { pinnedPlaylistIds: [1, 1, -1, "2", null, 3] } }));
    const { useLibraryPreferencesStore } = await import("@/stores/library-preferences-store");
    expect(useLibraryPreferencesStore.getState().pinnedPlaylistIds).toEqual([1, 3]);
    useLibraryPreferencesStore.getState().togglePlaylistPin(3);
    expect(useLibraryPreferencesStore.getState().pinnedPlaylistIds).toEqual([1]);
  });
});
