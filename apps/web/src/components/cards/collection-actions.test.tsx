import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CollectionActions } from "@/components/cards/collection-actions";
import { usePlayerStore } from "@/stores/player-store";
import { playerTrack } from "@/test/music-fixtures";
vi.mock("@/components/ui/toast", () => ({ toast: vi.fn() }));
afterEach(cleanup);
beforeEach(() => usePlayerStore.setState({ currentSong: null, isPlaying: false, queue: [], originalQueue: [], shuffle: false }));
describe("collection actions", () => {
  it("queues and plays precisely the supplied selection", () => {
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><CollectionActions tracks={[playerTrack(2), playerTrack(3)]} name="Selection" /></MemoryRouter></QueryClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Queue all" }));
    expect(usePlayerStore.getState().queue.map((track) => track.id)).toEqual(["local:2", "local:3"]);
    fireEvent.click(screen.getByRole("button", { name: "Play all" }));
    expect(usePlayerStore.getState()).toMatchObject({ isPlaying: true, currentSong: { id: "local:2" }, queue: [{ id: "local:3" }] });
  });
  it("disables all collection operations when there are no playable tracks", () => {
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><CollectionActions tracks={[]} name="Empty" /></MemoryRouter></QueryClientProvider>);
    expect(screen.getAllByRole("button").every((button) => button.hasAttribute("disabled"))).toBe(true);
  });
});
