import { create } from "zustand";
import { persist } from "zustand/middleware";

import { createPersistStorage } from "@/lib/persist-storage";

export const EQ_FREQUENCIES = [32, 64, 125, 250, 500, 1_000, 2_000, 4_000, 8_000, 16_000] as const;

export type EqualizerGains = [number, number, number, number, number, number, number, number, number, number];
export type EqualizerPresetName = "flat" | "bass-boost" | "treble-boost" | "vocal" | "rock" | "electronic" | "acoustic" | "custom";

export const EQ_PRESETS: Record<Exclude<EqualizerPresetName, "custom">, EqualizerGains> = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  "bass-boost": [6, 5, 4, 2, 0, -1, -1, 0, 1, 2],
  "treble-boost": [-2, -1, 0, 0, 1, 2, 3, 4, 5, 6],
  vocal: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1],
  rock: [4, 3, 1, -1, -2, 1, 3, 4, 4, 3],
  electronic: [5, 4, 1, 0, -2, 1, 2, 4, 5, 4],
  acoustic: [2, 2, 1, 2, 3, 2, 2, 3, 2, 1],
};

interface PlaybackBookmark {
  id: string;
  trackId: string;
  positionSeconds: number;
  label: string;
  createdAt: number;
  updatedAt: number;
}

interface AbRepeatState {
  trackId: string | null;
  startSeconds: number | null;
  endSeconds: number | null;
  enabled: boolean;
}

interface PlaybackPreferencesState {
  playbackRate: number;
  preservesPitch: boolean;
  seekStepSeconds: number;
  equalizerEnabled: boolean;
  equalizerPreset: EqualizerPresetName;
  equalizerGains: EqualizerGains;
  preampDb: number;
  stereoBalance: number;
  monoEnabled: boolean;
  normalizationEnabled: boolean;
  outputDeviceId: string | null;
  sleepTimerEndsAt: number | null;
  sleepTimerEndOfTrack: boolean;
  sleepFadeSeconds: number;
  stopAfterCurrent: boolean;
  autoplayEnabled: boolean;
  skipOnPlaybackError: boolean;
  abRepeat: AbRepeatState;
  bookmarks: PlaybackBookmark[];

  setPlaybackRate: (rate: number) => void;
  setPreservesPitch: (enabled: boolean) => void;
  setSeekStepSeconds: (seconds: number) => void;
  setEqualizerEnabled: (enabled: boolean) => void;
  applyEqualizerPreset: (preset: EqualizerPresetName) => void;
  setEqualizerBand: (index: number, gainDb: number) => void;
  setPreampDb: (gainDb: number) => void;
  setStereoBalance: (balance: number) => void;
  setMonoEnabled: (enabled: boolean) => void;
  setNormalizationEnabled: (enabled: boolean) => void;
  setOutputDeviceId: (deviceId: string | null) => void;
  startSleepTimer: (minutes: number, fadeSeconds?: number) => number;
  startEndOfTrackSleepTimer: (fadeSeconds?: number) => void;
  setSleepFadeSeconds: (seconds: number) => void;
  clearSleepTimer: () => void;
  setStopAfterCurrent: (enabled: boolean) => void;
  setAutoplayEnabled: (enabled: boolean) => void;
  setSkipOnPlaybackError: (enabled: boolean) => void;
  setAbRepeatStart: (trackId: string, seconds: number) => void;
  setAbRepeatEnd: (trackId: string, seconds: number) => void;
  setAbRepeatEnabled: (enabled: boolean) => void;
  clearAbRepeat: () => void;
  addBookmark: (trackId: string, positionSeconds: number, label?: string) => PlaybackBookmark;
  updateBookmark: (id: string, changes: Partial<Pick<PlaybackBookmark, "label" | "positionSeconds">>) => void;
  removeBookmark: (id: string) => void;
  clearTrackBookmarks: (trackId: string) => void;
  resetAudioProcessing: () => void;
}

const emptyAbRepeat: AbRepeatState = {
  trackId: null,
  startSeconds: null,
  endSeconds: null,
  enabled: false,
};

