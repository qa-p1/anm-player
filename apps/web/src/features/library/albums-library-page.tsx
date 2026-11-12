import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Check, Disc, Disc3, Play, Shuffle } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useShallow } from "zustand/react/shallow";

import { pageTransition } from "@/animations/page-motion";
import { ArtworkImage } from "@/components/cards/artwork-image";
import { CollectionHero, MetaDots } from "@/components/collection/collection-hero";
import { EqualizerBars } from "@/components/collection/equalizer-bars";
import { MosaicArtwork, Shelf, TileSkeleton, ViewToggle } from "@/components/collection/collection-parts";
import { MediaTile, TileBadge } from "@/components/collection/media-tile";
import { EmptyState } from "@/components/empty-states/empty-state";
import { CollectionBrowser } from "@/components/filters/collection-browser";
import { BackButton } from "@/components/navigation/back-button";
import { Button } from "@/components/ui/button";
import { playAlbumById, playingAlbumKey } from "@/features/library/collection-playback";
import { cn } from "@/lib/utils";
import { serverTime } from "@/utils/dates";
import { cachedArtworkUrl } from "@/services/api-client";
import { listAllLibraryAlbums } from "@/services/music-api";
import { musicKeys } from "@/services/music-keys";
import { useLibraryPreferencesStore } from "@/stores/library-preferences-store";
import { usePlayerStore } from "@/stores/player-store";
import type { LibraryAlbum } from "@/types/api";
import { formatListeningTime, formatRelativeDate, pluralize } from "@/utils/format";
import { shuffleTracks } from "@/utils/track-collection";

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

export function AlbumsLibraryPage() {
  const { data: albums = [], isLoading, error, refetch } = useQuery({ queryKey: musicKeys.libraryAlbums("all"), queryFn: ({ signal }) => listAllLibraryAlbums(undefined, signal) });
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("name");
  const [offlineOnly, setOfflineOnly] = useState(false);
  const view = useLibraryPreferencesStore((state) => state.viewModes.albums ?? "grid");
  const setViewMode = useLibraryPreferencesStore((state) => state.setViewMode);
  const playingAlbumId = usePlayerStore(useShallow((state) => playingAlbumKey(state.currentSong)));
  const term = query.trim().toLocaleLowerCase();

  const visible = useMemo(() => albums
    .filter((album) => (!offlineOnly || album.download_state === "downloaded") && `${album.title} ${album.artist_name || ""} ${album.year ?? ""}`.toLocaleLowerCase().includes(term))
    .sort((a, b) => {
      if (sort === "year") return (b.year ?? 0) - (a.year ?? 0) || collator.compare(a.title, b.title);
      if (sort === "recent") return serverTime(b.added_at || b.created_at) - serverTime(a.added_at || a.created_at);
      if (sort === "artist") return collator.compare(a.artist_name || "", b.artist_name || "") || (a.year ?? 0) - (b.year ?? 0);
      return collator.compare(a.title, b.title);
    }), [albums, offlineOnly, sort, term]);

  const stats = useMemo(() => {
    const artists = new Set(albums.map((album) => album.artist_name?.toLocaleLowerCase()).filter(Boolean));
    const seconds = albums.reduce((total, album) => total + Math.max(0, album.duration_seconds ?? 0), 0);
    return [
      { label: albums.length === 1 ? "album" : "albums", value: albums.length.toLocaleString() },
      { label: artists.size === 1 ? "artist" : "artists", value: artists.size.toLocaleString() },
      { label: "offline", value: albums.filter((album) => album.download_state === "downloaded").length.toLocaleString() },
      ...(seconds > 0 ? [{ label: "of music", value: formatListeningTime(seconds) }] : []),
    ];
  }, [albums]);

  const recent = useMemo(() => [...albums].sort((a, b) => serverTime(b.added_at || b.created_at) - serverTime(a.added_at || a.created_at)).slice(0, 12), [albums]);
  const showShelf = !term && !offlineOnly && albums.length >= 8;
  const covers = useMemo(() => recent.map((album) => cachedArtworkUrl(album.artwork_path || album.artwork_url)), [recent]);

  return (
    <motion.div {...pageTransition} className="mx-auto max-w-7xl space-y-6 px-3 py-4 sm:px-6 lg:px-8 lg:py-7">
      <BackButton fallback="/library" />
      <CollectionHero
        kind="Albums"
        title="Albums"
        artworkUrl={covers.find(Boolean) ?? null}
        artwork={<MosaicArtwork urls={covers} icon={Disc3} />}
        meta={albums.length > 0 && <MetaDots items={stats.map((stat) => <span key={stat.label}>{stat.value} {stat.label}</span>)} />}
      >
        {albums.length > 0 && <Button variant="glass" onClick={() => void playRandomAlbum(albums)}><Shuffle className="h-4 w-4" />Play a random album</Button>}
      </CollectionHero>

      {showShelf && (
        <Shelf title="Recently added">
          {recent.map((album) => <div key={album.public_id} className="w-40 shrink-0 snap-start sm:w-44"><AlbumTile album={album} isActive={playingAlbumId === album.public_id} meta={formatRelativeDate(album.added_at || album.created_at)} /></div>)}
        </Shelf>
      )}

      <section aria-label="Your albums" className="space-y-4">
        <CollectionBrowser label="albums" query={query} onQueryChange={setQuery} sort={sort} onSortChange={setSort} options={[{ value: "name", label: "Title" }, { value: "artist", label: "Artist" }, { value: "year", label: "Newest year" }, { value: "recent", label: "Recently added" }]}>
          <Button size="sm" variant={offlineOnly ? "default" : "glass"} aria-pressed={offlineOnly} onClick={() => setOfflineOnly(!offlineOnly)}>Downloaded only</Button>
          <ViewToggle label="Albums" value={view} onChange={(mode) => setViewMode("albums", mode)} />
        </CollectionBrowser>
        {error && <div role="alert" className="flex items-center gap-2 rounded-2xl border border-red-400/20 bg-red-500/5 p-3 text-sm text-red-400">{error.message}<Button variant="ghost" size="sm" onClick={() => void refetch()}>Retry</Button></div>}

        {isLoading ? <TileSkeleton /> : error && albums.length === 0 ? null : albums.length === 0 ? (
          <EmptyState icon={Disc} title="No albums in library" description="Add an online album or scan local music to see it here." />
        ) : visible.length === 0 ? (
          <EmptyState icon={Disc} title="No matching albums" description="Try a different search or turn off the download filter." />
        ) : view === "grid" ? (
          <div className="-mx-2 grid grid-cols-2 gap-1 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {visible.map((album) => <AlbumTile key={album.public_id} album={album} isActive={playingAlbumId === album.public_id} />)}
          </div>
        ) : (
          <div className="rounded-[1.6rem] border border-white/[0.06] bg-card/30 p-2">
            {visible.map((album) => <AlbumListRow key={album.public_id} album={album} isActive={playingAlbumId === album.public_id} />)}
          </div>
        )}
      </section>
    </motion.div>
  );
}

