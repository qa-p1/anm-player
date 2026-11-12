import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { CheckSquare2, Music2, Search, X } from "lucide-react";
import { useMemo, useState } from "react";

import { pageTransition } from "@/animations/page-motion";
import { CollectionActions } from "@/components/cards/collection-actions";
import { SongCard } from "@/components/cards/song-card";
import { TrackRow } from "@/components/cards/track-row";
import { CollectionHero } from "@/components/collection/collection-hero";
import { MosaicArtwork } from "@/components/collection/collection-parts";
import { EmptyState } from "@/components/empty-states/empty-state";
import { FilterPanel, type FilterState } from "@/components/filters/filter-panel";
import { BackButton } from "@/components/navigation/back-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useAllSongs, useSearchAllSongs } from "@/hooks/use-music-queries";
import { cn } from "@/lib/utils";
import { advancedSearchAllSongs, listSavedStreamingTracks } from "@/services/music-api";
import { musicKeys } from "@/services/music-keys";
import type { LibraryTrack, Song } from "@/types/api";
import { libraryTrackToPlayerTrack, songToPlayerTrack } from "@/types/player";

const EMPTY_SONGS: Song[] = [];
const EMPTY_TRACKS: LibraryTrack[] = [];

type SongEntry = { kind: "downloaded"; song: Song; added: string } | { kind: "streaming"; track: LibraryTrack; added: string };