export const usePlaybackPreferencesStore = create<PlaybackPreferencesState>()(
  persist(
    (set, get) => ({
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
      abRepeat: emptyAbRepeat,
      bookmarks: [],

      setPlaybackRate: (rate) => set({ playbackRate: clamp(rate, 0.25, 4) }),
      setPreservesPitch: (preservesPitch) => set({ preservesPitch }),
      setSeekStepSeconds: (seconds) => set({ seekStepSeconds: Math.round(clamp(seconds, 1, 120)) }),
      setEqualizerEnabled: (equalizerEnabled) => set({ equalizerEnabled }),
      applyEqualizerPreset: (equalizerPreset) => {
        if (equalizerPreset === "custom") {
          set({ equalizerPreset });
          return;
        }
        set({ equalizerPreset, equalizerGains: [...EQ_PRESETS[equalizerPreset]] });
      },
      setEqualizerBand: (index, gainDb) => {
        if (!Number.isInteger(index) || index < 0 || index >= EQ_FREQUENCIES.length) return;
        const equalizerGains = [...get().equalizerGains] as EqualizerGains;
        equalizerGains[index] = clamp(gainDb, -12, 12);
        set({ equalizerGains, equalizerPreset: "custom" });
      },
      setPreampDb: (preampDb) => set({ preampDb: clamp(preampDb, -12, 12) }),
      setStereoBalance: (stereoBalance) => set({ stereoBalance: clamp(stereoBalance, -1, 1) }),
      setMonoEnabled: (monoEnabled) => set({ monoEnabled }),
      setNormalizationEnabled: (normalizationEnabled) => set({ normalizationEnabled }),
      setOutputDeviceId: (outputDeviceId) => set({ outputDeviceId: outputDeviceId || null }),
      startSleepTimer: (minutes, fadeSeconds = get().sleepFadeSeconds) => {
        const sleepTimerEndsAt = Date.now() + clamp(minutes, 0.1, 24 * 60) * 60_000;
        set({
          sleepTimerEndsAt,
          sleepTimerEndOfTrack: false,
          sleepFadeSeconds: clamp(fadeSeconds, 0, 60),
        });
        return sleepTimerEndsAt;
      },
      startEndOfTrackSleepTimer: (fadeSeconds = get().sleepFadeSeconds) => set({
        sleepTimerEndsAt: null,
        sleepTimerEndOfTrack: true,
        sleepFadeSeconds: clamp(fadeSeconds, 0, 60),
      }),
      setSleepFadeSeconds: (sleepFadeSeconds) => set({ sleepFadeSeconds: clamp(sleepFadeSeconds, 0, 60) }),
      clearSleepTimer: () => set({ sleepTimerEndsAt: null, sleepTimerEndOfTrack: false }),
      setStopAfterCurrent: (stopAfterCurrent) => set({ stopAfterCurrent }),
      setAutoplayEnabled: (autoplayEnabled) => set({ autoplayEnabled }),
      setSkipOnPlaybackError: (skipOnPlaybackError) => set({ skipOnPlaybackError }),
      setAbRepeatStart: (trackId, seconds) => {
        const startSeconds = Math.max(0, finiteOr(seconds, 0));
        const current = get().abRepeat;
        const endSeconds = current.trackId === trackId && current.endSeconds !== null && current.endSeconds > startSeconds
          ? current.endSeconds
          : null;
        set({ abRepeat: { trackId, startSeconds, endSeconds, enabled: endSeconds !== null && current.enabled } });
      },
      setAbRepeatEnd: (trackId, seconds) => {
        const current = get().abRepeat;
        const startSeconds = current.trackId === trackId ? current.startSeconds : null;
        const endSeconds = Math.max(0, finiteOr(seconds, 0));
        if (startSeconds === null || endSeconds <= startSeconds + 0.05) return;
        set({ abRepeat: { trackId, startSeconds, endSeconds, enabled: true } });
      },
      setAbRepeatEnabled: (enabled) => set((state) => ({
        abRepeat: {
          ...state.abRepeat,
          enabled: enabled && state.abRepeat.trackId !== null && state.abRepeat.startSeconds !== null && state.abRepeat.endSeconds !== null,
        },
      })),
      clearAbRepeat: () => set({ abRepeat: emptyAbRepeat }),
      addBookmark: (trackId, positionSeconds, label) => {
        const now = Date.now();
        const bookmark: PlaybackBookmark = {
          id: createId("bookmark"),
          trackId,
          positionSeconds: Math.max(0, finiteOr(positionSeconds, 0)),
          label: label?.trim() || `Bookmark ${get().bookmarks.filter((entry) => entry.trackId === trackId).length + 1}`,
          createdAt: now,
          updatedAt: now,
        };
        set((state) => ({ bookmarks: [...state.bookmarks, bookmark] }));
        return bookmark;
      },
      updateBookmark: (id, changes) => set((state) => ({
        bookmarks: state.bookmarks.map((bookmark) => bookmark.id === id
          ? {
              ...bookmark,
              ...(changes.label === undefined ? {} : { label: changes.label.trim() || bookmark.label }),
              ...(changes.positionSeconds === undefined ? {} : { positionSeconds: Math.max(0, finiteOr(changes.positionSeconds, bookmark.positionSeconds)) }),
              updatedAt: Date.now(),
            }
          : bookmark),
      })),
      removeBookmark: (id) => set((state) => ({ bookmarks: state.bookmarks.filter((bookmark) => bookmark.id !== id) })),
      clearTrackBookmarks: (trackId) => set((state) => ({ bookmarks: state.bookmarks.filter((bookmark) => bookmark.trackId !== trackId) })),
      resetAudioProcessing: () => set({
        equalizerEnabled: false,
        equalizerPreset: "flat",
        equalizerGains: [...EQ_PRESETS.flat],
        preampDb: 0,
        stereoBalance: 0,
        monoEnabled: false,
        normalizationEnabled: false,
      }),
    }),
    {
      name: "anm-playback-preferences",
      storage: createPersistStorage(),
      version: 1,
      partialize: (state) => ({
        playbackRate: state.playbackRate,
        preservesPitch: state.preservesPitch,
        seekStepSeconds: state.seekStepSeconds,
        equalizerEnabled: state.equalizerEnabled,
        equalizerPreset: state.equalizerPreset,
        equalizerGains: state.equalizerGains,
        preampDb: state.preampDb,
        stereoBalance: state.stereoBalance,
        monoEnabled: state.monoEnabled,
        normalizationEnabled: state.normalizationEnabled,
        outputDeviceId: state.outputDeviceId,
        sleepTimerEndsAt: state.sleepTimerEndsAt,
        sleepTimerEndOfTrack: state.sleepTimerEndOfTrack,
        sleepFadeSeconds: state.sleepFadeSeconds,
        stopAfterCurrent: state.stopAfterCurrent,
        autoplayEnabled: state.autoplayEnabled,
        skipOnPlaybackError: state.skipOnPlaybackError,
        abRepeat: state.abRepeat,
        bookmarks: state.bookmarks,
      }),
    },
  ),
);

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function createId(prefix: string): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return `${prefix}:${globalThis.crypto.randomUUID()}`;
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}
