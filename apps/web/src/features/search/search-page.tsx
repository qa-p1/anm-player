import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Album, ChevronRight, Clock3, LoaderCircle, Mic2, Music2, Pin, PinOff, Search, Sparkles, Video, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import { pageTransition } from "@/animations/page-motion";
import { OnlineMusicCard } from "@/components/cards/online-music-card";
import { EmptyState } from "@/components/empty-states/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getLibraryAlbumStatuses, getLibraryTrackStatuses, searchYouTubeMusic } from "@/services/music-api";
import { musicKeys } from "@/services/music-keys";
import type { AlbumStatusItem, OnlineMusicItem } from "@/types/api";
import { cn } from "@/lib/utils";
import { useSearchHistoryStore } from "@/stores/search-history-store";

const filters = [
  { id: "all", label: "Top results", icon: Sparkles },
  { id: "songs", label: "Songs", icon: Music2 },
  { id: "videos", label: "Videos", icon: Video },
  { id: "albums", label: "Albums", icon: Album },
  { id: "artists", label: "Artists", icon: Mic2 },
] as const;

type SearchFilter = (typeof filters)[number]["id"];

const starterSearches = ["Global top songs", "New pop songs", "Lo-fi focus", "EDM workout", "Indie hits", "New albums"];
const TYPING_DELAY_MS = 300;
const ROW_KINDS = new Set(["song", "video", "episode"]);

