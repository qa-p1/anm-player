import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";

import { DownloadsPage } from "@/features/downloads/downloads-page";
import * as api from "@/services/music-api";
import type { DownloadJob } from "@/types/api";

vi.mock("@/services/music-api", () => ({
  listAllDownloads: vi.fn(), listAllPlaylists: vi.fn(async () => [{ id: 4, name: "Road trip" }]),
  pauseAllDownloads: vi.fn(async () => []), resumeAllDownloads: vi.fn(async () => []), cancelAllDownloads: vi.fn(async () => []),
  clearFinishedDownloads: vi.fn(async () => ({ removed: 1 })), pauseDownload: vi.fn(async () => ({})), resumeDownload: vi.fn(async () => ({})),
  cancelDownload: vi.fn(async () => ({})), retryDownload: vi.fn(async () => ({})), retryFailedDownloads: vi.fn(async () => []), cancelUnifiedAlbumDownload: vi.fn(async () => ({})),
}));
vi.mock("@/components/ui/toast", () => ({ toast: vi.fn() }));

function job(id: number, status: string, extra: Partial<DownloadJob> = {}): DownloadJob {
  return { id, status, progress: status === "downloading" ? 40 : 0, stage: status, title: `Song ${id}`, artist: "Artist", album: null, thumbnail_url: null, source_url: null, video_id: null, search_query: null, speed: null, eta: null, error_message: null, completed_at: null, cancelled_at: null, created_at: "", updated_at: "", group: null, ...extra };
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function mount(jobs: DownloadJob[]) {
  vi.mocked(api.listAllDownloads).mockResolvedValue(jobs);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><DownloadsPage /></MemoryRouter></QueryClientProvider>);
}

it("groups a playlist download under its name with overall progress and per-song control", async () => {
  const playlist = { type: "playlist" as const, album_id: "4", title: "Playlist", canonical_url: "/library/playlists/4" };
  mount([job(1, "downloading", { group: playlist }), job(2, "queued", { group: playlist }), job(3, "downloading"), job(4, "completed")]);
  const group = await screen.findByRole("region", { name: "Road trip" });
  expect(within(group).getByText(/1 downloading · 1 waiting/)).toBeInTheDocument();
  expect(screen.getByText("Downloading 2")).toBeInTheDocument();
  expect(screen.getByText("45%")).toBeInTheDocument();
  fireEvent.click(within(group).getByRole("button", { name: "Pause Song 2" }));
  await waitFor(() => expect(api.pauseDownload).toHaveBeenCalledWith(2));
  fireEvent.click(screen.getByRole("button", { name: "Pause all" }));
  await waitFor(() => expect(api.pauseAllDownloads).toHaveBeenCalled());
});

it("lists failed downloads with retry and clears them", async () => {
  mount([job(5, "failed", { error_message: "Video unavailable" }), job(6, "cancelled")]);
  fireEvent.click(await screen.findByRole("tab", { name: /Failed/ }));
  expect(screen.getByText("Video unavailable")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry Song 5" }));
  await waitFor(() => expect(api.retryDownload).toHaveBeenCalledWith(5));
  fireEvent.click(screen.getByRole("button", { name: "Clear list" }));
  await waitFor(() => expect(api.clearFinishedDownloads).toHaveBeenCalledWith(["failed", "cancelled"]));
});

it("shows an empty queue with a way to find music", async () => {
  mount([]);
  expect(await screen.findByText("Nothing downloading")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Find music/ })).toHaveAttribute("href", "/search");
});
