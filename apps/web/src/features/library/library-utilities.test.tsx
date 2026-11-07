import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlaylistDetailPage } from "@/features/library/playlist-detail-page";
import { SongsLibraryPage } from "@/features/library/songs-library-page";
import { queryClient } from "@/lib/query-client";
import { usePlayerStore } from "@/stores/player-store";
import { playlist, song } from "@/test/music-fixtures";
import * as api from "@/services/music-api";
vi.mock("@/components/ui/toast", () => ({ toast: vi.fn() }));
vi.mock("@/components/cards/song-card", () => ({ SongCard: ({ song }: { song: { title: string } }) => <p>{song.title}</p> }));
vi.mock("@/services/music-api", async (importOriginal) => ({ ...await importOriginal<typeof import("@/services/music-api")>(), getPlaylist: vi.fn(), listAllSongs: vi.fn(), searchAllSongsLocal: vi.fn(), advancedSearchAllSongs: vi.fn() }));
const songs = [song(1, "Night drive"), song(2, "Daylight"), song(3, "Night walk")];
beforeEach(() => {
  queryClient.clear(); queryClient.setDefaultOptions({ queries: { retry: false } });
  usePlayerStore.setState({ currentSong: null, queue: [], originalQueue: [] });
  vi.mocked(api.getPlaylist).mockResolvedValue({ ...playlist(), song_count: 3, songs, items: songs.map((song, position) => ({ item_type: "song", song, track: null, position })) });
  vi.mocked(api.listAllSongs).mockResolvedValue(songs);
});
afterEach(() => { cleanup(); queryClient.clear(); });
describe("library utilities", () => {
  it("selects and queues only visible playlist matches", async () => {
    render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={["/library/playlists/1"]}><Routes><Route path="/library/playlists/:playlistId" element={<PlaylistDetailPage />} /></Routes></MemoryRouter></QueryClientProvider>);
    await screen.findByText("Night drive");
    fireEvent.change(screen.getByRole("textbox", { name: "Search this playlist" }), { target: { value: "Night" } });
    fireEvent.click(screen.getByRole("button", { name: "Select visible" }));
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Queue$/ }));
    expect(usePlayerStore.getState().queue.map((track) => track.id)).toEqual(["local:1", "local:3"]);
    expect(screen.getAllByRole("button", { name: "Play all" })).toHaveLength(1);
  });
  it("recovers from an in-flight advanced filter when filters are cleared", async () => {
    vi.mocked(api.advancedSearchAllSongs).mockImplementation(() => new Promise(() => {}));
    render(<QueryClientProvider client={queryClient}><MemoryRouter><SongsLibraryPage /></MemoryRouter></QueryClientProvider>);
    await screen.findByText("Night drive");
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Minimum year" }), { target: { value: "2020" } });
    await waitFor(() => expect(api.advancedSearchAllSongs).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(await screen.findByText("Night drive")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play all" })).toBeEnabled();
  });
  it("queues a song selection without including unchecked tracks", async () => {
    render(<QueryClientProvider client={queryClient}><MemoryRouter><SongsLibraryPage /></MemoryRouter></QueryClientProvider>);
    await screen.findByText("Daylight");
    fireEvent.click(screen.getByRole("button", { name: "Select songs" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Daylight" }));
    fireEvent.click(screen.getByRole("button", { name: "Queue all" }));
    expect(usePlayerStore.getState().queue.map((track) => track.id)).toEqual(["local:2"]);
  });
});
