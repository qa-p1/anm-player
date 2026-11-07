import { beforeEach, describe, expect, it, vi } from "vitest";
import { addPlayerTracksToPlaylist } from "@/services/playlist-tracks";
import { playerTrack } from "@/test/music-fixtures";
import * as api from "@/services/music-api";
vi.mock("@/services/music-api", () => ({ addSongsToPlaylist: vi.fn(async () => ({})), addLibraryTracksToPlaylist: vi.fn(async () => ({})), addOnlineTrackToPlaylist: vi.fn(async () => ({})) }));
beforeEach(() => vi.clearAllMocks());
describe("save collection as playlist", () => {
  it("deduplicates repeats so a repeated local song cannot abort the remaining collection", async () => {
    await addPlayerTracksToPlaylist(4, [playerTrack(1), playerTrack(1), playerTrack(2)]);
    expect(api.addSongsToPlaylist).toHaveBeenCalledTimes(2);
    expect(api.addSongsToPlaylist).toHaveBeenNthCalledWith(1, 4, { song_ids: [1] });
    expect(api.addSongsToPlaylist).toHaveBeenNthCalledWith(2, 4, { song_ids: [2] });
  });
});
