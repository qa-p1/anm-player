import { motion } from "framer-motion";
import { Album, Clock3, Mic2, Music2, Pin, PinOff, Search, Video, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import { pageTransition } from "@/animations/page-motion";
import { OnlineMusicCard } from "@/components/cards/online-music-card";
import { EmptyState } from "@/components/empty-states/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useDownloads } from "@/hooks/use-music-queries";
import { isRequestCancelled } from "@/services/api-client";
import { getLibraryAlbumStatuses, getLibraryTrackStatuses, searchYouTubeMusic } from "@/services/music-api";
import type { AlbumStatusItem, OnlineMusicItem } from "@/types/api";
import { cn } from "@/lib/utils";
import { useSearchHistoryStore } from "@/stores/search-history-store";

const filters = [
  { id: "songs", label: "Songs", icon: Music2 },
  { id: "videos", label: "Videos", icon: Video },
  { id: "albums", label: "Albums", icon: Album },
  { id: "artists", label: "Artists", icon: Mic2 },
] as const;

type SearchFilter = (typeof filters)[number]["id"];

const starterSearches = ["Global top songs", "New pop songs", "Lo-fi focus", "EDM workout", "Indie hits", "New albums"];

export function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const activeFilter: SearchFilter = filters.find((filter) => filter.id === searchParams.get("filter"))?.id ?? "songs";
  function setQuery(value: string) {
    setSearchParams((current) => { const next = new URLSearchParams(current); if (value) next.set("q", value); else next.delete("q"); return next; }, { replace: true });
  }
  function setActiveFilter(value: SearchFilter) {
    setSearchParams((current) => { const next = new URLSearchParams(current); next.set("filter", value); return next; }, { replace: true });
  }
  const moreController = useRef<AbortController | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => { searchInput.current?.focus(); }, []);
  const [items, setItems] = useState<OnlineMusicItem[]>([]);
  const [continuation, setContinuation] = useState<string | null>(null);
  const [albumStatuses, setAlbumStatuses] = useState<Record<string, AlbumStatusItem>>({});
  const [downloadedTracks, setDownloadedTracks] = useState<Record<string, boolean>>({});
  const [albumStatusError, setAlbumStatusError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debouncedQuery = useDebouncedValue(query, 450);
  const normalizedQuery = debouncedQuery.trim();
  const { data: downloadJobs = [] } = useDownloads();
  const searchEntries = useSearchHistoryStore((state) => state.entries);
  const recordSearch = useSearchHistoryStore((state) => state.recordSearch);
  const togglePinnedSearch = useSearchHistoryStore((state) => state.togglePinned);
  const removeSearch = useSearchHistoryStore((state) => state.removeSearch);
  const clearRecentSearches = useSearchHistoryStore((state) => state.clearRecent);
  const downloadJobsKey = downloadJobs.map((job) => `${job.id}:${job.status}:${job.progress}`).join(",");

  useEffect(() => {
    const controller = new AbortController();
    moreController.current?.abort();
    setError(null);
    setContinuation(null);

    if (!normalizedQuery) {
      setItems([]);
      setIsSearching(false);
      return () => controller.abort();
    }

    setIsSearching(true);
    searchYouTubeMusic(normalizedQuery, activeFilter, undefined, controller.signal)
      .then((response) => {
        setItems(response.items);
        setContinuation(response.continuation);
        recordSearch(normalizedQuery);
      })
      .catch((searchError: unknown) => {
        if (isRequestCancelled(searchError)) return;
        setError(searchError instanceof Error ? searchError.message : "Search failed.");
        setItems([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsSearching(false);
      });

    return () => { controller.abort(); moreController.current?.abort(); };
  }, [normalizedQuery, activeFilter, recordSearch]);

  useEffect(() => {
    const albumIds = Array.from(
      new Set(
        items
          .filter((item) => item.kind === "album")
          .map((item) => item.browse_id || item.id)
          .filter((id): id is string => Boolean(id)),
      ),
    );
    const controller = new AbortController();
    setAlbumStatusError(null);
    if (albumIds.length === 0) {
      setAlbumStatuses({});
      return () => controller.abort();
    }
    getLibraryAlbumStatuses(albumIds, controller.signal)
      .then((response) => {
        setAlbumStatuses(() => {
          const next: Record<string, AlbumStatusItem> = {};
          for (const status of response.statuses) next[status.external_id] = status;
          return next;
        });
      })
      .catch((statusError: unknown) => {
        if (isRequestCancelled(statusError)) return;
        setAlbumStatuses({});
        setAlbumStatusError(statusError instanceof Error ? statusError.message : "Could not check saved album status.");
      });
    return () => controller.abort();
  }, [items]);

  useEffect(() => {
    const externalIds = Array.from(new Set(items.filter((item) => item.playable && ["song", "video", "episode"].includes(item.kind)).map((item) => item.id)));
    const controller = new AbortController();
    if (externalIds.length === 0) {
      setDownloadedTracks({});
      return () => controller.abort();
    }
    getLibraryTrackStatuses(externalIds, controller.signal)
      .then((response) => setDownloadedTracks(Object.fromEntries(response.statuses.map((status) => [status.external_id, status.is_downloaded]))))
      .catch((statusError: unknown) => {
        if (!isRequestCancelled(statusError)) console.error("Could not check track download status:", statusError);
      });
    return () => controller.abort();
  }, [items, downloadJobsKey]);

  async function loadMore() {
    if (!continuation || !normalizedQuery || isSearching) return;
    const controller = new AbortController();
    moreController.current = controller;
    setIsSearching(true);
    try {
      const response = await searchYouTubeMusic(normalizedQuery, activeFilter, continuation, controller.signal);
      if (controller.signal.aborted) return;
      setItems((current) => {
        const seen = new Set(current.map((item) => `${item.kind}:${item.id}`));
        return [...current, ...response.items.filter((item) => { const key = `${item.kind}:${item.id}`; if (seen.has(key)) return false; seen.add(key); return true; })];
      });
      setContinuation(response.continuation);
    } catch (loadError) {
      if (isRequestCancelled(loadError)) return;
      setError(loadError instanceof Error ? loadError.message : "Could not load more results.");
    } finally {
      if (!controller.signal.aborted) setIsSearching(false);
    }
  }

  return (
    <motion.div {...pageTransition} className="mx-auto max-w-7xl space-y-8 px-3 py-4 sm:px-6 lg:px-8 lg:py-7">
      <section className="space-y-5">
        <h1 className="text-4xl font-black tracking-tight sm:text-6xl">Search</h1>
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchInput}
            id="music-search"
            aria-label="Search YouTube Music"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Songs, albums, artists, playlists or a mood"
            className="h-14 rounded-2xl pl-12 pr-12 text-base shadow-glass sm:h-16 sm:text-lg"
          />
          {query && <button type="button" aria-label="Clear search" onClick={() => { setQuery(""); searchInput.current?.focus(); }} className="absolute right-3 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full hover:bg-white/10"><X className="h-4 w-4" /></button>}
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

      {!normalizedQuery && (
        <>
          {searchEntries.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-bold tracking-tight">Recent</h2>{searchEntries.some((entry) => !entry.pinned) && <Button size="sm" variant="quiet" onClick={clearRecentSearches}>Clear</Button>}</div>
              <div className="flex flex-wrap gap-2">
                {searchEntries.map((entry) => (
                  <div key={entry.query} className={cn("group flex h-10 items-center gap-0.5 rounded-full border pl-1 pr-1 transition", entry.pinned ? "border-primary/30 bg-primary/10" : "border-white/10 bg-white/[0.04] hover:bg-white/[0.08]")}>
                    <button type="button" onClick={() => setQuery(entry.query)} className="flex min-w-0 max-w-[16rem] items-center gap-2 rounded-full px-2.5 py-1.5 text-left text-sm font-semibold">{entry.pinned ? <Pin className="h-3.5 w-3.5 shrink-0 fill-primary text-primary" /> : <Clock3 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}<span className="truncate">{entry.query}</span></button>
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
                <button key={search} type="button" onClick={() => setQuery(search)} className="h-10 rounded-full border border-white/10 bg-white/[0.04] px-4 text-sm font-semibold text-muted-foreground transition hover:bg-white/[0.08] hover:text-foreground">{search}</button>
              ))}
            </div>
          </section>
        </>
      )}

      {error && <div role="alert" className="rounded-2xl border border-red-400/20 bg-red-500/5 p-4 text-sm text-red-400">{error}</div>}
      {albumStatusError && <div role="alert" className="rounded-2xl border border-red-400/20 bg-red-500/5 p-4 text-sm text-red-400">{albumStatusError}</div>}

      {normalizedQuery && (
        <section className="space-y-5">
          <ResultGroup title={filters.find((filter) => filter.id === activeFilter)?.label ?? "Songs"} items={items} albumStatuses={albumStatuses} downloadedTracks={downloadedTracks} />

          {items.length === 0 && !isSearching && (
            <EmptyState
              icon={Search}
              title="No results found"
              description="Try a different title, artist, album, playlist, or mood."
            />
          )}

          {continuation && (
            <div className="flex justify-center">
              <Button variant="glass" onClick={loadMore} disabled={isSearching}>
                {isSearching ? "Loading..." : "Load more"}
              </Button>
            </div>
          )}
        </section>
      )}

    </motion.div>
  );
}

function ResultGroup({ title, items, albumStatuses, downloadedTracks }: { title: string; items: OnlineMusicItem[]; albumStatuses: Record<string, AlbumStatusItem>; downloadedTracks: Record<string, boolean> }) {
  if (items.length === 0) return null;
  const rowKinds = new Set(["song", "video", "episode"]);
  const rowItems = items.filter((item) => rowKinds.has(item.kind));
  const gridItems = items.filter((item) => !rowKinds.has(item.kind));

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
