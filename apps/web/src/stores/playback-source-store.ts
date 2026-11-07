import { create } from "zustand";

import { usePlayerStore } from "@/stores/player-store";

export interface PlaybackSource {
  kind: "playlist" | "album" | "artist";
  id: string;
  trackIds: ReadonlySet<string>;
}

interface PlaybackSourceState {
  source: PlaybackSource | null;
  setSource: (kind: PlaybackSource["kind"], id: string | number, trackIds: Iterable<string>) => void;
  clear: () => void;
}

/** Which collection the current song was started from (for "now playing" markers). */
export const usePlaybackSourceStore = create<PlaybackSourceState>()((set) => ({
  source: null,
  setSource: (kind, id, trackIds) => set({ source: { kind, id: String(id), trackIds: new Set(trackIds) } }),
  clear: () => set({ source: null }),
}));

// Once something outside the collection plays, the marker no longer applies.
usePlayerStore.subscribe((state, previous) => {
  const id = state.currentSong?.id ?? null;
  if (id === (previous.currentSong?.id ?? null)) return;
  const { source, clear } = usePlaybackSourceStore.getState();
  if (source && (!id || !source.trackIds.has(id))) clear();
});
