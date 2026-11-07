import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { axe } from "jest-axe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "@/components/navigation/sidebar";
import { BottomNav } from "@/components/navigation/bottom-nav";
import { playlist } from "@/test/music-fixtures";
import { useLibraryPreferencesStore } from "@/stores/library-preferences-store";
import * as api from "@/services/music-api";
vi.mock("@/services/music-api", () => ({ listAllPlaylists: vi.fn(), createPlaylist: vi.fn() }));
vi.mock("@/components/download-queue", () => ({ DownloadQueueTrigger: () => <button>Downloads</button> }));
vi.mock("@/components/navigation/close-app-button", () => ({ CloseAppButton: () => <button>Close app</button> }));
const clients: QueryClient[] = [];
function setup(path = "/library/playlists/2") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Sidebar /><BottomNav /></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => { vi.mocked(api.listAllPlaylists).mockResolvedValue([playlist(1, "Night drive"), playlist(2, "Morning mix")]); useLibraryPreferencesStore.setState({ pinnedPlaylistIds: [] }); });
afterEach(() => { cleanup(); clients.forEach((client) => client.clear()); });
describe("library navigation", () => {
  it("opens playlists directly, highlights library descendants and pins a playlist", async () => {
    setup();
    const playlists = screen.getByRole("region", { name: "Your playlists" });
    expect(await within(playlists).findByRole("link", { name: /Morning mix/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getAllByRole("link", { name: "Library" }).every((link) => link.getAttribute("aria-current") === "page")).toBe(true);
    fireEvent.click(within(playlists).getByRole("button", { name: "Pin Morning mix" }));
    expect(useLibraryPreferencesStore.getState().pinnedPlaylistIds).toEqual([2]);
    expect(within(playlists).getByRole("button", { name: "Unpin Morning mix" })).toHaveAttribute("aria-pressed", "true");
  });
  it("shows a recoverable playlist error instead of an empty library", async () => {
    vi.mocked(api.listAllPlaylists).mockRejectedValueOnce(new Error("Offline")).mockResolvedValue([playlist()]);
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Could not load. Retry" }));
    expect(await screen.findByRole("link", { name: /Playlist 1/ })).toBeInTheDocument();
  });
  it("exposes labelled navigation and a keyboard accessible create dialog", async () => {
    const { container } = setup();
    await waitFor(() => expect(screen.getByRole("button", { name: "Pin Night drive" })).toBeInTheDocument());
    expect((await axe(container)).violations).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Create playlist" }));
    expect(screen.getByRole("dialog", { name: "Create playlist" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Playlist name" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Create playlist" })).toBeDisabled();
  });
});