export function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlQuery = (searchParams.get("q") ?? "").trim();
  const activeFilter: SearchFilter = filters.find((filter) => filter.id === searchParams.get("filter"))?.id ?? "all";
  // What's typed stays local; the URL and the search follow once typing pauses.
  const [text, setText] = useState(urlQuery);
  const [query, setQuery] = useState(urlQuery);
  const writtenQuery = useRef(urlQuery);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchEntries = useSearchHistoryStore((state) => state.entries);
  const recordSearch = useSearchHistoryStore((state) => state.recordSearch);
  const togglePinnedSearch = useSearchHistoryStore((state) => state.togglePinned);
  const removeSearch = useSearchHistoryStore((state) => state.removeSearch);
  const clearRecentSearches = useSearchHistoryStore((state) => state.clearRecent);

  useEffect(() => { searchInput.current?.focus(); }, []);

  // Another page (quick find, back/forward) changed the URL: search for that now.
  useEffect(() => {
    if (urlQuery === writtenQuery.current) return;
    writtenQuery.current = urlQuery;
    setText(urlQuery);
    setQuery(urlQuery);
  }, [urlQuery]);

  useEffect(() => {
    const next = text.trim();
    if (next === query) return;
    const timer = window.setTimeout(() => setQuery(next), next ? TYPING_DELAY_MS : 0);
    return () => window.clearTimeout(timer);
  }, [text, query]);

  useEffect(() => {
    if (query === writtenQuery.current) return;
    writtenQuery.current = query;
    setSearchParams((current) => { const next = new URLSearchParams(current); if (query) next.set("q", query); else next.delete("q"); return next; }, { replace: true });
  }, [query, setSearchParams]);

  function searchNow(value: string) {
    setText(value);
    setQuery(value.trim());
  }

  function setActiveFilter(value: SearchFilter) {
    setSearchParams((current) => { const next = new URLSearchParams(current); next.set("filter", value); return next; }, { replace: true });
  }

  const search = useInfiniteQuery({
    queryKey: ["ytmusic", "search", activeFilter, query],
    queryFn: ({ pageParam, signal }) => searchYouTubeMusic(query, activeFilter, pageParam ?? undefined, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.continuation,
    enabled: Boolean(query),
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    retry: 1,
    retryDelay: 400,
    // While a new search loads, keep showing the last results of the same type (dimmed), never another type's.
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[2] === activeFilter ? previous : undefined),
  });

  const items = useMemo(() => {
    const seen = new Set<string>();
    return (search.data?.pages ?? []).flatMap((page) => page.items).filter((item) => {
      const key = `${item.kind}:${item.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [search.data]);

  const trackIds = useMemo(() => [...new Set(items.filter((item) => item.playable && ROW_KINDS.has(item.kind)).map((item) => item.id))].sort(), [items]);
  const albumIds = useMemo(() => [...new Set(items.filter((item) => item.kind === "album").map((item) => item.browse_id || item.id).filter(Boolean))].sort(), [items]);
  // Under the library key, so finished downloads and saves refresh these automatically.
  const { data: trackStatuses } = useQuery({
    queryKey: [...musicKeys.library(), "track-statuses", trackIds],
    queryFn: ({ signal }) => getLibraryTrackStatuses(trackIds, signal),
    enabled: trackIds.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  const { data: albumStatusResponse } = useQuery({
    queryKey: [...musicKeys.library(), "album-statuses", albumIds],
    queryFn: ({ signal }) => getLibraryAlbumStatuses(albumIds, signal),
    enabled: albumIds.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  const downloadedTracks = useMemo(() => Object.fromEntries((trackStatuses?.statuses ?? []).map((status) => [status.external_id, status.is_downloaded])), [trackStatuses]);
  const albumStatuses = useMemo(() => Object.fromEntries((albumStatusResponse?.statuses ?? []).map((status) => [status.external_id, status])) as Record<string, AlbumStatusItem>, [albumStatusResponse]);

  const typing = text.trim() !== query;
  const loadingFirstPage = Boolean(query) && search.isPending;
  const refreshing = typing || search.isPlaceholderData || (search.isFetching && !search.isFetchingNextPage);
  const failed = search.isError && items.length === 0;
  const noResults = Boolean(query) && search.isSuccess && !search.isPlaceholderData && items.length === 0;

  return (
    <motion.div {...pageTransition} className="mx-auto max-w-7xl space-y-8 px-3 py-4 sm:px-6 lg:px-8 lg:py-7">
      <section className="space-y-5">
        <h1 className="text-4xl font-black tracking-tight sm:text-6xl">Search</h1>
        <div className="relative">
          {query && (refreshing || loadingFirstPage)
            ? <LoaderCircle aria-label="Searching" className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 animate-spin text-muted-foreground" />
            : <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />}
          <Input
            ref={searchInput}
            id="music-search"
            aria-label="Search YouTube Music"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
              searchNow(text);
              recordSearch(text);
            }}
            placeholder="Songs, albums, artists, playlists or a mood"
            className="h-14 rounded-2xl pl-12 pr-12 text-base shadow-glass sm:h-16 sm:text-lg"
          />
          {text && <button type="button" aria-label="Clear search" onClick={() => { searchNow(""); searchInput.current?.focus(); }} className="absolute right-3 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full hover:bg-white/10"><X className="h-4 w-4" /></button>}
        </div>
        <div role="group" aria-label="Result type" className="no-scrollbar flex w-fit max-w-full gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.04] p-1">
          {filters.map((filter) => {
            const Icon = filter.icon;
            const active = activeFilter === filter.id;
            return (
              <button
                key={filter.id}
                type="button"
                aria-pressed={active}
                onClick={() => setActiveFilter(filter.id)}
                className={cn(
                  "flex h-9 shrink-0 items-center gap-2 rounded-full px-3.5 text-sm font-semibold transition",
                  active ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {filter.label}
              </button>
            );
          })}
        </div>
      </section>

      {!query && !text.trim() && (
        <>
          {searchEntries.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-bold tracking-tight">Recent</h2>{searchEntries.some((entry) => !entry.pinned) && <Button size="sm" variant="quiet" onClick={clearRecentSearches}>Clear</Button>}</div>
              <div className="flex flex-wrap gap-2">
                {searchEntries.map((entry) => (
                  <div key={entry.query} className={cn("group flex h-10 items-center gap-0.5 rounded-full border pl-1 pr-1 transition", entry.pinned ? "border-primary/30 bg-primary/10" : "border-white/10 bg-white/[0.04] hover:bg-white/[0.08]")}>
                    <button type="button" onClick={() => searchNow(entry.query)} className="flex min-w-0 max-w-[16rem] items-center gap-2 rounded-full px-2.5 py-1.5 text-left text-sm font-semibold">{entry.pinned ? <Pin className="h-3.5 w-3.5 shrink-0 fill-primary text-primary" /> : <Clock3 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}<span className="truncate">{entry.query}</span></button>
                    <button type="button" aria-label={entry.pinned ? `Unpin ${entry.query}` : `Pin ${entry.query}`} onClick={() => togglePinnedSearch(entry.query)} className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground opacity-0 transition hover:bg-white/10 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">{entry.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}</button>
                    <button type="button" aria-label={`Remove ${entry.query} from recent searches`} onClick={() => removeSearch(entry.query)} className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground opacity-0 transition hover:bg-white/10 hover:text-red-400 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"><X className="h-3.5 w-3.5" /></button>
                  </div>
                ))}
              </div>
            </section>
          )}
          <section className="space-y-3">
            <h2 className="text-xl font-bold tracking-tight">Try</h2>
            <div className="flex flex-wrap gap-2">
              {starterSearches.map((search) => (
                <button key={search} type="button" onClick={() => searchNow(search)} className="h-10 rounded-full border border-white/10 bg-white/[0.04] px-4 text-sm font-semibold text-muted-foreground transition hover:bg-white/[0.08] hover:text-foreground">{search}</button>
              ))}
            </div>
          </section>
        </>
      )}

      {query && (
        // Picking a result is what makes a search worth remembering, not every pause in typing.
        <section className="space-y-5" onClickCapture={() => recordSearch(query)}>
          {failed ? (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-400/20 bg-red-500/5 p-4 text-sm text-red-400">
              {search.error instanceof Error ? search.error.message : "Search failed."}
              <Button variant="glass" size="sm" onClick={() => void search.refetch()}>Try again</Button>
            </div>
          ) : loadingFirstPage ? (
            <ResultsSkeleton />
          ) : noResults ? (
            <EmptyState icon={Search} title="No results found" description="Try a different title, artist, album, playlist, or mood." />
          ) : (
            <div className={cn("transition-opacity", refreshing && "opacity-50")} aria-busy={refreshing}>
              {activeFilter === "all"
                ? <TopResults items={items} albumStatuses={albumStatuses} downloadedTracks={downloadedTracks} onSeeAll={setActiveFilter} />
                : <ResultGroup title={filters.find((filter) => filter.id === activeFilter)?.label ?? "Songs"} items={items} albumStatuses={albumStatuses} downloadedTracks={downloadedTracks} />}
            </div>
          )}

          {search.hasNextPage && !refreshing && (
            <div className="flex flex-col items-center gap-2">
              {search.isFetchNextPageError && <p role="alert" className="text-sm text-red-400">Couldn't load more results.</p>}
              <Button variant="glass" onClick={() => void search.fetchNextPage()} disabled={search.isFetchingNextPage}>
                {search.isFetchingNextPage ? "Loading…" : search.isFetchNextPageError ? "Try again" : "Load more"}
              </Button>
            </div>
          )}
        </section>
      )}

    </motion.div>
  );
}

function ResultsSkeleton() {
  return (
    <div aria-label="Loading results" className="space-y-1 rounded-[1.6rem] border border-white/[0.06] bg-card/30 p-2 sm:p-3">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="flex items-center gap-3 p-2">
          <div className="h-12 w-12 shrink-0 animate-pulse rounded-lg bg-white/[0.06]" />
          <div className="flex-1 space-y-2"><div className="h-3.5 w-1/3 animate-pulse rounded bg-white/[0.06]" /><div className="h-3 w-1/4 animate-pulse rounded bg-white/[0.04]" /></div>
        </div>
      ))}
    </div>
  );
}

const TOP_GROUPS = [
  { title: "Songs", kinds: ["song"], limit: 6, filter: "songs" },
  { title: "Artists", kinds: ["artist"], limit: 5, filter: "artists" },
  { title: "Albums", kinds: ["album"], limit: 5, filter: "albums" },
  { title: "Playlists", kinds: ["playlist"], limit: 5, filter: null },
] as const;

/** A bit of everything, led by whatever YouTube Music ranked first. */
function TopResults({ items, albumStatuses, downloadedTracks, onSeeAll }: { items: OnlineMusicItem[]; albumStatuses: Record<string, AlbumStatusItem>; downloadedTracks: Record<string, boolean>; onSeeAll: (filter: SearchFilter) => void }) {
  const leading = items.find((item) => TOP_GROUPS.some((group) => (group.kinds as readonly string[]).includes(item.kind)));
  const groups = [...TOP_GROUPS].sort((a, b) => Number((b.kinds as readonly string[]).includes(leading?.kind ?? "")) - Number((a.kinds as readonly string[]).includes(leading?.kind ?? "")));
  return (
    <div className="space-y-8">
      {groups.map((group) => {
        const groupItems = items.filter((item) => (group.kinds as readonly string[]).includes(item.kind)).slice(0, group.limit);
        if (groupItems.length === 0) return null;
        return (
          <section key={group.title} className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-bold tracking-tight">{group.title}</h2>
              {group.filter && <Button size="sm" variant="quiet" onClick={() => onSeeAll(group.filter)}>See all<ChevronRight className="h-4 w-4" /></Button>}
            </div>
            <ResultGroup title={group.title} items={groupItems} albumStatuses={albumStatuses} downloadedTracks={downloadedTracks} />
          </section>
        );
      })}
    </div>
  );
}

function ResultGroup({ title, items, albumStatuses, downloadedTracks }: { title: string; items: OnlineMusicItem[]; albumStatuses: Record<string, AlbumStatusItem>; downloadedTracks: Record<string, boolean> }) {
  if (items.length === 0) return null;
  const rowItems = items.filter((item) => ROW_KINDS.has(item.kind));
  const gridItems = items.filter((item) => !ROW_KINDS.has(item.kind));

  return (
    <div aria-label={title} role="region" className="space-y-3">
      {rowItems.length > 0 && (
        <div className="rounded-[1.6rem] border border-white/[0.06] bg-card/30 p-2 sm:p-3">
          {rowItems.map((item) => (
            <OnlineMusicCard key={`${title}-${item.kind}-${item.id}`} item={item} context={rowItems} variant="row" flat albumStatus={albumStatuses[item.browse_id || item.id]} isDownloaded={downloadedTracks[item.id]} />
          ))}
        </div>
      )}
      {gridItems.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
          {gridItems.map((item) => (
            <OnlineMusicCard key={`${title}-${item.kind}-${item.id}`} item={item} context={items} variant={item.kind === "artist" ? "artist" : "tile"} albumStatus={albumStatuses[item.browse_id || item.id]} />
          ))}
        </div>
      )}
    </div>
  );
}
