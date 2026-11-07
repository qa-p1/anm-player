import type { PlayerTrack } from "@/types/player";

export function matchesTrack(track: PlayerTrack, query: string): boolean {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const text = [track.title, track.artistName, track.albumTitle].filter(Boolean).join(" ").toLocaleLowerCase();
  return words.every((word) => text.includes(word));
}

export function shuffleTracks<T>(tracks: readonly T[]): T[] {
  const shuffled = [...tracks];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

export function trackShareUrl(track: PlayerTrack): string {
  if (track.source === "youtube") return track.rawItem.url || `https://music.youtube.com/watch?v=${track.videoId}`;
  return (track.localKind === "song" ? track.rawSong.source_url : track.rawLibraryTrack.source_url) || trackExportUrl(track);
}

function trackExportUrl(track: PlayerTrack): string {
  if (track.source === "youtube") return new URL(`/api/v1/ytmusic/stream/${encodeURIComponent(track.videoId)}`, window.location.href).toString();
  const path = track.localKind === "song" ? `songs/${track.songId}` : `library-tracks/${track.libraryTrackId}`;
  return new URL(`/api/v1/media/${path}/stream`, window.location.href).toString();
}

function tracksToM3u(tracks: readonly PlayerTrack[]): string {
  const line = (value: string) => value.replace(/[\r\n]+/g, " ");
  return ["#EXTM3U", ...tracks.flatMap((track) => [
    `#EXTINF:${Number.isFinite(track.durationSeconds) ? Math.round(track.durationSeconds!) : -1},${line([track.artistName, track.title].filter(Boolean).join(" - "))}`,
    line(trackExportUrl(track)),
  ]), ""].join("\n");
}

export function exportTracks(tracks: readonly PlayerTrack[], name: string): void {
  const blob = new Blob([tracksToM3u(tracks)], { type: "audio/x-mpegurl;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${Array.from(name.trim(), (character) => character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character) ? "-" : character).join("").replace(/\s+/g, " ").slice(0, 100) || "anm-queue"}.m3u8`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
