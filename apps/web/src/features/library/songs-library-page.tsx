import { motion } from "framer-motion";
import { Music, Search } from "lucide-react";
import { useEffect, useState } from "react";

import { pageTransition } from "@/animations/page-motion";
import { SongCard } from "@/components/cards/song-card";
import { EmptyState } from "@/components/empty-states/empty-state";
import { BackButton } from "@/components/navigation/back-button";
import { Input } from "@/components/ui/input";
import { FilterPanel, FilterState } from "@/components/filters/filter-panel";
import { useAllSongs, useSearchAllSongs } from "@/hooks/use-music-queries";
import { isRequestCancelled } from "@/services/api-client";
import { advancedSearchAllSongs } from "@/services/music-api";
import type { Song } from "@/types/api";

const EMPTY_SONGS: Song[] = [];

export function SongsLibraryPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState<FilterState>({});
  const [filteredSongs, setFilteredSongs] = useState<Song[]>([]);
  const [isFiltering, setIsFiltering] = useState(false);
  const [filterError, setFilterError] = useState<string | null>(null);

  const { data: allSongsData, isLoading: isLoadingAllSongs } = useAllSongs({
    enabled: !searchQuery,
  });
  const { data: searchedSongsData, isLoading: isLoadingSearchSongs } = useSearchAllSongs(searchQuery, {
    enabled: Boolean(searchQuery),
  });
  const songs = searchQuery ? searchedSongsData ?? EMPTY_SONGS : allSongsData ?? EMPTY_SONGS;
  const isLoading = searchQuery ? isLoadingSearchSongs : isLoadingAllSongs;

  const hasFilters = Object.keys(filters).length > 0;

  // Apply advanced filters
  useEffect(() => {
    if (!hasFilters) {
      setFilteredSongs(songs);
      return;
    }

    setIsFiltering(true);
    setFilterError(null);
    const controller = new AbortController();

    advancedSearchAllSongs(
      {
        q: searchQuery || undefined,
        year_min: filters.yearMin,
        year_max: filters.yearMax,
        duration_min: filters.durationMin,
        duration_max: filters.durationMax,
        has_artwork: filters.hasArtwork,
        sort_by: filters.sortBy,
        sort_order: filters.sortOrder,
      },
      controller.signal
    )
      .then(setFilteredSongs)
      .catch((error) => {
        if (isRequestCancelled(error)) return;
        setFilteredSongs([]);
        setFilterError(error instanceof Error ? error.message : "Could not apply library filters.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsFiltering(false);
      });

    return () => controller.abort();
  }, [filters, searchQuery, songs, hasFilters]);

  const displaySongs = hasFilters ? filteredSongs : songs;
  const loading = isLoading || isFiltering;

  return (
    <motion.div {...pageTransition} className="mx-auto max-w-7xl space-y-8 px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
      <section>
        <BackButton fallback="/library" />
        <p className="mb-2 text-sm font-semibold text-primary">Songs</p>
        <h1 className="text-4xl font-black tracking-normal sm:text-5xl">
          Your music collection
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
          {displaySongs.length} {displaySongs.length === 1 ? "song" : "songs"} {hasFilters ? "matching filters" : "downloaded"}
        </p>
      </section>

      <section className="glass-panel rounded-3xl p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search songs in your library..."
            className="pl-10"
          />
        </div>
      </section>

      <FilterPanel
        filters={filters}
        onFiltersChange={setFilters}
        onClear={() => setFilters({})}
      />

      {filterError && <div className="glass-panel rounded-2xl p-4 text-sm text-red-400">{filterError}</div>}

      <section className="space-y-2">
        {loading ? (
          <p className="text-center text-muted-foreground">Loading...</p>
        ) : displaySongs.length === 0 ? (
          <EmptyState
            icon={Music}
            title={searchQuery || hasFilters ? "No songs found" : "No songs in library"}
            description={searchQuery || hasFilters ? "Try adjusting your search or filters." : "Download some music from the Search page to see it here."}
          />
        ) : (
          displaySongs.map((song) => <SongCard key={song.id} song={song} context={displaySongs} showArtist showAlbum />)
        )}
      </section>
    </motion.div>
  );
}
