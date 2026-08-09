import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSearchHistoryStore } from "@/stores/search-history-store";

describe("search history", () => {
  beforeEach(() => {
    vi.useRealTimers();
    useSearchHistoryStore.setState({ entries: [] });
  });

  it("normalizes and ranks repeated searches without duplicating them", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T10:00:00Z"));
    useSearchHistoryStore.getState().recordSearch("  Massive   Attack  ");
    vi.advanceTimersByTime(1_000);
    useSearchHistoryStore.getState().recordSearch("massive attack");

    expect(useSearchHistoryStore.getState().entries).toEqual([
      expect.objectContaining({ query: "Massive Attack", pinned: false, useCount: 2 }),
    ]);
  });

  it("keeps pinned searches when recent history is cleared", () => {
    useSearchHistoryStore.getState().recordSearch("Portishead");
    useSearchHistoryStore.getState().recordSearch("Radiohead");
    useSearchHistoryStore.getState().togglePinned("Portishead");
    useSearchHistoryStore.getState().clearRecent();

    expect(useSearchHistoryStore.getState().entries).toEqual([
      expect.objectContaining({ query: "Portishead", pinned: true }),
    ]);
  });

  it("ignores unusable queries and supports explicit removal", () => {
    useSearchHistoryStore.getState().recordSearch("a");
    useSearchHistoryStore.getState().recordSearch("Boards of Canada");
    useSearchHistoryStore.getState().removeSearch("Boards of Canada");

    expect(useSearchHistoryStore.getState().entries).toEqual([]);
  });
});
