import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createPersistStorage } from "@/lib/persist-storage";

interface LibraryPreferences {
  pinnedPlaylistIds: number[];
  togglePlaylistPin: (id: number) => void;
}

export const useLibraryPreferencesStore = create<LibraryPreferences>()(persist((set) => ({
  pinnedPlaylistIds: [],
  togglePlaylistPin: (id) => set((state) => ({ pinnedPlaylistIds: state.pinnedPlaylistIds.includes(id)
    ? state.pinnedPlaylistIds.filter((value) => value !== id) : [...state.pinnedPlaylistIds, id] })),
}), { name: "anm-library-preferences", storage: createPersistStorage(), merge: (persisted, current) => {
  const ids = persisted && typeof persisted === "object" && "pinnedPlaylistIds" in persisted ? persisted.pinnedPlaylistIds : [];
  return { ...current, pinnedPlaylistIds: Array.isArray(ids) ? [...new Set(ids.filter((id): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0))] : [] };
} }));
