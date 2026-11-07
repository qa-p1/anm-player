import { musicKeys } from "@/services/music-keys";
import { motion } from "framer-motion";
import { Disc } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";

import { pageTransition } from "@/animations/page-motion";
import { EmptyState } from "@/components/empty-states/empty-state";
import { BackButton } from "@/components/navigation/back-button";
import { ArtworkImage } from "@/components/cards/artwork-image";
import { cachedArtworkUrl } from "@/services/api-client";
import { useQuery } from "@tanstack/react-query";

import { CollectionBrowser } from "@/components/filters/collection-browser";
import { Button } from "@/components/ui/button";
import { listAllLibraryAlbums } from "@/services/music-api";
import type { LibraryAlbum } from "@/types/api";
import { cn } from "@/lib/utils";

export function AlbumsLibraryPage() {
  const { data: albums = [], isLoading, error, refetch } = useQuery({ queryKey: musicKeys.libraryAlbums("all"), queryFn: ({ signal }) => listAllLibraryAlbums(undefined, signal) });
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("name");
  const [offlineOnly, setOfflineOnly] = useState(false);
  const term = query.trim().toLocaleLowerCase();
  const visible = albums.filter((album) => (!offlineOnly || album.download_state === "downloaded") && `${album.title} ${album.artist_name || ""}`.toLocaleLowerCase().includes(term))
    .sort((a, b) => sort === "year" ? (b.year ?? 0) - (a.year ?? 0) : (sort === "artist" ? a.artist_name || "" : a.title).localeCompare(sort === "artist" ? b.artist_name || "" : b.title, undefined, { sensitivity: "base", numeric: true }));

  return (
    <motion.div {...pageTransition} className="mx-auto max-w-7xl space-y-8 px-3 py-4 sm:px-6 lg:px-8 lg:py-7">
      <section>
        <BackButton fallback="/library" />
        <p className="mb-2 text-sm font-semibold text-primary">Albums</p>
        <h1 className="text-4xl font-black tracking-normal sm:text-5xl">Your album collection</h1>
        <p className="mt-4 text-base text-muted-foreground">{albums.length} {albums.length === 1 ? "album" : "albums"} in your library</p>
      </section>
      <CollectionBrowser label="albums" query={query} onQueryChange={setQuery} sort={sort} onSortChange={setSort} options={[{ value: "name", label: "Title" }, { value: "artist", label: "Artist" }, { value: "year", label: "Newest year" }]}><Button size="sm" variant={offlineOnly ? "default" : "glass"} aria-pressed={offlineOnly} onClick={() => setOfflineOnly(!offlineOnly)}>Downloaded only</Button></CollectionBrowser>
      {error && <div role="alert" className="text-sm text-red-400">{error.message}<Button variant="ghost" onClick={() => void refetch()}>Retry</Button></div>}
      <section>
        {isLoading ? <p className="text-center text-muted-foreground">Loading...</p> : albums.length === 0 ? (
          <EmptyState icon={Disc} title="No albums in library" description="Add an online album or scan local music to see it here." />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {visible.map((album) => <AlbumCard key={album.public_id} album={album} />)}
          </div>
        )}
        {!isLoading && albums.length > 0 && visible.length === 0 && <EmptyState icon={Disc} title="No matching albums" description="Try a different search or turn off the download filter." />}
      </section>
    </motion.div>
  );
}

function AlbumCard({ album }: { album: LibraryAlbum }) {
  const navigate = useNavigate();
  const artworkUrl = cachedArtworkUrl(album.artwork_path || album.artwork_url);
  const stateLabel = album.download_state === "downloaded" ? "Downloaded" : album.download_state === "partial" ? "Partially downloaded" : "In library";
  return (
    <button type="button" className="group min-w-0 text-left" onClick={() => navigate(album.canonical_url)}>
      <div className="relative mb-3 aspect-square overflow-hidden rounded-xl bg-white/10 shadow-glass sm:rounded-2xl">
        {artworkUrl ? <ArtworkImage src={artworkUrl} fallbackSrc={cachedArtworkUrl(album.artwork_url)} alt={album.title} className="h-full w-full object-cover transition group-hover:scale-105" /> : <div className="grid h-full place-items-center"><Disc className="h-12 w-12 text-muted-foreground" /></div>}
      </div>
      <h3 className="truncate text-sm font-bold">{album.title}</h3>
      <p className="mt-1 truncate text-sm text-muted-foreground">{album.artist_name || "Unknown Artist"}</p>
      <p className={cn("mt-1 truncate text-xs", album.download_state === "downloaded" ? "font-semibold text-emerald-400" : "text-muted-foreground")}>{album.year || "Unknown"} · {album.track_count} songs · {stateLabel}</p>
    </button>
  );
}