function matches(track: LibraryTrack, query: string) {
  const needle = query.toLocaleLowerCase();
  return [track.title, track.artist_name, track.album_title].some((value) => value?.toLocaleLowerCase().includes(needle));
}

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
  // Saved songs that stream belong here too; file filters (year, artwork…) only apply to downloads.
  const savedQuery = useQuery({ queryKey: musicKeys.savedTracks(), queryFn: ({ signal }) => listSavedStreamingTracks(signal), staleTime: 60_000 });
  const displaySongs = hasFilters ? filtered.data ?? EMPTY_SONGS : debouncedSearch ? searchedSongsData ?? EMPTY_SONGS : allSongsData ?? EMPTY_SONGS;
  const streamingTracks = useMemo(() => {
    if (hasFilters) return EMPTY_TRACKS;
    const saved = savedQuery.data ?? EMPTY_TRACKS;
    return debouncedSearch ? saved.filter((track) => matches(track, debouncedSearch)) : saved;
  }, [debouncedSearch, hasFilters, savedQuery.data]);
  const entries = useMemo<SongEntry[]>(() => {
    const all: SongEntry[] = [
      ...displaySongs.map((song): SongEntry => ({ kind: "downloaded", song, added: song.created_at })),
      ...streamingTracks.map((track): SongEntry => ({ kind: "streaming", track, added: track.created_at })),
    ];
    // Search and filter results keep their own ranking; the full list is newest first.
    return debouncedSearch || hasFilters || streamingTracks.length === 0 ? all : all.sort((a, b) => b.added.localeCompare(a.added));
  }, [debouncedSearch, displaySongs, hasFilters, streamingTracks]);
  const loading = (hasFilters ? filtered.isLoading : debouncedSearch ? isLoadingSearchSongs : isLoadingAllSongs) || savedQuery.isLoading;
  const error = (hasFilters ? filtered.error : debouncedSearch ? searchError : allSongsError)?.message;
  const actionSongs = selectionMode ? displaySongs.filter((song) => selected.has(song.id)) : displaySongs;
  const displayTracks = useMemo(() => entries.map((entry) => (entry.kind === "downloaded" ? songToPlayerTrack(entry.song) : libraryTrackToPlayerTrack(entry.track))), [entries]);
  const actionTracks = useMemo(() => (selectionMode ? actionSongs.map(songToPlayerTrack) : displayTracks), [actionSongs, displayTracks, selectionMode]);
  const allVisibleSelected = displaySongs.length > 0 && displaySongs.every((song) => selected.has(song.id));
  const covers = useMemo(() => (allSongsData ?? EMPTY_SONGS).slice(0, 24).map((song) => songToPlayerTrack(song).artworkUrl), [allSongsData]);

  function toggle(songId: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(songId)) next.delete(songId);
      else next.add(songId);
      return next;
    });
  }

  return (
    <motion.div {...pageTransition} className="mx-auto max-w-7xl space-y-6 px-3 py-4 sm:px-6 lg:px-8 lg:py-7">
      <BackButton fallback="/library" />
      <CollectionHero kind="Songs" title="Songs" artworkUrl={covers.find(Boolean) ?? null} artwork={<MosaicArtwork urls={covers} icon={Music2} />}>
        <CollectionActions tracks={actionTracks} name={selectionMode ? "Selected songs" : "Library songs"} disabled={loading} />
      </CollectionHero>

      <section aria-label="Collection controls" className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setSearchQuery(""); }} aria-label="Search songs in your library" placeholder="Search songs" className="h-10 pl-9 pr-10 text-sm" />
            {searchQuery && <button type="button" aria-label="Clear library search" onClick={() => setSearchQuery("")} className="absolute right-1 top-1 grid h-8 w-8 place-items-center rounded-full hover:bg-white/10"><X className="h-4 w-4" /></button>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant={selectionMode ? "default" : "glass"} size="sm" className="h-10" aria-pressed={selectionMode} onClick={() => { setSelectionMode(!selectionMode); setSelected(new Set()); }}><CheckSquare2 className="h-4 w-4" />{selectionMode ? "Done selecting" : "Select songs"}</Button>
            {selectionMode && <Button variant="ghost" size="sm" className="h-10" onClick={() => setSelected(allVisibleSelected ? new Set() : new Set(displaySongs.map((song) => song.id)))}>{allVisibleSelected ? "Deselect all" : "Select visible"}</Button>}
            {(searchQuery || hasFilters) && <Button variant="ghost" size="sm" className="h-10" onClick={() => { setSearchQuery(""); setFilters({}); setSelected(new Set()); }}>Reset</Button>}
          </div>
        </div>
        <FilterPanel filters={filters} onFiltersChange={setFilters} onClear={() => setFilters({})} />
        {selectionMode && <p className="text-xs text-muted-foreground">{actionSongs.length} selected</p>}
      </section>

      {error && <div role="alert" className="flex items-center gap-2 rounded-2xl border border-red-400/20 bg-red-500/5 p-3 text-sm text-red-400">{error}<Button variant="ghost" size="sm" onClick={() => { if (hasFilters) void filtered.refetch(); else if (debouncedSearch) void refetchSearch(); else void refetchAll(); }}>Retry</Button></div>}

      {loading ? (
        <div role="status" aria-label="Loading songs" className="space-y-1">{Array.from({ length: 10 }).map((_, index) => <div key={index} className="h-14 animate-pulse rounded-xl bg-white/[0.04]" />)}</div>
      ) : entries.length === 0 ? (
        <EmptyState icon={Music2} title={searchQuery || hasFilters ? "No songs found" : "No songs yet"} description={searchQuery || hasFilters ? "Try another search or loosen the filters." : "Songs you save, like or download show up here."} />
      ) : (
        <section aria-label="Songs" className="rounded-[1.6rem] border border-white/[0.06] bg-card/30 p-2 sm:p-3">
          {entries.map((entry, index) => entry.kind === "downloaded" ? (
            <div key={`song-${entry.song.id}`} className={cn("flex items-center gap-1 rounded-xl", selected.has(entry.song.id) && "bg-primary/[0.08]")}>
              {selectionMode && <label className="grid h-9 w-8 shrink-0 cursor-pointer place-items-center"><input type="checkbox" aria-label={`Select ${entry.song.title}`} checked={selected.has(entry.song.id)} onChange={() => toggle(entry.song.id)} className="h-4 w-4 accent-primary" /></label>}
              <SongCard song={entry.song} playerContext={displayTracks} showArtist showAlbum variant="list" number={index + 1} className="min-w-0 flex-1" />
            </div>
          ) : (
            <div key={`track-${entry.track.id}`} className="flex items-center gap-1 rounded-xl">
              {/* Selection acts on downloaded files; streamed songs keep their place without a box. */}
              {selectionMode && <span aria-hidden="true" className="w-8 shrink-0" />}
              <TrackRow variant="list" number={index + 1} track={displayTracks[index]} context={displayTracks} explicit={entry.track.explicit} isDownloaded={entry.track.is_downloaded} className="min-w-0 flex-1" />
            </div>
          ))}
        </section>
      )}
    </motion.div>
  );
}
