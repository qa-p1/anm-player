import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { MiniPlayer } from "@/layouts/player/mini-player";
import { audioService } from "@/services/audio-service";
import { usePlayerStore } from "@/stores/player-store";
import { useUiStore } from "@/stores/ui-store";
import { playerTrack, song } from "@/test/music-fixtures";
import { onlineItemToPlayerTrack } from "@/types/player";

const server = vi.hoisted(() => ({ favorited: false }));
vi.mock("@/services/music-api", () => ({
  listFavorites: vi.fn(async () => ({ songs: server.favorited ? [{ ...song(), is_favorited: true }] : [], artists: [], albums: [], playlists: [], library_albums: [], library_tracks: [] })),
  toggleFavorite: vi.fn(async () => { server.favorited = !server.favorited; return { is_favorited: server.favorited }; }),
}));
vi.mock("@/services/audio-service", () => ({ audioService: { seek: vi.fn(), getDuration: () => 120 } }));
vi.mock("@/components/ui/toast", () => ({ toast: vi.fn() }));

const clients: QueryClient[] = [];
function Path() { return <output aria-label="Current path">{useLocation().pathname}</output>; }
function mount(onOpen = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client);
  const view = () => <QueryClientProvider client={client}><MemoryRouter><MiniPlayer onOpen={onOpen} /><Path /></MemoryRouter></QueryClientProvider>;
  return { ...render(view()), client, view, onOpen };
}

beforeEach(() => {
  server.favorited = false;
  vi.clearAllMocks();
  usePlayerStore.setState({ currentSong: playerTrack(), currentTime: 30, duration: 120, bufferedUntil: 60, isPlaying: false, playbackStatus: "paused", playbackError: null, retryAttempt: 0, volume: 0.8, isMuted: false, queue: [playerTrack(2)], originalQueue: [], queueHistory: [], repeat: "off" });
  useUiStore.setState({ isPlayerExpanded: false, requestedPlayerView: null });
});
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); });

it("opens the full player from the card without letting playback controls open it", () => {
  const { onOpen } = mount();
  fireEvent.click(screen.getByRole("button", { name: "Open full-screen player for Song 1" }));
  expect(onOpen).toHaveBeenCalledTimes(1);
  onOpen.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  expect(usePlayerStore.getState().isPlaying).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Pause" }));
  expect(usePlayerStore.getState().isPlaying).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Next track" }));
  expect(usePlayerStore.getState().currentSong?.id).toBe(playerTrack(2).id);
  fireEvent.click(screen.getByRole("button", { name: "Previous track" }));
  expect(usePlayerStore.getState().currentSong?.id).toBe(playerTrack().id);
  expect(onOpen).not.toHaveBeenCalled();
});

it("seeks the real audio without expanding the card", () => {
  const { onOpen } = mount();
  const seek = screen.getByRole("slider", { name: "Mini-player song progress" });
  expect(seek).toHaveAttribute("aria-valuetext", "0:30 of 2:00");
  fireEvent.change(seek, { target: { value: "80" } });
  expect(audioService.seek).toHaveBeenCalledWith(80);
  expect(usePlayerStore.getState().currentTime).toBe(80);
  expect(screen.queryByRole("slider", { name: "Mini-player volume" })).not.toBeInTheDocument();
  expect(screen.queryByText("Now playing")).not.toBeInTheDocument();
  expect(screen.queryByText("Paused")).not.toBeInTheDocument();
  expect(screen.queryByText("YouTube Music")).not.toBeInTheDocument();
  expect(onOpen).not.toHaveBeenCalled();
});

it("opens the selected lyrics or queue view directly, including an empty queue", () => {
  usePlayerStore.setState({ queue: [] });
  const { onOpen } = mount();
  fireEvent.click(screen.getByRole("button", { name: "Lyrics" }));
  expect(useUiStore.getState()).toMatchObject({ isPlayerExpanded: true, requestedPlayerView: "lyrics" });
  fireEvent.click(screen.getByRole("button", { name: "Open queue, 0 upcoming tracks" }));
  expect(useUiStore.getState()).toMatchObject({ isPlayerExpanded: true, requestedPlayerView: "queue" });
  expect(onOpen).not.toHaveBeenCalled();
});

it("keeps artist and album links independent of click-to-expand", () => {
  usePlayerStore.setState({ currentSong: { ...playerTrack(), artistHref: "/library/artists/42", albumHref: "/albums/test" } });
  const { onOpen } = mount();
  fireEvent.click(screen.getByRole("link", { name: "Test artist" }));
  expect(screen.getByLabelText("Current path")).toHaveTextContent("/library/artists/42");
  fireEvent.click(screen.getByRole("link", { name: "Test album" }));
  expect(screen.getByLabelText("Current path")).toHaveTextContent("/albums/test");
  expect(onOpen).not.toHaveBeenCalled();
});

it("saves a favorite and preserves its state when the mini-player reopens", async () => {
  const first = mount();
  fireEvent.click(await screen.findByRole("button", { name: "Add to favorites" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Remove from favorites" })).toHaveAttribute("aria-pressed", "true"));
  expect(first.onOpen).not.toHaveBeenCalled();
  first.unmount();
  render(first.view());
  expect(screen.getByRole("button", { name: "Remove from favorites" })).toHaveAttribute("aria-pressed", "true");
});

it("disables seeking while duration is unknown and lets streamed songs be liked", () => {
  usePlayerStore.setState({ duration: Infinity, currentTime: NaN, bufferedUntil: Infinity, currentSong: onlineItemToPlayerTrack({ source: "youtube", kind: "song", id: "video-id", title: "Online song", subtitle: null, artists: [], album: null, thumbnail: null, duration_seconds: null, explicit: false, playable: true, browse_id: null, playlist_id: null, endpoint: null, url: "https://music.youtube.com/watch?v=video-id" }) });
  mount();
  const seek = screen.getByRole("slider", { name: "Mini-player song progress" });
  expect(seek).toBeDisabled();
  expect(seek).toHaveValue("0");
  expect(seek).toHaveAttribute("aria-valuetext", "0:00 of 0:00");
  expect(screen.getByRole("button", { name: "Add to favorites" })).toBeInTheDocument();
});

it("offers playback retry without expanding the card after an error", () => {
  usePlayerStore.setState({ playbackStatus: "error", playbackError: "Connection lost" });
  const { onOpen } = mount();
  fireEvent.click(screen.getByRole("button", { name: "Retry playback" }));
  expect(usePlayerStore.getState()).toMatchObject({ playbackStatus: "loading", isPlaying: true });
  expect(onOpen).not.toHaveBeenCalled();
});

it("has accessible independent controls and no nested interactive elements", async () => {
  const { container } = mount();
  expect(container.querySelector("button button, button a, button input")).toBeNull();
  const results = await axe(container);
  expect(results.violations).toEqual([]);
});

it("renders no mini-player when there is no current song", () => {
  usePlayerStore.setState({ currentSong: null });
  mount();
  expect(screen.queryByRole("region", { name: "Mini-player" })).not.toBeInTheDocument();
});
