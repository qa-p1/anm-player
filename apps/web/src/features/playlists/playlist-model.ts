import type { PlaylistDetail, PlaylistItemReference } from "@/types/api";
import type { PlayerTrack } from "@/types/player";
import { libraryTrackToPlayerTrack, songToPlayerTrack } from "@/types/player";

export type PlaylistItem = NonNullable<PlaylistDetail["items"]>[number];

export function playlistItems(playlist: PlaylistDetail | null): PlaylistItem[] {
  if (!playlist) return [];
  if (playlist.items) return [...playlist.items].sort((left, right) => left.position - right.position);
  return [
    ...playlist.songs.map((song, position) => ({ item_type: "song" as const, position, song, track: null })),
    ...(playlist.library_tracks ?? []).map((entry) => ({ item_type: "library_track" as const, position: entry.position, song: null, track: entry.track })),
  ].sort((left, right) => left.position - right.position);
}

export function withOrderedItems(playlist: PlaylistDetail, items: PlaylistItem[]): PlaylistDetail {
  return { ...playlist, items: items.map((item, position) => ({ ...item, position })) };
}

export function itemToPlayerTrack(item: PlaylistItem): PlayerTrack | null {
  return item.song ? songToPlayerTrack(item.song) : item.track ? libraryTrackToPlayerTrack(item.track) : null;
}

export function itemKey(item: PlaylistItem) {
  return item.item_type === "song" && item.song ? `song:${item.song.id}` : item.track ? `library_track:${item.track.id}` : `missing:${item.position}`;
}

export function itemReference(item: PlaylistItem): PlaylistItemReference {
  if (item.item_type === "song" && item.song) return { item_type: "song", item_id: item.song.id };
  if (item.track) return { item_type: "library_track", item_id: item.track.id };
  throw new Error("Playlist item is missing its track");
}

export function itemTitle(item: PlaylistItem) {
  return item.song?.title || item.track?.title || "playlist track";
}
