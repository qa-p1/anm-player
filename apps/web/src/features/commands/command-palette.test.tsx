import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "@/features/commands/command-palette";
import { useUiStore } from "@/stores/ui-store";
import { usePlayerStore } from "@/stores/player-store";
import { playlist, song } from "@/test/music-fixtures";
vi.mock("@/services/music-api", () => ({ listAllPlaylists: vi.fn(async () => [playlist(1, "Night drive")]), listAllSongs: vi.fn(async () => [song(1, "Moonlight")]) }));
vi.mock("@/services/audio-service", () => ({ audioService: {} }));
const clients: QueryClient[] = [];
function Location() { return <output data-testid="location">{useLocation().pathname}</output>; }
function setup() {
  const client = new QueryClient(); clients.push(client);
  return render(<QueryClientProvider client={client}><MemoryRouter><CommandPalette /><Location /></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => { useUiStore.setState({ isCommandPaletteOpen: true, isPlayerExpanded: false }); usePlayerStore.setState({ currentSong: null, isPlaying: false }); });
afterEach(() => { cleanup(); clients.forEach((client) => client.clear()); });
describe("quick find", () => {
  it("finds a playlist and navigates from the keyboard", async () => {
    setup();
    await screen.findByText("Night drive");
    const input = screen.getByRole("textbox", { name: "Find music or a command" });
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "night" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByTestId("location")).toHaveTextContent("/library/playlists/1");
    expect(useUiStore.getState().isCommandPaletteOpen).toBe(false);
  });
  it("plays a matching library song and closes the palette", async () => {
    setup();
    await screen.findByText("Night drive");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "moonlight" } });
    fireEvent.click(screen.getByRole("button", { name: /Moonlight.*Test artist/ }));
    expect(usePlayerStore.getState()).toMatchObject({ isPlaying: true, currentSong: { title: "Moonlight" } });
  });
  it("preserves native Enter activation on result and Close buttons", async () => {
    setup();
    const result = await screen.findByRole("button", { name: /Night drive/ });
    fireEvent.keyDown(result, { key: "Enter" });
    expect(useUiStore.getState().isCommandPaletteOpen).toBe(true);
    fireEvent.keyDown(screen.getByRole("button", { name: "Close" }), { key: "Enter" });
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/);
    fireEvent.click(result);
    expect(screen.getByTestId("location")).toHaveTextContent("/library/playlists/1");
  });
  it("does not execute a command while text composition is active", async () => {
    setup();
    await screen.findByText("Night drive");
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", isComposing: true });
    expect(useUiStore.getState().isCommandPaletteOpen).toBe(true);
  });
});
