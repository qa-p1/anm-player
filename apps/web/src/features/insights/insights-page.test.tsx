import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";

import { InsightsPage } from "@/features/insights/insights-page";
import * as api from "@/services/music-api";
import type { HistoryEntry } from "@/types/api";

vi.mock("@/services/music-api", () => ({ getListeningInsights: vi.fn(), listHistory: vi.fn(), deleteHistoryEntry: vi.fn(), clearHistory: vi.fn() }));
vi.mock("@/components/ui/toast", () => ({ toast: vi.fn() }));

function entry(id: number): HistoryEntry {
  return { id, song_id: null, song: null, source: "youtube", external_id: `v${id}`, title: `Track ${id}`, artist_name: "Artist", album_title: null, artwork_url: null, duration_seconds: 60, source_url: `https://music.youtube.com/watch?v=v${id}`, event_type: "played", played_at: new Date().toISOString(), position_seconds: 0 };
}

afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("shows the first history batch and appends older entries with Load more", async () => {
  vi.mocked(api.getListeningInsights).mockRejectedValue(new Error("No insights"));
  vi.mocked(api.listHistory).mockImplementation(async (limit = 25, offset = 0) => Array.from({ length: offset === 0 ? limit : 3 }, (_, index) => entry(offset + index + 1)));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><InsightsPage /></MemoryRouter></QueryClientProvider>);

  expect(await screen.findByText("Track 25")).toBeInTheDocument();
  expect(screen.queryByText("Track 26")).not.toBeInTheDocument();
  expect(api.listHistory).toHaveBeenCalledWith(25, 0, expect.anything(), undefined);

  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  expect(await screen.findByText("Track 28")).toBeInTheDocument();
  expect(screen.getByText("Track 1")).toBeInTheDocument();
  expect(api.listHistory).toHaveBeenLastCalledWith(25, 25, expect.anything(), undefined);
  expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "skipped" }));
  await screen.findByText("Track 25");
  expect(api.listHistory).toHaveBeenLastCalledWith(25, 0, expect.anything(), "skipped");
  client.clear();
});
