import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createPersistStorage } from "@/lib/persist-storage";

export type CollectionViewMode = "grid" | "list";
type CollectionViewKey = "albums" | "playlists";

interface LibraryPreferences {
  pinnedPlaylistIds: number[];
  viewModes: Partial<Record<CollectionViewKey, CollectionViewMode>>;
  togglePlaylistPin: (id: number) => void;
  setViewMode: (key: CollectionViewKey, mode: CollectionViewMode) => void;
}

export const useLibraryPreferencesStore = create<LibraryPreferences>()(persist((set) => ({
  pinnedPlaylistIds: [],
  viewModes: {},
  togglePlaylistPin: (id) => set((state) => ({ pinnedPlaylistIds: state.pinnedPlaylistIds.includes(id)
    ? state.pinnedPlaylistIds.filter((value) => value !== id) : [...state.pinnedPlaylistIds, id] })),
  setViewMode: (key, mode) => set((state) => ({ viewModes: { ...state.viewModes, [key]: mode } })),
}), { name: "anm-library-preferences", storage: createPersistStorage(), merge: (persisted, current) => {
  const value = persisted && typeof persisted === "object" ? persisted as Record<string, unknown> : {};
  const ids = Array.isArray(value.pinnedPlaylistIds) ? value.pinnedPlaylistIds : [];
  const rawModes = value.viewModes && typeof value.viewModes === "object" ? value.viewModes as Record<string, unknown> : {};
  const viewModes: LibraryPreferences["viewModes"] = {};
  for (const key of ["albums", "playlists"] as const) {
    if (rawModes[key] === "grid" || rawModes[key] === "list") viewModes[key] = rawModes[key];
  }
  return { ...current, viewModes, pinnedPlaylistIds: [...new Set(ids.filter((id): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0))] };
} }));
