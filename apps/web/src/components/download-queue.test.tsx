import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DownloadQueueTrigger } from "@/components/download-queue";
import type { DownloadJob } from "@/types/api";

const mocks = vi.hoisted(() => ({ jobs: [] as DownloadJob[], setOpen: vi.fn() }));
vi.mock("@/hooks/use-music-queries", () => ({
  useDownloads: () => ({ data: mocks.jobs }),
  musicKeys: {},
}));
vi.mock("@/components/download-queue-state", () => ({
  useDownloadQueueUi: (select: (state: { setOpen: typeof mocks.setOpen }) => unknown) => select({ setOpen: mocks.setOpen }),
}));

function job(id: number, status: string): DownloadJob {
  return {
    id, status, stage: status, progress: status === "completed" ? 100 : 0,
    title: `Track ${id}`, artist: null, album: null, thumbnail_url: null,
    source_url: "https://youtu.be/video", video_id: null, search_query: null,
    speed: null, eta: null, error_message: null, group: null,
    created_at: "2020-01-01T00:00:00Z", updated_at: "2020-01-01T00:00:00Z",
    completed_at: status === "completed" ? "2020-01-01T00:00:00Z" : null,
    cancelled_at: null,
  };
}

describe("download queue visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.jobs = [];
  });
  afterEach(cleanup);

  it("keeps old completed and failed downloads accessible until cleared", () => {
    mocks.jobs = [job(1, "completed"), job(2, "failed")];
    render(<DownloadQueueTrigger />);
    expect(screen.getByText("1 completed · 1 failed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Downloads/ }));
    expect(mocks.setOpen).toHaveBeenCalledWith(true);
  });

  it("continues to count active downloads separately from finished ones", () => {
    mocks.jobs = [job(1, "completed"), job(2, "downloading")];
    render(<DownloadQueueTrigger />);
    expect(screen.getByText("1 in progress")).toBeInTheDocument();
  });
});
