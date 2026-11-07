import { musicKeys } from "@/services/music-keys";
import { CollectionActions } from "@/components/cards/collection-actions";
import { Button } from "@/components/ui/button";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { songToPlayerTrack } from "@/types/player";
import { motion } from "framer-motion";
import { Music, Search, X, CheckSquare2 } from "lucide-react";
import { useMemo, useState } from "react";

import { pageTransition } from "@/animations/page-motion";
import { SongCard } from "@/components/cards/song-card";
import { EmptyState } from "@/components/empty-states/empty-state";
import { BackButton } from "@/components/navigation/back-button";
import { Input } from "@/components/ui/input";
import { FilterPanel, FilterState } from "@/components/filters/filter-panel";
import { useAllSongs, useSearchAllSongs } from "@/hooks/use-music-queries";
import { useQuery } from "@tanstack/react-query";
import { advancedSearchAllSongs } from "@/services/music-api";
import type { Song } from "@/types/api";

const EMPTY_SONGS: Song[] = [];

export function SongsLibraryPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearch = useDebouncedValue(searchQuery.trim(), 250);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [filters, setFilters] = useState<FilterState>({});
  const hasFilters = Object.keys(filters).length > 0;

  const { data: allSongsData, isLoading: isLoadingAllSongs, error: allSongsError, refetch: refetchAll } = useAllSongs({
    enabled: !debouncedSearch && !hasFilters,
  });
  const { data: searchedSongsData, isLoading: isLoadingSearchSongs, error: searchError, refetch: refetchSearch } = useSearchAllSongs(debouncedSearch, {
    enabled: Boolean(debouncedSearch) && !hasFilters,
  });
  const filtered = useQuery({
    queryKey: [...musicKeys.songs(), "filtered", debouncedSearch, filters],
    queryFn: ({ signal }) => advancedSearchAllSongs({ q: debouncedSearch || undefined, year_min: filters.yearMin,
      year_max: filters.yearMax, duration_min: filters.durationMin, duration_max: filters.durationMax,
      has_artwork: filters.hasArtwork, sort_by: filters.sortBy, sort_order: filters.sortOrder }, signal),
    enabled: hasFilters,
  });
  const displaySongs = hasFilters ? filtered.data ?? EMPTY_SONGS : debouncedSearch ? searchedSongsData ?? EMPTY_SONGS : allSongsData ?? EMPTY_SONGS;
  const loading = hasFilters ? filtered.isLoading : debouncedSearch ? isLoadingSearchSongs : isLoadingAllSongs;
  const error = (hasFilters ? filtered.error : debouncedSearch ? searchError : allSongsError)?.message;
  const actionSongs = selectionMode ? displaySongs.filter((song) => selected.has(song.id)) : displaySongs;
  const actionTracks = useMemo(() => actionSongs.map(songToPlayerTrack), [actionSongs]);
  const allVisibleSelected = displaySongs.length > 0 && displaySongs.every((song) => selected.has(song.id));


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
            aria-label="Search songs in your library"
            placeholder="Search songs in your library..."
            className="pl-10 pr-12"
          />
          {searchQuery && <button type="button" aria-label="Clear library search" onClick={() => setSearchQuery("")} className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full hover:bg-white/10"><X className="h-4 w-4" /></button>}
        </div>
      </section>

      <FilterPanel
        filters={filters}
        onFiltersChange={setFilters}
        onClear={() => setFilters({})}
      />

      {error && <div role="alert" className="glass-panel rounded-2xl p-4 text-sm text-red-400">{error}<Button variant="ghost" size="sm" onClick={() => { if (hasFilters) void filtered.refetch(); else if (debouncedSearch) void refetchSearch(); else void refetchAll(); }}>Retry</Button></div>}
      <section className="space-y-3" aria-label="Collection controls">
        <CollectionActions tracks={actionTracks} name={selectionMode ? "Selected songs" : "Library songs"} disabled={loading} />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="glass" size="sm" aria-pressed={selectionMode} onClick={() => { setSelectionMode(!selectionMode); setSelected(new Set()); }}><CheckSquare2 className="h-4 w-4" />{selectionMode ? "Done selecting" : "Select songs"}</Button>
          {selectionMode && <><Button variant="ghost" size="sm" onClick={() => setSelected(allVisibleSelected ? new Set() : new Set(displaySongs.map((song) => song.id)))}>{allVisibleSelected ? "Deselect all" : "Select visible"}</Button><span className="text-xs text-muted-foreground">{actionSongs.length} selected</span></>}
          {(searchQuery || hasFilters) && <Button variant="ghost" size="sm" onClick={() => { setSearchQuery(""); setFilters({}); setSelected(new Set()); }}>Reset search & filters</Button>}
        </div>
      </section>

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
          displaySongs.map((song) => <div key={song.id} className="flex items-center gap-2">
            {selectionMode && <input type="checkbox" aria-label={`Select ${song.title}`} checked={selected.has(song.id)} onChange={() => setSelected((current) => { const next = new Set(current); if (next.has(song.id)) next.delete(song.id); else next.add(song.id); return next; })} className="h-5 w-5 shrink-0 accent-primary" />}
            <SongCard song={song} context={displaySongs} showArtist showAlbum className="min-w-0 flex-1" />
          </div>)
        )}
      </section>
    </motion.div>
  );
}
