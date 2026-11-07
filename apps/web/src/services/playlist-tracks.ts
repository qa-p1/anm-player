import { addLibraryTracksToPlaylist, addOnlineTrackToPlaylist, addSongsToPlaylist } from "@/services/music-api";
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
      const item = track.rawItem;
      await addOnlineTrackToPlaylist(playlistId, {
        external_id: track.videoId, title: track.title, artist_name: track.artistName,
        artist_external_id: item.artists[0]?.id ?? null, album_title: track.albumTitle,
        duration_seconds: track.durationSeconds, source_url: item.url, artwork_url: item.thumbnail, explicit: item.explicit,
      });
    }
  }
}
