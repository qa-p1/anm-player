import { expect, it } from "vitest";

import type { DownloadJob } from "@/types/api";
import { currentBatch, summarizeDownloads } from "@/utils/downloads";

const job = (id: number, status: string, progress: number, created_at: string) => ({ id, status, progress, created_at }) as DownloadJob;

it("never lets overall progress move backwards as songs finish", () => {
  const start = [job(1, "downloading", 50, "b"), job(2, "queued", 0, "b"), job(3, "queued", 0, "b")];
  const later = [job(1, "completed", 100, "b"), job(2, "downloading", 10, "b"), job(3, "queued", 0, "b"), job(0, "completed", 100, "a")];
  const before = summarizeDownloads(currentBatch(start)).progress;
  const after = summarizeDownloads(currentBatch(later)).progress;
  expect(before).toBe(17);
  expect(after).toBe(37);
  expect(currentBatch([job(0, "completed", 100, "a")])).toEqual([]);
});
