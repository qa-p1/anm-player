import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useNavigate } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { SearchPage } from "@/features/search/search-page";
import * as api from "@/services/music-api";
import type { OnlineMusicItem, OnlineSearchResponse } from "@/types/api";
vi.mock("@/services/music-api", () => ({ listAllDownloads: vi.fn(async () => []), getLibraryAlbumStatuses: vi.fn(async () => ({ statuses: [] })), getLibraryTrackStatuses: vi.fn(async () => ({ statuses: [] })), searchYouTubeMusic: vi.fn() }));
vi.mock("@/components/cards/online-music-card", () => ({ OnlineMusicCard: ({ item }: { item: OnlineMusicItem }) => <p>{item.title}</p> }));
const item = (id: string): OnlineMusicItem => ({ id, title: id, source: "youtube", kind: "song", subtitle: null, artists: [], album: null, thumbnail: null, duration_seconds: 60, explicit: false, playable: true, browse_id: null, playlist_id: null, endpoint: null, url: `https://music.youtube.com/watch?v=${id}` });
let client: QueryClient;
afterEach(() => { cleanup(); client.clear(); vi.clearAllMocks(); });
function NavigateSearch() { const navigate = useNavigate(); return <button onClick={() => navigate("/search?q=Beta&filter=albums")}>Jump to Beta</button>; }
function setup() {
  client = new QueryClient();
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/search?q=Alpha"]}><SearchPage /><NavigateSearch /></MemoryRouter></QueryClientProvider>);
}
it("does not append stale pagination after navigating to another search", async () => {
  let resolveMore!: (value: OnlineSearchResponse) => void;
  vi.mocked(api.searchYouTubeMusic).mockImplementation(async (query, _filter, continuation) => {
    if (continuation) return new Promise((resolve) => { resolveMore = resolve; });
    return { source: "youtube", query, filter: "songs", items: [item(query)], continuation: query === "Alpha" ? "next" : null };
  });
  setup();
  await screen.findByText("Alpha");
  fireEvent.click(screen.getByRole("button", { name: /Load more/i }));
  fireEvent.click(screen.getByRole("button", { name: "Jump to Beta" }));
  expect(screen.getByRole("textbox", { name: "Search YouTube Music" })).toHaveValue("Beta");
  expect(await screen.findByText("Beta")).toBeInTheDocument();
  await act(async () => resolveMore({ query: "Alpha", filter: "songs", items: [item("Stale page")], continuation: null }));
  await waitFor(() => expect(screen.queryByText("Stale page")).not.toBeInTheDocument());
  expect(screen.getByRole("button", { name: /^Albums$/ })).toHaveAttribute("aria-pressed", "true");
});
