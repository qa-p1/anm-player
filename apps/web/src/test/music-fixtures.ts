import type { Playlist, Song } from "@/types/api";
import { songToPlayerTrack } from "@/types/player";

export function song(id = 1, title = `Song ${id}`): Song {
  return { id, title, artist_id: null, artist_name: "Test artist", album_id: null, album_public_id: null, album_title: "Test album", duration_seconds: 120,
    track_number: null, disc_number: null, artwork_path: null, artwork_url: null, source_url: null, is_downloaded: true, is_favorited: false, created_at: "2026-01-01", updated_at: "2026-01-01" };
}
export const playerTrack = (id = 1) => songToPlayerTrack(song(id));
export function playlist(id = 1, name = `Playlist ${id}`): Playlist {
  return { id, name, description: null, artwork_path: null, song_count: 2, duration_seconds: 240, created_at: "2026-01-01", updated_at: "2026-01-01" };
}
