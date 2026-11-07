import { useQuery } from "@tanstack/react-query";
import { Disc3 } from "lucide-react";
import { Link } from "react-router";

import { Shelf } from "@/components/collection/collection-parts";
import { MediaTile } from "@/components/collection/media-tile";
import { playAlbumById } from "@/features/library/collection-playback";
import { cachedArtworkUrl } from "@/services/api-client";
import { getArtist, getOnlineArtist } from "@/services/music-api";
import { musicKeys } from "@/services/music-keys";

interface ShelfAlbum {
  key: string;
  title: string;
  year: number | null;
  href: string;
  publicId: string | null;
  artwork: string | null;
  fallback: string | null;
}

/** Other releases by the album's artist, from the same cache as the artist page. */
export function MoreByArtist({ artistName, artistHref, currentAlbumId }: { artistName: string; artistHref: string; currentAlbumId: string }) {
  const online = /^\/library\/artists\/online\/(.+)$/.exec(artistHref);
  const local = /^\/library\/artists\/(\d+)$/.exec(artistHref);
  const onlineId = online ? decodeURIComponent(online[1]) : null;
  const localId = local ? Number(local[1]) : null;
  const onlineQuery = useQuery({ queryKey: musicKeys.onlineArtist(onlineId ?? ""), queryFn: ({ signal }) => getOnlineArtist(onlineId!, signal), enabled: Boolean(onlineId), staleTime: 5 * 60 * 1000 });
  const localQuery = useQuery({ queryKey: musicKeys.artist(localId ?? 0), queryFn: ({ signal }) => getArtist(localId!, signal), enabled: localId !== null && localId > 0, staleTime: 5 * 60 * 1000 });

  const albums: ShelfAlbum[] = onlineQuery.data
    ? onlineQuery.data.albums.map((album) => ({ key: album.public_id, title: album.title, year: album.year, href: album.canonical_url, publicId: album.public_id, artwork: album.artwork_path || album.artwork_url, fallback: album.artwork_url }))
    : (localQuery.data?.albums ?? []).map((album) => ({ key: String(album.id), title: album.title, year: album.year, href: album.public_id ? `/albums/${album.public_id}` : "/library/albums", publicId: album.public_id, artwork: album.artwork_path || album.artwork_url, fallback: album.artwork_url }));
  const others = albums
    .filter((album) => album.publicId !== currentAlbumId)
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
    .slice(0, 12);
  if (others.length === 0) return null;

  return (
    <Shelf title={`More by ${artistName}`} action={<Link to={artistHref} className="text-xs font-semibold text-muted-foreground hover:text-foreground">See all</Link>}>
      {others.map((album) => (
        <div key={album.key} className="w-40 shrink-0 snap-start sm:w-44">
          <MediaTile
            href={album.href}
            title={album.title}
            subtitle={album.year ? String(album.year) : undefined}
            artworkUrl={cachedArtworkUrl(album.artwork)}
            fallbackArtworkUrl={cachedArtworkUrl(album.fallback)}
            placeholderIcon={Disc3}
            onPlay={album.publicId ? () => playAlbumById(album.publicId!) : undefined}
          />
        </div>
      ))}
    </Shelf>
  );
}
