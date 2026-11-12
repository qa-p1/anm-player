import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "@/features/commands/command-palette";
import { matchScore } from "@/features/commands/quick-find-ranking";
import { useUiStore } from "@/stores/ui-store";
import { usePlayerStore } from "@/stores/player-store";
import { playlist, song } from "@/test/music-fixtures";
import type { OnlineMusicItem } from "@/types/api";

const onlineSong: OnlineMusicItem = { source: "youtube", kind: "song", id: "abc123", title: "Moonlight Sonata", subtitle: "Online artist", artists: [{ id: null, name: "Online artist" }], album: null, thumbnail: null, duration_seconds: 200, explicit: false, playable: true, browse_id: null, playlist_id: null, endpoint: null, url: "https://music.youtube.com/watch?v=abc123" };

vi.mock("@/services/music-api", () => ({
  listAllPlaylists: vi.fn(async () => [playlist(1, "Night drive")]),
  getRecentlyPlayedHistory: vi.fn(async () => []),
  searchLibrary: vi.fn(async (query: string) => ({ query, results: [] })),
  searchSongs: vi.fn(async (query: string) => (query.toLowerCase().includes("moon") ? [song(1, "Moonlight")] : [])),
  searchYouTubeMusic: vi.fn(async (query: string) => ({ query, filter: "songs", items: [onlineSong], continuation: null })),
}));
vi.mock("@/services/audio-service", () => ({ audioService: {} }));

const clients: QueryClient[] = [];
function Location() { return <output data-testid="location">{useLocation().pathname}</output>; }
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  return render(<QueryClientProvider client={client}><MemoryRouter><CommandPalette /><Location /></MemoryRouter></QueryClientProvider>);
}
const input = () => screen.getByRole("textbox", { name: "Find music or a command" });

beforeEach(() => { useUiStore.setState({ isCommandPaletteOpen: true, isPlayerExpanded: false }); usePlayerStore.setState({ currentSong: null, isPlaying: false, queue: [] }); });
afterEach(() => { cleanup(); clients.forEach((client) => client.clear()); });

describe("quick find", () => {
  it("lists pages before anything is typed", async () => {
    setup();
    expect(input()).toHaveFocus();
    expect(screen.getByRole("group", { name: "Go to" })).toHaveTextContent("Settings");
  });

  it("puts the best match first and opens it with Enter", async () => {
    setup();
    fireEvent.change(input(), { target: { value: "night" } });
    const top = await screen.findByRole("group", { name: "Top result" });
    expect(top).toHaveTextContent("Night drive");
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(screen.getByTestId("location")).toHaveTextContent("/library/playlists/1");
    expect(useUiStore.getState().isCommandPaletteOpen).toBe(false);
  });

  it("plays a library song", async () => {
    setup();
    fireEvent.change(input(), { target: { value: "moonlight" } });
    fireEvent.click(await screen.findByRole("button", { name: /^Moonlight · Test artist/ }));
    expect(usePlayerStore.getState()).toMatchObject({ isPlaying: true, currentSong: { title: "Moonlight" } });
  });

  it("queues the selected song with Shift+Enter", async () => {
    setup();
    fireEvent.change(input(), { target: { value: "moonlight" } });
    await screen.findByRole("button", { name: /^Moonlight · Test artist/ });
    fireEvent.keyDown(input(), { key: "Enter", shiftKey: true });
    expect(usePlayerStore.getState().currentSong).toBeNull();
    expect(usePlayerStore.getState().queue.map((track) => track.title)).toEqual(["Moonlight"]);
  });

  it("shows YouTube Music songs and a full search shortcut", async () => {
    setup();
    fireEvent.change(input(), { target: { value: "sonata" } });
    fireEvent.click(await screen.findByRole("button", { name: /^Moonlight Sonata · Online artist/ }, { timeout: 2000 }));
    expect(usePlayerStore.getState().currentSong).toMatchObject({ source: "youtube", videoId: "abc123" });
  });

  it("opens the full search page for the typed text", async () => {
    setup();
    fireEvent.change(input(), { target: { value: "zzz" } });
    fireEvent.click(screen.getByRole("button", { name: /Search for “zzz”/ }));
    expect(screen.getByTestId("location")).toHaveTextContent("/search");
  });

  it("does not run anything while text composition is active", () => {
    setup();
    fireEvent.change(input(), { target: { value: "set" } });
    fireEvent.keyDown(input(), { key: "Enter", isComposing: true });
    expect(useUiStore.getState().isCommandPaletteOpen).toBe(true);
  });
});

describe("quick find ranking", () => {
  it("prefers exact, then prefix, then word-start, then substring matches", () => {
    const scores = ["Night", "Nightcall", "Late Night", "Midnighters"].map((name) => matchScore("night", name));
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(new Set(scores).size).toBe(4);
  });

  it("ignores accents and lets words span the name and artist", () => {
    expect(matchScore("beyonce", "Beyoncé")).toBe(100);
    expect(matchScore("halo beyonce", "Halo", "Beyoncé")).toBeGreaterThan(0);
    expect(matchScore("xyz", "Halo", "Beyoncé")).toBe(0);
  });
});