async function playRandomAlbum(albums: LibraryAlbum[]) {
  const [pick] = shuffleTracks(albums);
  if (pick) await playAlbumById(pick.public_id);
}

function AlbumTile({ album, isActive, meta }: { album: LibraryAlbum; isActive: boolean; meta?: string }) {
  const artworkUrl = cachedArtworkUrl(album.artwork_path || album.artwork_url);
  return (
    <MediaTile
      href={album.canonical_url}
      title={album.title}
      subtitle={album.artist_name || "Unknown Artist"}
      meta={meta ?? [album.year, pluralize(album.track_count, "song")].filter(Boolean).join(" · ")}
      artworkUrl={artworkUrl}
      fallbackArtworkUrl={cachedArtworkUrl(album.artwork_url)}
      placeholderIcon={Disc3}
      isActive={isActive}
      badge={isActive ? <TileBadge tone="primary"><EqualizerBars className="h-2.5" />Playing</TileBadge> : album.download_state === "downloaded" ? <TileBadge tone="success"><Check className="h-3 w-3" />Offline</TileBadge> : album.download_state === "partial" ? <TileBadge>{album.downloaded_track_count}/{album.track_count}</TileBadge> : null}
      playLabel={`Play ${album.title}`}
      onPlay={() => playAlbumById(album.public_id)}
    />
  );
}

function AlbumListRow({ album, isActive }: { album: LibraryAlbum; isActive: boolean }) {
  const artworkUrl = cachedArtworkUrl(album.artwork_path || album.artwork_url);
  return (
    <article className={cn("group relative flex min-w-0 items-center gap-3 rounded-xl p-2 transition hover:bg-white/[0.06] focus-within:bg-white/[0.06]", isActive && "bg-primary/[0.08]")}>
      <span className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-white/10"><ArtworkImage src={artworkUrl} fallbackSrc={cachedArtworkUrl(album.artwork_url)} alt="" className="h-full w-full object-cover" /></span>
      <Link to={album.canonical_url} className="min-w-0 flex-1 outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-ring">
        <p className={cn("truncate text-sm font-semibold", isActive && "text-primary")}>{album.title}</p>
        <p className="truncate text-xs text-muted-foreground">{album.artist_name || "Unknown Artist"}</p>
      </Link>
      <span className="hidden w-14 shrink-0 text-sm tabular-nums text-muted-foreground sm:block">{album.year || ""}</span>
      <span className="hidden w-20 shrink-0 text-sm text-muted-foreground md:block">{pluralize(album.track_count, "song")}</span>
      <span className={cn("hidden w-24 shrink-0 text-xs font-semibold lg:block", album.download_state === "downloaded" ? "text-emerald-400" : "text-muted-foreground")}>{album.download_state === "downloaded" ? "Offline" : album.download_state === "partial" ? `${album.downloaded_track_count}/${album.track_count} offline` : "Streaming"}</span>
      <button type="button" aria-label={`Play ${album.title}`} title={`Play ${album.title}`} onClick={() => void playAlbumById(album.public_id)} className="relative z-10 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground opacity-100 shadow-glow transition hover:scale-105 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 [@media(hover:none)]:opacity-100">
        {isActive ? <EqualizerBars className="h-3" /> : <Play className="h-4 w-4 translate-x-[1px] fill-current" />}
      </button>
    </article>
  );
}
