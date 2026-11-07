import { beforeEach, expect, it, vi } from "vitest";
import { getLibraryTrackStatuses } from "@/services/music-api";
import { apiPost } from "@/services/api-client";
vi.mock("@/services/api-client", () => ({ apiGet: vi.fn(), apiDelete: vi.fn(), apiPut: vi.fn(), apiPatch: vi.fn(), apiPost: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
it("batches and deduplicates download status lookups after many search pages", async () => {
  vi.mocked(apiPost).mockImplementation(async (_path, body) => ({ statuses: (body as { external_ids: string[] }).external_ids.map((external_id) => ({ external_id, is_downloaded: false })) }));
  const ids = Array.from({ length: 205 }, (_, index) => String(index));
  const result = await getLibraryTrackStatuses([...ids, "0"]);
  expect(apiPost).toHaveBeenCalledTimes(2);
  expect((vi.mocked(apiPost).mock.calls[0][1] as { external_ids: string[] }).external_ids).toHaveLength(200);
  expect(result.statuses.map((status) => status.external_id)).toEqual(ids);
});
it("avoids status requests for empty collections and cancelled operations", async () => {
  expect(await getLibraryTrackStatuses([])).toEqual({ statuses: [] });
  const controller = new AbortController(); controller.abort();
  await expect(getLibraryTrackStatuses(["1"], controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(apiPost).not.toHaveBeenCalled();
});
