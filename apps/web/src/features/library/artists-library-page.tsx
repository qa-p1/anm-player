import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Mic2 } from "lucide-react";
import { useMemo, useState } from "react";

import { pageTransition } from "@/animations/page-motion";
import { CollectionHero, MetaDots } from "@/components/collection/collection-hero";
import { MosaicArtwork, TileSkeleton } from "@/components/collection/collection-parts";
import { EqualizerBars } from "@/components/collection/equalizer-bars";
import { MediaTile, TileBadge } from "@/components/collection/media-tile";
import { EmptyState } from "@/components/empty-states/empty-state";
import { CollectionBrowser } from "@/components/filters/collection-browser";
import { BackButton } from "@/components/navigation/back-button";
import { Button } from "@/components/ui/button";
import { playArtistById } from "@/features/library/collection-playback";
import { cachedArtworkUrl } from "@/services/api-client";
import { listAllArtists } from "@/services/music-api";
import { musicKeys } from "@/services/music-keys";
import { usePlaybackSourceStore } from "@/stores/playback-source-store";
import { pluralize } from "@/utils/format";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function ArtistsLibraryPage() {
  const { data: artists = [], isLoading, error, refetch } = useQuery({ queryKey: musicKeys.artists(), queryFn: ({ signal }) => listAllArtists(signal) });
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("name");
  const playingArtistId = usePlaybackSourceStore((state) => state.source?.kind === "artist" ? state.source.id : null);
  const term = query.trim().toLocaleLowerCase();
  const visible = useMemo(() => artists
    .filter((artist) => artist.name.toLocaleLowerCase().includes(term))
    .sort((a, b) => sort === "songs" ? b.song_count - a.song_count : sort === "albums" ? b.album_count - a.album_count : collator.compare(a.sort_name || a.name, b.sort_name || b.name)), [artists, sort, term]);
  const totalSongs = artists.reduce((total, artist) => total + artist.song_count, 0);
  const favorites = artists.filter((artist) => artist.is_favorited).length;
  const covers = artists.slice(0, 24).map((artist) => cachedArtworkUrl(artist.artwork_path || artist.artwork_url));

  return (
    <motion.div {...pageTransition} className="mx-auto max-w-7xl space-y-6 px-3 py-4 sm:px-6 lg:px-8 lg:py-7">
      <BackButton fallback="/library" />
      <CollectionHero
        kind="Artists"
        title="Artists"
        artworkUrl={covers.find(Boolean) ?? null}
        shape="circle"
        artwork={<MosaicArtwork urls={covers} icon={Mic2} />}
        meta={artists.length > 0 && <MetaDots items={[pluralize(artists.length, "artist"), pluralize(totalSongs, "song"), favorites > 0 ? pluralize(favorites, "favorite") : null]} />}
      />
      <section aria-label="Your artists" className="space-y-4">
        <CollectionBrowser label="artists" query={query} onQueryChange={setQuery} sort={sort} onSortChange={setSort} options={[{ value: "name", label: "Name" }, { value: "songs", label: "Most songs" }, { value: "albums", label: "Most albums" }]} />
        {error && <div role="alert" className="flex items-center gap-2 rounded-2xl border border-red-400/20 bg-red-500/5 p-3 text-sm text-red-400">{error.message}<Button variant="ghost" size="sm" onClick={() => void refetch()}>Retry</Button></div>}
        {isLoading ? <TileSkeleton round /> : error && artists.length === 0 ? null : artists.length === 0 ? (
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
                isActive={playingArtistId === String(artist.id)}
                badge={playingArtistId === String(artist.id) ? <TileBadge tone="primary"><EqualizerBars className="h-2.5" />Playing</TileBadge> : artist.is_favorited ? <TileBadge tone="primary">Favorite</TileBadge> : null}
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
