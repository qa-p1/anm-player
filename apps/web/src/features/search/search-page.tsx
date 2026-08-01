import { motion } from "framer-motion";
import { Album, Mic2, Music2, Search, Video } from "lucide-react";
import { useEffect, useState } from "react";
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

const filters = [
  { id: "songs", label: "Songs", icon: Music2 },
  { id: "videos", label: "Videos", icon: Video },
  { id: "albums", label: "Albums", icon: Album },
  { id: "artists", label: "Artists", icon: Mic2 },
] as const;

type SearchFilter = (typeof filters)[number]["id"];

const starterSearches = ["Global top songs", "New pop songs", "Lo-fi focus", "EDM workout", "Indie hits", "New albums"];

export function SearchPage() {
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
  const [activeFilter, setActiveFilter] = useState<SearchFilter>("songs");
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
  const downloadJobsKey = downloadJobs.map((job) => `${job.id}:${job.status}:${job.progress}`).join(",");

  useEffect(() => {
    const controller = new AbortController();
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
      })
      .catch((searchError: unknown) => {
        if (isRequestCancelled(searchError)) return;
        setError(searchError instanceof Error ? searchError.message : "Search failed.");
        setItems([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsSearching(false);
      });

    return () => controller.abort();
  }, [normalizedQuery, activeFilter]);

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
    if (!continuation || !normalizedQuery) return;
    setIsSearching(true);
    try {
      const response = await searchYouTubeMusic(normalizedQuery, activeFilter, continuation);
      setItems((current) => {
        const seen = new Set(current.map((item) => `${item.kind}:${item.id}`));
        return [...current, ...response.items.filter((item) => !seen.has(`${item.kind}:${item.id}`))];
      });
      setContinuation(response.continuation);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load more results.");
    } finally {
      setIsSearching(false);
    }
  }

  return (
    <motion.div {...pageTransition} className="mx-auto max-w-6xl space-y-8 px-4 py-5 sm:px-6 lg:px-8 lg:py-10">
      <section className="space-y-5">
        <div>
          <p className="mb-2 text-sm font-semibold text-primary">Search</p>
          <h1 className="text-4xl font-black tracking-normal sm:text-5xl">Find it. Play it. Keep it.</h1>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search songs, albums, artists, playlists, or moods"
            className="h-14 pl-12 pr-4 text-base sm:h-16 sm:text-lg"
          />
        </div>
        <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
          {filters.map((filter) => {
            const Icon = filter.icon;
            const active = activeFilter === filter.id;
            return (
              <button
                key={filter.id}
                type="button"
                onClick={() => setActiveFilter(filter.id)}
                className={cn(
                  "flex h-10 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-semibold transition",
                  active ? "bg-primary text-primary-foreground" : "glass-panel text-muted-foreground hover:text-foreground",
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
        <section className="space-y-3">
          <h2 className="text-xl font-bold tracking-normal">Start with a vibe</h2>
          <div className="flex flex-wrap gap-2">
            {starterSearches.map((search) => (
              <button
                key={search}
                type="button"
                onClick={() => setQuery(search)}
                className="glass-panel rounded-full px-4 py-2 text-sm font-semibold transition hover:bg-white/10"
              >
                {search}
              </button>
            ))}
          </div>
        </section>
      )}

      {error && <div className="glass-panel rounded-2xl p-4 text-sm text-primary">{error}</div>}
      {albumStatusError && <div className="glass-panel rounded-2xl p-4 text-sm text-red-400">{albumStatusError}</div>}

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
    <div className="space-y-3">
      <h2 className="text-xl font-bold tracking-normal">{title}</h2>
      {rowItems.length > 0 && (
        <div className="space-y-2">
          {rowItems.map((item) => (
            <OnlineMusicCard key={`${title}-${item.kind}-${item.id}`} item={item} context={rowItems} variant="row" albumStatus={albumStatuses[item.browse_id || item.id]} isDownloaded={downloadedTracks[item.id]} />
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
