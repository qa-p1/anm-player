import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";

import { PlaylistDownloadButton } from "@/features/downloads/playlist-download-button";
import * as api from "@/services/music-api";
import type { DownloadJob } from "@/types/api";

vi.mock("@/services/music-api", () => ({ listAllDownloads: vi.fn(), downloadPlaylist: vi.fn() }));
const toast = vi.hoisted(() => vi.fn());
vi.mock("@/components/ui/toast", () => ({ toast }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function mount(props: { total: number; offline: number }, jobs: Partial<DownloadJob>[] = []) {
  vi.mocked(api.listAllDownloads).mockResolvedValue(jobs as DownloadJob[]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><PlaylistDownloadButton playlistId={4} name="Road trip" {...props} /></MemoryRouter></QueryClientProvider>);
}

it("downloads the missing songs and reports what was queued", async () => {
  vi.mocked(api.downloadPlaylist).mockResolvedValue({ queued: [{ id: 1 } as DownloadJob, { id: 2 } as DownloadJob], already_queued: 0, already_offline: 1, unavailable: 1 });
  mount({ total: 4, offline: 1 });
  fireEvent.click(screen.getByRole("button", { name: "Download the other 3 songs" }));
  await waitFor(() => expect(api.downloadPlaylist).toHaveBeenCalledWith(4));
  await waitFor(() => expect(toast).toHaveBeenCalledWith("Downloading 2 songs · 1 song can't be downloaded", "success"));
});

it("shows live progress while the playlist downloads", async () => {
  const group = { type: "playlist", album_id: "4", title: "Playlist", canonical_url: "/library/playlists/4" };
  mount({ total: 2, offline: 0 }, [{ id: 1, status: "downloading", progress: 50, group, created_at: "2026-01-01T10:00:00" } as DownloadJob, { id: 2, status: "completed", progress: 100, group, created_at: "2026-01-01T10:00:00" } as DownloadJob, { id: 3, status: "queued", progress: 0, group, created_at: "2026-01-01T10:00:00" } as DownloadJob, { id: 9, status: "completed", progress: 100, group, created_at: "2025-12-01T10:00:00" } as DownloadJob]);
  // The finished song of this run counts (150/3); the old run from December doesn't.
  expect(await screen.findByRole("button", { name: "Downloading Road trip, 50%. Open downloads" })).toBeInTheDocument();
});

it("shows a check once every song is offline", () => {
  mount({ total: 3, offline: 3 });
  expect(screen.getByRole("button", { name: "Every song is downloaded" })).toBeDisabled();
});
