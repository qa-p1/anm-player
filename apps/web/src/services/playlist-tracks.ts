import { addLibraryTracksToPlaylist, addOnlineTrackToPlaylist, addSongsToPlaylist } from "@/services/music-api";
import type { PlaylistAddOnlineTrackRequest } from "@/types/api";
import type { PlayerTrack } from "@/types/player";

export async function addPlayerTracksToPlaylist(playlistId: number, tracks: readonly PlayerTrack[]): Promise<void> {
  // Sequential inserts preserve mixed local/online order and the API's position allocation.
  const seen = new Set<string>();
  for (const track of tracks) {
    const key = track.source === "youtube" ? `youtube:${track.videoId}` : `${track.localKind}:${track.localKind === "song" ? track.songId : track.libraryTrackId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (track.source === "local") {
      if (track.localKind === "song") await addSongsToPlaylist(playlistId, { song_ids: [track.songId] });
      else await addLibraryTracksToPlaylist(playlistId, [track.libraryTrackId]);
    } else {
      await addOnlineTrackToPlaylist(playlistId, onlineTrackRequest(track));
    }
  }
}

/** What the server needs to keep a streamed song in the library. */
export function onlineTrackRequest(track: Extract<PlayerTrack, { source: "youtube" }>): PlaylistAddOnlineTrackRequest {
  const item = track.rawItem;
  return {
    external_id: track.videoId, title: track.title, artist_name: track.artistName,
    artist_external_id: item.artists[0]?.id ?? null, album_title: track.albumTitle,
    duration_seconds: track.durationSeconds, source_url: item.url, artwork_url: item.thumbnail, explicit: item.explicit,
  };
}
