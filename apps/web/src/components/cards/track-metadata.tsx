import { Link } from "react-router";
import type { MouseEvent } from "react";

import { cn } from "@/lib/utils";
import type { PlayerTrack } from "@/types/player";

interface TrackMetadataProps {
  track: PlayerTrack;
  fallbackArtist?: string | null;
  className?: string;
  linkClassName?: string;
  onNavigate?: () => void;
}

/** Shared artist/album metadata used by rows and both player bars. */
export function TrackMetadata({ track, fallbackArtist, className, linkClassName, onNavigate }: TrackMetadataProps) {
  const artist = track.artistName || fallbackArtist || "Unknown Artist";
  const artistHref = trackArtistHref(track);
  const album = track.albumTitle;
  const albumHref = trackAlbumHref(track);
  const linkClasses = cn(
    "min-w-0 truncate transition hover:text-primary hover:underline hover:underline-offset-2",
    linkClassName,
  );
  function handleLinkClick(event: MouseEvent<HTMLAnchorElement>) {
    event.stopPropagation();
    onNavigate?.();
  }

  return (
    <span className={cn("inline-flex min-w-0 max-w-full items-center gap-1.5", className)}>
      {artistHref ? <Link to={artistHref} className={linkClasses} onClick={handleLinkClick}>{artist}</Link> : <span className="min-w-0 truncate">{artist}</span>}
      {album && (
        <>
          <span aria-hidden="true" className="shrink-0">•</span>
          {albumHref ? <Link to={albumHref} className={linkClasses} onClick={handleLinkClick}>{album}</Link> : <span className="min-w-0 truncate">{album}</span>}
        </>
      )}
    </span>
  );
}

function trackArtistHref(track: PlayerTrack): string | null {
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

function trackAlbumHref(track: PlayerTrack): string | null {
  if (track.albumHref) return track.albumHref;
  if (track.source === "local") {
    const publicId = track.localKind === "song" ? track.rawSong.album_public_id : track.rawLibraryTrack.album_public_id;
    return publicId ? `/albums/${encodeURIComponent(publicId)}` : null;
  }
  const albumId = track.rawItem.album?.id;
  return albumId ? `/albums/${encodeURIComponent(albumId)}` : null;
}
