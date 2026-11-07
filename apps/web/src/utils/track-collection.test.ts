import { afterEach, describe, expect, it, vi } from "vitest";
import { matchesTrack, shuffleTracks, exportTracks } from "@/utils/track-collection";
import { playerTrack } from "@/test/music-fixtures";
import { formatListeningTime } from "@/utils/format";
afterEach(() => vi.restoreAllMocks());
describe("collection utilities", () => {
  it("finds words across title, artist and album without changing the collection", () => {
    expect(matchesTrack(playerTrack(), "  SONG   artist album ")).toBe(true);
    expect(matchesTrack(playerTrack(), "unrelated")).toBe(false);
  });
  it("shuffles a copy while retaining every track occurrence", () => {
    const tracks = [playerTrack(1), playerTrack(1), playerTrack(2)];
    const original = [...tracks];
    const result = shuffleTracks(tracks);
    expect(tracks).toEqual(original);
    expect(result).not.toBe(tracks);
    expect(result.map((track) => track.id).sort()).toEqual(original.map((track) => track.id).sort());
  });
  it("exports local streams with safe single-line metadata and a sanitized filename", async () => {
    let exported: Blob | undefined;
    vi.stubGlobal("URL", class extends URL { static createObjectURL(blob: Blob) { exported = blob; return "blob:test"; } static revokeObjectURL() {} });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { expect(this.download).toBe("My-queue.m3u8"); });
    exportTracks([{ ...playerTrack(), title: "Song\n#INJECT", artistName: "Artist\rName" }], "My/queue");
    expect(click).toHaveBeenCalledOnce();
    const content = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(exported!); });
    expect(content).toContain("#EXTINF:120,Artist Name - Song #INJECT\n");
    expect(content).toContain("/api/v1/media/songs/1/stream\n");
    vi.unstubAllGlobals();
  });
  it("rounds long durations across the hour boundary", () => {
    expect(formatListeningTime(3599)).toBe("1h");
    expect(formatListeningTime(3601)).toBe("1h 1m");
    expect(formatListeningTime(Number.NaN)).toBe("unknown length");
  });
});
