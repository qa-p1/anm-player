import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { SmartCollectionPage } from "@/features/library/smart-collection-page";
import { ArtistDetailPage } from "@/features/library/artist-detail-page";
import { invalidateHistory } from "@/services/music-invalidation";
import type { HistoryEntry } from "@/types/api";
import * as api from "@/services/music-api";
vi.mock("@/services/music-api", async (importOriginal) => ({ ...await importOriginal<typeof import("@/services/music-api")>(), getRecentlyPlayedHistory: vi.fn(), getArtist: vi.fn() }));
vi.mock("@/components/cards/track-row", () => ({ TrackRow: ({ track }: { track: { title: string } }) => <p>{track.title}</p> }));
const clients: QueryClient[] = [];
afterEach(() => { cleanup(); clients.forEach((client) => client.clear()); vi.resetAllMocks(); });
function history(title: string): HistoryEntry { return { id: 1, song_id: null, song: null, source: "youtube", external_id: "video", title, artist_name: "Artist", album_title: null, artwork_url: null, duration_seconds: 60, source_url: "https://music.youtube.com/watch?v=video", event_type: "played", played_at: "2026-01-01", position_seconds: 0 }; }
function setup(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Routes><Route path="/library/smart/:collectionId" element={<SmartCollectionPage />} /><Route path="/library/artists/:artistId" element={<ArtistDetailPage />} /></Routes></MemoryRouter></QueryClientProvider>);
  return client;
}
it("refreshes a mounted recent collection when listening history changes", async () => {
  vi.mocked(api.getRecentlyPlayedHistory).mockResolvedValueOnce([history("Before")]).mockResolvedValue([history("After")]);
  const client = setup("/library/smart/recently-played");
  expect(await screen.findByText("Before")).toBeInTheDocument();
  await act(() => invalidateHistory(client));
  expect(await screen.findByText("After")).toBeInTheDocument();
  expect(screen.queryByText("Before")).not.toBeInTheDocument();
});
it("shows an artist error with retry rather than silently reporting missing content", async () => {
  vi.mocked(api.getArtist).mockRejectedValueOnce(new Error("Connection interrupted")).mockResolvedValue({ id: 1, name: "Recovered artist", sort_name: null, artwork_path: null, artwork_url: null, song_count: 0, album_count: 0, is_favorited: false, created_at: "2026-01-01", updated_at: "2026-01-01", albums: [], top_songs: [] });
  setup("/library/artists/1");
  expect(await screen.findByText("Connection interrupted")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByRole("heading", { name: "Recovered artist" })).toBeInTheDocument();
});
