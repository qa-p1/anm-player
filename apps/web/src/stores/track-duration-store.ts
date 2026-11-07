import { create } from "zustand";
import { persist } from "zustand/middleware";

import { createPersistStorage } from "@/lib/persist-storage";
import { usePlayerStore } from "@/stores/player-store";

const MAX_ENTRIES = 2000;

interface TrackDurationState {
  /** Lengths learned from the audio element for tracks the API sent without one. */
  durations: Record<string, number>;
  remember: (trackId: string, seconds: number) => void;
}

export const useTrackDurationStore = create<TrackDurationState>()(persist((set) => ({
  durations: {},
  remember: (trackId, seconds) => set((state) => {
    const rounded = Math.round(seconds);
    if (!trackId || !Number.isFinite(rounded) || rounded <= 0 || state.durations[trackId] === rounded) return state;
    const entries = Object.entries(state.durations).filter(([key]) => key !== trackId);
    // Oldest entries go first once the cap is reached.
    return { durations: Object.fromEntries([...entries.slice(-(MAX_ENTRIES - 1)), [trackId, rounded]]) };
  }),
}), {
  name: "anm-track-durations",
  storage: createPersistStorage(),
  partialize: (state) => ({ durations: state.durations }) as TrackDurationState,
  merge: (persisted, current) => {
    const raw = persisted && typeof persisted === "object" && "durations" in persisted ? (persisted as { durations: unknown }).durations : null;
    const durations: Record<string, number> = {};
    if (raw && typeof raw === "object") {
      for (const [key, value] of Object.entries(raw)) if (typeof value === "number" && Number.isFinite(value) && value > 0) durations[key] = value;
    }
    return { ...current, durations };
  },
}));

// Learn the real length whenever a track without one starts playing.
usePlayerStore.subscribe((state) => {
  const song = state.currentSong;
  if (!song || (song.durationSeconds ?? 0) > 0) return;
  if (Number.isFinite(state.duration) && state.duration > 0) useTrackDurationStore.getState().remember(song.id, state.duration);
});

/** Best known length for a track, or null when it is genuinely unknown. */
export function knownTrackDuration(trackId: string, apiSeconds: number | null | undefined): number | null {
  if (apiSeconds && apiSeconds > 0) return apiSeconds;
  return useTrackDurationStore.getState().durations[trackId] ?? null;
}
