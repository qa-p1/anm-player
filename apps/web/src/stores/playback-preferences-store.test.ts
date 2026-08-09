import { beforeEach, describe, expect, it, vi } from "vitest";

import { EQ_PRESETS, usePlaybackPreferencesStore } from "@/stores/playback-preferences-store";

describe("playback preferences", () => {
  beforeEach(() => {
    vi.useRealTimers();
    usePlaybackPreferencesStore.setState({
      playbackRate: 1,
      preservesPitch: true,
      seekStepSeconds: 10,
      equalizerEnabled: false,
      equalizerPreset: "flat",
      equalizerGains: [...EQ_PRESETS.flat],
      preampDb: 0,
      stereoBalance: 0,
      monoEnabled: false,
      normalizationEnabled: false,
      outputDeviceId: null,
      sleepTimerEndsAt: null,
      sleepTimerEndOfTrack: false,
      sleepFadeSeconds: 5,
      stopAfterCurrent: false,
      autoplayEnabled: false,
      skipOnPlaybackError: true,
      abRepeat: { trackId: null, startSeconds: null, endSeconds: null, enabled: false },
      bookmarks: [],
    });
  });

  it("clamps transport and sound preferences and supports presets", () => {
    const preferences = usePlaybackPreferencesStore.getState();
    preferences.setPlaybackRate(9);
    preferences.setSeekStepSeconds(0);
    preferences.setPreampDb(20);
    preferences.setStereoBalance(-2);
    preferences.applyEqualizerPreset("rock");

    expect(usePlaybackPreferencesStore.getState()).toMatchObject({
      playbackRate: 4,
      seekStepSeconds: 1,
      preampDb: 12,
      stereoBalance: -1,
      equalizerPreset: "rock",
      equalizerGains: EQ_PRESETS.rock,
    });

    usePlaybackPreferencesStore.getState().setEqualizerBand(2, 99);
    expect(usePlaybackPreferencesStore.getState().equalizerPreset).toBe("custom");
    expect(usePlaybackPreferencesStore.getState().equalizerGains[2]).toBe(12);
  });

  it("manages timed and end-of-track sleep modes independently", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T10:00:00Z"));
    const endsAt = usePlaybackPreferencesStore.getState().startSleepTimer(30, 8);
    expect(endsAt).toBe(Date.now() + 30 * 60_000);
    expect(usePlaybackPreferencesStore.getState()).toMatchObject({
      sleepTimerEndsAt: endsAt,
      sleepTimerEndOfTrack: false,
      sleepFadeSeconds: 8,
    });

    usePlaybackPreferencesStore.getState().startEndOfTrackSleepTimer(3);
    expect(usePlaybackPreferencesStore.getState()).toMatchObject({
      sleepTimerEndsAt: null,
      sleepTimerEndOfTrack: true,
      sleepFadeSeconds: 3,
    });
    usePlaybackPreferencesStore.getState().setSleepFadeSeconds(12);
    expect(usePlaybackPreferencesStore.getState().sleepFadeSeconds).toBe(12);
    usePlaybackPreferencesStore.getState().clearSleepTimer();
    expect(usePlaybackPreferencesStore.getState().sleepTimerEndOfTrack).toBe(false);
  });

  it("validates A-B loops and maintains reusable per-track bookmarks", () => {
    const preferences = usePlaybackPreferencesStore.getState();
    preferences.setAbRepeatStart("youtube:a", 20);
    preferences.setAbRepeatEnd("youtube:a", 10);
    expect(usePlaybackPreferencesStore.getState().abRepeat.endSeconds).toBeNull();

    preferences.setAbRepeatEnd("youtube:a", 35);
    expect(usePlaybackPreferencesStore.getState().abRepeat).toEqual({
      trackId: "youtube:a",
      startSeconds: 20,
      endSeconds: 35,
      enabled: true,
    });

    const bookmark = preferences.addBookmark("youtube:a", 24.5, "Solo");
    preferences.updateBookmark(bookmark.id, { label: "Guitar solo", positionSeconds: 25 });
    expect(usePlaybackPreferencesStore.getState().bookmarks[0]).toMatchObject({
      trackId: "youtube:a",
      label: "Guitar solo",
      positionSeconds: 25,
    });
    preferences.clearTrackBookmarks("youtube:a");
    expect(usePlaybackPreferencesStore.getState().bookmarks).toEqual([]);
  });
});
