import type { PlayerTrack } from "@/types/player";

/** Where a song's artist and album pages live, when the song knows them. */
export function trackArtistHref(track: PlayerTrack): string | null {
  if (track.artistHref) return track.artistHref;
  if (track.source === "local") {
    if (track.localKind === "song") return track.rawSong.artist_id ? `/library/artists/${track.rawSong.artist_id}` : null;
    if (track.rawLibraryTrack.artist_id) return `/library/artists/${track.rawLibraryTrack.artist_id}`;
    return track.rawLibraryTrack.artist_external_id
      ? `/library/artists/online/${encodeURIComponent(track.rawLibraryTrack.artist_external_id)}`
      : null;
  }
  const artistId = track.rawItem.artists[0]?.id;
  return artistId ? `/library/artists/online/${encodeURIComponent(artistId)}` : null;
}

export function trackAlbumHref(track: PlayerTrack): string | null {
  if (track.albumHref) return track.albumHref;
  if (track.source === "local") {
    const publicId = track.localKind === "song" ? track.rawSong.album_public_id : track.rawLibraryTrack.album_public_id;
    return publicId ? `/albums/${encodeURIComponent(publicId)}` : null;
  }
  const albumId = track.rawItem.album?.id;
  return albumId ? `/albums/${encodeURIComponent(albumId)}` : null;
}
