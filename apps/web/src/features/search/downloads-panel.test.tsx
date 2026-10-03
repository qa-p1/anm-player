import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DownloadsPanel } from "@/features/search/downloads-panel";
import type { DownloadJob } from "@/types/api";

function job(id: number, status: string): DownloadJob {
  return {
    id,
    status,
    progress: status === "completed" ? 100 : 0,
    stage: status,
    title: `Track ${id}`,
    artist: "Artist",
    album: null,
    thumbnail_url: null,
    source_url: `https://youtu.be/track-${id}`,
    video_id: null,
    search_query: null,
    speed: null,
    eta: null,
    error_message: status === "failed" ? "Network error" : null,
    completed_at: null,
    cancelled_at: null,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    group: null,
  };
}

function renderPanel(jobs: DownloadJob[]) {
  const handlers = { onRetryFailed: vi.fn(), onRemoveCompleted: vi.fn() };
  render(
    <MemoryRouter>
      <DownloadsPanel
        jobs={jobs}
        onJobUpdate={vi.fn()}
        onCancel={vi.fn()}
        onRetry={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onCancelAlbum={vi.fn()}
        {...handlers}
      />
    </MemoryRouter>,
  );
  return handlers;
}

describe("DownloadsPanel bulk actions", () => {
  afterEach(cleanup);

  it("offers to retry every failed download, not cancelled ones", () => {
    const handlers = renderPanel([job(1, "failed"), job(2, "failed"), job(3, "cancelled"), job(4, "completed")]);

    fireEvent.click(screen.getByRole("button", { name: "Retry 2 failed" }));

    expect(handlers.onRetryFailed).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Clear completed" })).toBeInTheDocument();
  });

  it("hides the retry action when nothing has failed", () => {
    renderPanel([job(3, "cancelled"), job(4, "completed")]);
    expect(screen.queryByRole("button", { name: /Retry .* failed/ })).not.toBeInTheDocument();
  });
});
