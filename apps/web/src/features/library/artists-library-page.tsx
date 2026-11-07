import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Mic2 } from "lucide-react";
import { useMemo, useState } from "react";

import { pageTransition } from "@/animations/page-motion";
import { LibraryPageHeader, TileSkeleton } from "@/components/collection/collection-parts";
import { MediaTile, TileBadge } from "@/components/collection/media-tile";
import { EmptyState } from "@/components/empty-states/empty-state";
import { CollectionBrowser } from "@/components/filters/collection-browser";
import { Button } from "@/components/ui/button";
import { playArtistById } from "@/features/library/collection-playback";
import { cachedArtworkUrl } from "@/services/api-client";
import { listAllArtists } from "@/services/music-api";
import { musicKeys } from "@/services/music-keys";
import { pluralize } from "@/utils/format";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function ArtistsLibraryPage() {
  const { data: artists = [], isLoading, error, refetch } = useQuery({ queryKey: musicKeys.artists(), queryFn: ({ signal }) => listAllArtists(signal) });
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("name");
  const term = query.trim().toLocaleLowerCase();
  const visible = useMemo(() => artists
    .filter((artist) => artist.name.toLocaleLowerCase().includes(term))
    .sort((a, b) => sort === "songs" ? b.song_count - a.song_count : sort === "albums" ? b.album_count - a.album_count : collator.compare(a.sort_name || a.name, b.sort_name || b.name)), [artists, sort, term]);
  const totalSongs = artists.reduce((total, artist) => total + artist.song_count, 0);

  return (
    <motion.div {...pageTransition} className="mx-auto max-w-7xl space-y-8 px-3 py-4 sm:px-6 lg:px-8 lg:py-7">
      <LibraryPageHeader
        title="Artists"
        stats={artists.length ? [
          { label: artists.length === 1 ? "artist" : "artists", value: artists.length.toLocaleString() },
          { label: totalSongs === 1 ? "song" : "songs", value: totalSongs.toLocaleString() },
          { label: "favorites", value: artists.filter((artist) => artist.is_favorited).length.toLocaleString() },
        ] : []}
      />
      <section className="space-y-4">
        <CollectionBrowser label="artists" query={query} onQueryChange={setQuery} sort={sort} onSortChange={setSort} options={[{ value: "name", label: "Name" }, { value: "songs", label: "Most songs" }, { value: "albums", label: "Most albums" }]} />
        {error && <div role="alert" className="flex items-center gap-2 text-sm text-red-400">{error.message}<Button variant="ghost" onClick={() => void refetch()}>Retry</Button></div>}
        {isLoading ? <TileSkeleton round /> : artists.length === 0 ? (
          <EmptyState icon={Mic2} title="No artists yet" description="Artists appear as you add music." />
        ) : visible.length === 0 ? (
          <EmptyState icon={Mic2} title="No matching artists" description="Try another name." />
        ) : (
          <div className="-mx-2 grid grid-cols-2 gap-1 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {visible.map((artist) => (
              <MediaTile
                key={artist.id}
                shape="circle"
                href={`/library/artists/${artist.id}`}
                title={artist.name}
                subtitle={[pluralize(artist.song_count, "song"), artist.album_count ? pluralize(artist.album_count, "album") : null].filter(Boolean).join(" · ")}
                artworkUrl={cachedArtworkUrl(artist.artwork_path || artist.artwork_url)}
                fallbackArtworkUrl={cachedArtworkUrl(artist.artwork_url)}
                placeholderIcon={Mic2}
                badge={artist.is_favorited ? <TileBadge tone="primary">Favorite</TileBadge> : null}
                onPlay={artist.song_count > 0 ? () => playArtistById(artist.id) : undefined}
                playLabel={`Play ${artist.name}`}
              />
            ))}
          </div>
        )}
      </section>
    </motion.div>
  );
}
