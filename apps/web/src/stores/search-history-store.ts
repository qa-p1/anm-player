import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SearchHistoryEntry {
  query: string;
  pinned: boolean;
  useCount: number;
  lastUsedAt: number;
}

interface SearchHistoryState {
  entries: SearchHistoryEntry[];
  recordSearch: (query: string) => void;
  togglePinned: (query: string) => void;
  removeSearch: (query: string) => void;
  clearRecent: () => void;
}

export const useSearchHistoryStore = create<SearchHistoryState>()(
  persist(
    (set) => ({
      entries: [],
      recordSearch: (rawQuery) => set((state) => {
        const query = rawQuery.trim().replace(/\s+/g, " ");
        if (query.length < 2) return state;
        const existing = state.entries.find((entry) => entry.query.toLocaleLowerCase() === query.toLocaleLowerCase());
        const next: SearchHistoryEntry = {
          query: existing?.query ?? query,
          pinned: existing?.pinned ?? false,
          useCount: (existing?.useCount ?? 0) + 1,
          lastUsedAt: Date.now(),
        };
        const remaining = state.entries.filter((entry) => entry !== existing);
        return { entries: [next, ...remaining].sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.lastUsedAt - left.lastUsedAt).slice(0, 24) };
      }),
      togglePinned: (query) => set((state) => ({
        entries: state.entries.map((entry) => entry.query === query ? { ...entry, pinned: !entry.pinned } : entry)
          .sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.lastUsedAt - left.lastUsedAt),
      })),
      removeSearch: (query) => set((state) => ({ entries: state.entries.filter((entry) => entry.query !== query) })),
      clearRecent: () => set((state) => ({ entries: state.entries.filter((entry) => entry.pinned) })),
    }),
    { name: "anm-search-history", version: 1 },
  ),
);
