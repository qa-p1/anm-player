import { toast } from "@/components/ui/toast";
import { itemToPlayerTrack, playlistItems } from "@/features/playlists/playlist-model";
import { queryClient } from "@/lib/query-client";
import { getArtist, getPlaylist, getUnifiedAlbum } from "@/services/music-api";
import { musicKeys } from "@/services/music-keys";
import { usePlaybackSourceStore } from "@/stores/playback-source-store";
import { usePlayerStore } from "@/stores/player-store";
import type { LibraryTrack, OnlineMusicItem, UnifiedAlbum, UnifiedAlbumTrack } from "@/types/api";
import type { PlayerTrack } from "@/types/player";
import { libraryTrackToPlayerTrack, onlineItemToPlayerTrack, songToPlayerTrack } from "@/types/player";
import { shuffleTracks } from "@/utils/track-collection";

export function unifiedTrackToPlayerTrack(track: UnifiedAlbumTrack, album: UnifiedAlbum): PlayerTrack | null {
  if (!track.is_available) return null;
  if (track.playback_source === "downloaded" && track.library_track_id) {
    const raw: LibraryTrack = {
      id: track.library_track_id,
      song_id: track.song_id,
      artist_id: track.artist_id,
      source: album.source,
      external_id: track.provider_track_id || track.id,
      title: track.title,
      artist_name: track.artist_name,
      artist_external_id: album.artist.id,
      album_id: album.internal.library_album_id,
      album_public_id: album.id,
      album_title: album.title,
      duration_seconds: track.duration_seconds,
      track_number: track.track_number,
      disc_number: track.disc_number,
      position: 0,
      source_url: null,
      artwork_url: album.artwork_url,
      artwork_path: album.artwork_url,
      explicit: track.explicit,
      is_downloaded: true,
      is_favorited: false,
      is_in_library: album.state.in_library,
      created_at: "",
      updated_at: "",
    };
    return libraryTrackToPlayerTrack(raw);
  }
  if (!track.provider_track_id) return null;
  const item: OnlineMusicItem = {
    source: "youtube", kind: "song", id: track.provider_track_id, title: track.title,
    subtitle: track.artist_name, artists: track.artist_name ? [{ id: album.artist.id, name: track.artist_name }] : [],
    album: { id: album.id, name: album.title }, thumbnail: album.artwork_url,
    duration_seconds: track.duration_seconds, explicit: track.explicit, playable: true,
    browse_id: null, playlist_id: null, endpoint: null,
    url: `https://music.youtube.com/watch?v=${track.provider_track_id}`,
  };
  return onlineItemToPlayerTrack(item);
}

export function unifiedAlbumPlayerTracks(album: UnifiedAlbum): PlayerTrack[] {
  return album.tracks.map((track) => unifiedTrackToPlayerTrack(track, album)).filter((track): track is PlayerTrack => Boolean(track));
}

function startPlayback(tracks: PlayerTrack[], shuffle: boolean, emptyMessage: string, source?: { kind: "playlist" | "album" | "artist"; id: string | number }) {
  if (tracks.length === 0) {
    toast(emptyMessage, "error");
    return false;
  }
  if (source) usePlaybackSourceStore.getState().setSource(source.kind, source.id, tracks.map((track) => track.id));
  usePlayerStore.getState().playAlbum(shuffle ? shuffleTracks(tracks) : tracks, 0);
  return true;
}

/** Plays an album straight from a tile, reusing the album page cache. */
export async function playAlbumById(publicId: string, { shuffle = false } = {}) {
  try {
    const album = await queryClient.fetchQuery({ queryKey: musicKeys.unifiedAlbum(publicId), queryFn: ({ signal }) => getUnifiedAlbum(publicId, signal), staleTime: 30_000 });
    return startPlayback(unifiedAlbumPlayerTracks(album), shuffle, "This album has no playable tracks yet", { kind: "album", id: publicId });
  } catch (error) {
    toast(error instanceof Error ? error.message : "Could not play this album", "error");
    return false;
  }
}

/** Plays a playlist straight from a tile, reusing the playlist page cache. */
export async function playPlaylistById(playlistId: number, { shuffle = false } = {}) {
  try {
    const playlist = await queryClient.fetchQuery({ queryKey: musicKeys.playlist(playlistId), queryFn: ({ signal }) => getPlaylist(playlistId, signal), staleTime: 30_000 });
    const tracks = playlistItems(playlist).map(itemToPlayerTrack).filter((track): track is PlayerTrack => Boolean(track));
    return startPlayback(tracks, shuffle, "This playlist is empty", { kind: "playlist", id: playlistId });
  } catch (error) {
    toast(error instanceof Error ? error.message : "Could not play this playlist", "error");
    return false;
  }
}

/** Plays a library artist's top songs straight from a tile. */
export async function playArtistById(artistId: number, { shuffle = false } = {}) {
  try {
    const artist = await queryClient.fetchQuery({ queryKey: musicKeys.artist(artistId), queryFn: ({ signal }) => getArtist(artistId, signal), staleTime: 30_000 });
    return startPlayback(artist.top_songs.map(songToPlayerTrack), shuffle, "No playable songs by this artist yet", { kind: "artist", id: artistId });
  } catch (error) {
    toast(error instanceof Error ? error.message : "Could not play this artist", "error");
    return false;
  }
}

/** Sums known track lengths; unknown durations count as zero. */
export function totalDuration(tracks: readonly PlayerTrack[]) {
  return tracks.reduce((total, track) => total + Math.max(0, track.durationSeconds ?? 0), 0);
}

/** Public album id of the current song, used to highlight the playing tile. */
export function playingAlbumKey(track: PlayerTrack | null): string | null {
  if (!track) return null;
  if (track.source === "local") return (track.localKind === "song" ? track.rawSong.album_public_id : track.rawLibraryTrack.album_public_id) ?? null;
  return track.rawItem.album?.id ?? null;
}
