import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ChevronRight, Clock3, Disc3, Heart, ListMusic, Mic2, Music2, Search, Sparkles, TrendingUp, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";

import { pageTransition } from "@/animations/page-motion";
import { ArtworkImage } from "@/components/cards/artwork-image";
import { TrackRow } from "@/components/cards/track-row";
import { Shelf } from "@/components/collection/collection-parts";
import { MediaTile } from "@/components/collection/media-tile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { playAlbumById } from "@/features/library/collection-playback";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useRecentlyPlayedHistory } from "@/hooks/use-music-queries";
import { cn } from "@/lib/utils";
import { cachedArtworkUrl } from "@/services/api-client";
import { getLibraryCounts, listLibraryAlbums, searchLibrary } from "@/services/music-api";
import { musicKeys } from "@/services/music-keys";
import type { PlayerTrack } from "@/types/player";
import { historyEntryToPlayerTrack } from "@/types/player";

export function LibraryPage() {
  const [query, setQuery] = useState("");
  const normalized = useDebouncedValue(query.trim(), 250);
  const countsQuery = useQuery({ queryKey: musicKeys.counts(), queryFn: ({ signal }) => getLibraryCounts(signal) });
  const albumsQuery = useQuery({ queryKey: musicKeys.libraryAlbums(12), queryFn: ({ signal }) => listLibraryAlbums(undefined, 12, 0, signal) });
  const searchQuery = useQuery({ queryKey: musicKeys.librarySearch(normalized), queryFn: ({ signal }) => searchLibrary(normalized, 12, signal), enabled: Boolean(normalized) });
  const { data: recentHistory = [] } = useRecentlyPlayedHistory(20);
  const stats = countsQuery.data;
  const albums = albumsQuery.data ?? [];
  const results = normalized ? searchQuery.data?.results ?? [] : [];

  // Distinct recent tracks, newest first.
  const recentTracks = useMemo(() => {
    const seen = new Set<string>();
    return recentHistory.map(historyEntryToPlayerTrack).filter((track): track is PlayerTrack => {
      if (!track || seen.has(track.id)) return false;
      seen.add(track.id);
      return true;
    }).slice(0, 6);
  }, [recentHistory]);

  const collections: Array<{ label: string; path: string; icon: LucideIcon; count?: number; tint: string }> = [
    { label: "Songs", path: "/library/songs", icon: Music2, count: stats?.songs, tint: "from-sky-500/25" },
    { label: "Albums", path: "/library/albums", icon: Disc3, count: stats?.albums, tint: "from-amber-500/25" },
    { label: "Artists", path: "/library/artists", icon: Mic2, count: stats?.artists, tint: "from-violet-500/25" },
    { label: "Playlists", path: "/library/playlists", icon: ListMusic, count: stats?.playlists, tint: "from-emerald-500/25" },
  ];
  const smart = [
    { label: "Recently added", path: "/library/smart/recently-added", icon: Sparkles },
    { label: "Recently played", path: "/library/smart/recently-played", icon: Clock3 },
    { label: "Most played", path: "/library/smart/most-played", icon: TrendingUp },
  ];

  return (
    <motion.div {...pageTransition} className="mx-auto max-w-7xl space-y-8 px-3 py-4 sm:px-6 lg:px-8 lg:py-7">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <h1 className="text-4xl font-black tracking-tight sm:text-6xl">Library</h1>
        <div className="relative w-full md:w-96">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setQuery(""); }} aria-label="Search your library" placeholder="Search your library" className="h-11 pl-11 pr-10" />
          {query && <button type="button" aria-label="Clear library search" onClick={() => setQuery("")} className="absolute right-1.5 top-1.5 grid h-8 w-8 place-items-center rounded-full hover:bg-white/10"><X className="h-4 w-4" /></button>}
        </div>
      </header>

      {(countsQuery.error || albumsQuery.error) && <div role="alert" className="flex items-center gap-2 text-sm text-muted-foreground">Some library information could not be loaded.<Button variant="ghost" size="sm" onClick={() => { void countsQuery.refetch(); void albumsQuery.refetch(); }}>Retry</Button></div>}

      {normalized ? (
        <section aria-label="Library search results" className="space-y-3">
          {searchQuery.isFetching && results.length === 0 && <p role="status" className="text-sm text-muted-foreground">Searching…</p>}
          {searchQuery.error && <p role="alert" className="text-sm text-red-400">{searchQuery.error.message}</p>}
          {!searchQuery.isFetching && !searchQuery.error && results.length === 0 && <p className="text-sm text-muted-foreground">Nothing in your library matches “{normalized}”.</p>}
          {results.length > 0 && (
            <div className="grid gap-1 rounded-[1.6rem] border border-white/[0.06] bg-card/30 p-2 md:grid-cols-2">
              {results.map((result) => {
                const artworkUrl = cachedArtworkUrl(result.artwork_path || result.artwork_url);
                return (
                  <Link key={`${result.item_type}-${result.id}`} to={result.href} className="flex items-center gap-3 rounded-xl p-2 transition hover:bg-white/[0.06]">
                    <span className={cn("h-11 w-11 shrink-0 overflow-hidden bg-white/10", result.item_type === "artist" ? "rounded-full" : "rounded-lg")}><ArtworkImage src={artworkUrl} fallbackSrc={cachedArtworkUrl(result.artwork_url)} alt="" className="h-full w-full object-cover" /></span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{result.title}</span><span className="block truncate text-xs capitalize text-muted-foreground">{result.subtitle ? `${result.item_type} · ${result.subtitle}` : result.item_type}</span></span>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      ) : (
        <>
          <section aria-label="Collections" className="grid gap-3 lg:grid-cols-[1.15fr_1fr]">
            <Link to="/library/favorites" className="group relative isolate flex min-h-44 flex-col justify-end overflow-hidden rounded-[1.6rem] p-6 shadow-glass lg:min-h-0">
              <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_10%,hsl(var(--primary)),transparent_60%),linear-gradient(135deg,hsl(var(--primary)/0.85),hsl(var(--accent)/0.6))] transition duration-500 group-hover:scale-105" />
              <Heart aria-hidden="true" className="absolute -right-6 -top-6 h-44 w-44 rotate-12 fill-white/10 text-white/10 transition duration-500 group-hover:rotate-6" />
              <h2 className="text-3xl font-black text-white sm:text-4xl">Favorites</h2>
              <span className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-white/80">Open<ChevronRight className="h-4 w-4 transition group-hover:translate-x-1" /></span>
            </Link>
            <div className="grid grid-cols-2 gap-3">
              {collections.map((item) => (
                <Link key={item.path} to={item.path} className={cn("group relative overflow-hidden rounded-[1.4rem] border border-white/[0.06] bg-gradient-to-br to-transparent p-4 transition hover:border-white/15 sm:p-5", item.tint)}>
                  <item.icon aria-hidden="true" className="h-5 w-5 text-foreground/70" />
                  <p className="mt-6 text-3xl font-black tabular-nums tracking-tight">{item.count === undefined ? <span className="inline-block h-8 w-12 animate-pulse rounded-lg bg-white/[0.08] align-middle" /> : item.count.toLocaleString()}</p>
                  <p className="text-sm font-semibold text-muted-foreground transition group-hover:text-foreground">{item.count === 1 ? item.label.slice(0, -1) : item.label}</p>
                </Link>
              ))}
            </div>
          </section>

          <nav aria-label="Smart collections" className="no-scrollbar -mx-3 flex gap-2 overflow-x-auto px-3 sm:mx-0 sm:px-0">
            {smart.map((item) => (
              <Link key={item.path} to={item.path} className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 text-sm font-semibold text-muted-foreground transition hover:bg-white/[0.08] hover:text-foreground">
                <item.icon className="h-4 w-4" />{item.label}
              </Link>
            ))}
          </nav>

          {recentTracks.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xl font-bold tracking-tight">Jump back in</h2>
                <Link to="/library/smart/recently-played" className="text-xs font-semibold text-muted-foreground hover:text-foreground">See all</Link>
              </div>
              <div className="grid gap-1 rounded-[1.6rem] border border-white/[0.06] bg-card/30 p-2 md:grid-cols-2">
                {recentTracks.map((track) => <TrackRow key={track.id} variant="list" track={track} context={recentTracks} />)}
              </div>
            </section>
          )}

          {albums.length > 0 && (
            <Shelf title="Albums" action={<Link to="/library/albums" className="text-xs font-semibold text-muted-foreground hover:text-foreground">See all</Link>}>
              {albums.map((album) => (
                <div key={album.public_id} className="w-40 shrink-0 snap-start sm:w-44">
                  <MediaTile
                    href={album.canonical_url}
                    title={album.title}
                    subtitle={album.artist_name || "Unknown Artist"}
                    artworkUrl={cachedArtworkUrl(album.artwork_path || album.artwork_url)}
                    fallbackArtworkUrl={cachedArtworkUrl(album.artwork_url)}
                    placeholderIcon={Disc3}
                    onPlay={() => playAlbumById(album.public_id)}
                  />
                </div>
              ))}
            </Shelf>
          )}
        </>
      )}
    </motion.div>
  );
}
