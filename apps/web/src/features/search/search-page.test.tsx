import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SearchPage } from "@/features/search/search-page";
import * as api from "@/services/music-api";
import { useSearchHistoryStore } from "@/stores/search-history-store";
import type { OnlineMusicItem, OnlineSearchResponse } from "@/types/api";

vi.mock("@/services/music-api", () => ({ getLibraryAlbumStatuses: vi.fn(async () => ({ statuses: [] })), getLibraryTrackStatuses: vi.fn(async () => ({ statuses: [] })), searchYouTubeMusic: vi.fn() }));
vi.mock("@/components/cards/online-music-card", () => ({ OnlineMusicCard: ({ item }: { item: OnlineMusicItem }) => <button type="button">{item.title}</button> }));

const item = (id: string, kind: OnlineMusicItem["kind"] = "song"): OnlineMusicItem => ({ id, title: id, source: "youtube", kind, subtitle: null, artists: [], album: null, thumbnail: null, duration_seconds: 60, explicit: false, playable: kind === "song", browse_id: null, playlist_id: null, endpoint: null, url: `https://music.youtube.com/watch?v=${id}` });
const respond = (query: string, filter: string, items: OnlineMusicItem[], continuation: string | null = null): OnlineSearchResponse => ({ query, filter, items, continuation });

let client: QueryClient;
function Location() { return <output data-testid="location">{useLocation().search}</output>; }
function NavigateSearch() { const navigate = useNavigate(); return <><button onClick={() => navigate("/search?q=Beta&filter=albums")}>Jump to Beta</button><button onClick={() => navigate("/elsewhere")}>Leave</button></>; }
function setup(path = "/search?q=Alpha") {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/search" element={<SearchPage />} /><Route path="/elsewhere" element={<p>Elsewhere</p>} /></Routes>
        <NavigateSearch /><Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const input = () => screen.getByRole("textbox", { name: "Search YouTube Music" });

beforeEach(() => {
  useSearchHistoryStore.setState({ entries: [] });
  vi.mocked(api.searchYouTubeMusic).mockImplementation(async (query, filter = "songs") => respond(query, filter, [item(`${query} ${filter}`)]));
});
afterEach(() => { cleanup(); client.clear(); vi.clearAllMocks(); vi.useRealTimers(); });

it("does not append stale pagination after navigating to another search", async () => {
  let resolveMore!: (value: OnlineSearchResponse) => void;
  vi.mocked(api.searchYouTubeMusic).mockImplementation(async (query, filter = "songs", continuation) => {
    if (continuation) return new Promise((resolve) => { resolveMore = resolve; });
    return respond(query, filter, [item(query)], query === "Alpha" ? "next" : null);
  });
  setup();
  await screen.findByText("Alpha");
  fireEvent.click(screen.getByRole("button", { name: /Load more/i }));
  fireEvent.click(screen.getByRole("button", { name: "Jump to Beta" }));
  expect(input()).toHaveValue("Beta");
  expect(await screen.findByText("Beta")).toBeInTheDocument();
  await act(async () => resolveMore(respond("Alpha", "songs", [item("Stale page")])));
  await waitFor(() => expect(screen.queryByText("Stale page")).not.toBeInTheDocument());
  expect(screen.getByRole("button", { name: /^Albums$/ })).toHaveAttribute("aria-pressed", "true");
});

it("searches once typing pauses, not on every key", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  setup("/search");
  for (const value of ["c", "co", "col", "cold", "coldplay"]) fireEvent.change(input(), { target: { value } });
  expect(screen.getByTestId("location")).toHaveTextContent(/^$/);
  await act(async () => { await vi.advanceTimersByTimeAsync(350); });
  expect(await screen.findByText("coldplay all")).toBeInTheDocument();
  expect(vi.mocked(api.searchYouTubeMusic).mock.calls.map(([query]) => query)).toEqual(["coldplay"]);
  expect(screen.getByTestId("location")).toHaveTextContent("q=coldplay");
});

it("never shows one result type's items under another type", async () => {
  let resolveAlbums!: (value: OnlineSearchResponse) => void;
  setup();
  await screen.findByText("Alpha all");
  vi.mocked(api.searchYouTubeMusic).mockImplementation(() => new Promise((resolve) => { resolveAlbums = resolve; }));
  fireEvent.click(screen.getByRole("button", { name: /^Albums$/ }));
  expect(screen.queryByText("Alpha all")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Loading results")).toBeInTheDocument();
  await act(async () => resolveAlbums(respond("Alpha", "albums", [item("Alpha album", "album")])));
  expect(await screen.findByText("Alpha album")).toBeInTheDocument();
});

it("shows earlier results instantly when coming back", async () => {
  setup();
  await screen.findByText("Alpha all");
  fireEvent.click(screen.getByRole("button", { name: "Leave" }));
  await screen.findByText("Elsewhere");
  cleanup();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/search?q=Alpha"]}><Routes><Route path="/search" element={<SearchPage />} /></Routes></MemoryRouter>
    </QueryClientProvider>,
  );
  expect(screen.getByText("Alpha all")).toBeInTheDocument();
  expect(api.searchYouTubeMusic).toHaveBeenCalledTimes(1);
});

it("offers a retry when the search fails", async () => {
  vi.mocked(api.searchYouTubeMusic).mockRejectedValueOnce(new Error("YouTube Music search failed.")).mockRejectedValueOnce(new Error("YouTube Music search failed."));
  setup();
  expect(await screen.findByRole("alert", {}, { timeout: 2000 })).toHaveTextContent("YouTube Music search failed.");
  expect(screen.queryByText("No results found")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Alpha all")).toBeInTheDocument();
});

it("remembers a search only when it's used", async () => {
  setup();
  await screen.findByText("Alpha all");
  expect(useSearchHistoryStore.getState().entries).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Alpha all" }));
  expect(useSearchHistoryStore.getState().entries.map((entry) => entry.query)).toEqual(["Alpha"]);
});

it("starts on Top results, grouped by type, with a way to see all of one type", async () => {
  vi.mocked(api.searchYouTubeMusic).mockImplementation(async (query, filter = "all") => respond(query, filter, filter === "all" ? [item("Top artist", "artist"), item("Hit song"), item("Big album", "album")] : [item(`${query} ${filter}`)]));
  setup();
  expect(await screen.findByRole("heading", { name: "Artists" })).toBeInTheDocument();
  const headings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
  expect(headings.slice(0, 3)).toEqual(["Artists", "Songs", "Albums"]);
  fireEvent.click(screen.getAllByRole("button", { name: /See all/ })[1]);
  expect(await screen.findByText("Alpha songs")).toBeInTheDocument();
});
