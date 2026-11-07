import { motion } from "framer-motion";
import { Disc3, Heart, ListMusic, Mic2, Search, X } from "lucide-react";
import { useMemo, useState } from "react";

import { pageTransition } from "@/animations/page-motion";
import { CollectionActions } from "@/components/cards/collection-actions";
import { SongCard } from "@/components/cards/song-card";
import { TrackRow } from "@/components/cards/track-row";
import { CollectionHero } from "@/components/collection/collection-hero";
import { GeneratedCover, MosaicArtwork } from "@/components/collection/collection-parts";
import { MediaTile } from "@/components/collection/media-tile";
import { EmptyState } from "@/components/empty-states/empty-state";
import { BackButton } from "@/components/navigation/back-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { playAlbumById, playPlaylistById } from "@/features/library/collection-playback";
import { useFavorites } from "@/hooks/use-music-queries";
import { cn } from "@/lib/utils";
import { cachedArtworkUrl } from "@/services/api-client";
import type { FavoritesResponse } from "@/types/api";
import { libraryTrackToPlayerTrack, songToPlayerTrack } from "@/types/player";
import { matchesTrack } from "@/utils/track-collection";

const EMPTY_FAVORITES: FavoritesResponse = {
  songs: [], artists: [], albums: [], playlists: [], library_albums: [], library_tracks: [],
};
const FAVORITES_TINT = "rgb(232, 52, 96)";

type Tab = "all" | "songs" | "albums" | "artists" | "playlists";

export function FavoritesPage() {
  const { data: favorites = EMPTY_FAVORITES, isLoading, error, refetch } = useFavorites();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const term = query.trim().toLocaleLowerCase();
  const matches = (title: string, subtitle?: string | null) => `${title} ${subtitle || ""}`.toLocaleLowerCase().includes(term);

  const songs = favorites.songs.filter((song) => matchesTrack(songToPlayerTrack(song), query));
  const savedTracks = favorites.library_tracks.filter((track) => matchesTrack(libraryTrackToPlayerTrack(track), query));
  const context = useMemo(() => [...songs.map(songToPlayerTrack), ...savedTracks.map(libraryTrackToPlayerTrack)], [songs, savedTracks]);
  const albums = [
    ...favorites.library_albums.filter((item) => matches(item.title, item.artist_name)).map((album) => ({ key: `l${album.id}`, title: album.title, subtitle: album.artist_name, artwork: album.artwork_path || album.artwork_url, fallback: album.artwork_url, href: album.canonical_url, publicId: album.public_id as string | null })),
    ...favorites.albums.filter((item) => matches(item.title, item.artist_name)).map((album) => ({ key: `a${album.id}`, title: album.title, subtitle: album.artist_name, artwork: album.artwork_path || album.artwork_url, fallback: album.artwork_url, href: album.public_id ? `/albums/${album.public_id}` : "/library/albums", publicId: album.public_id })),
  ];
  const artists = favorites.artists.filter((item) => matches(item.name));
  const playlists = favorites.playlists.filter((item) => matches(item.name));
  const total = Object.values(favorites).reduce((count, items) => count + items.length, 0);
  const counts: Record<Tab, number> = { all: context.length + albums.length + artists.length + playlists.length, songs: context.length, albums: albums.length, artists: artists.length, playlists: playlists.length };
  const tabs = (["all", "songs", "albums", "artists", "playlists"] as const).filter((value) => value === "all" || counts[value] > 0);
  const show = (value: Tab) => tab === "all" || tab === value;
  const covers = context.slice(0, 24).map((track) => track.artworkUrl);

  return (
    <motion.div {...pageTransition} className="mx-auto max-w-7xl space-y-6 px-3 py-4 sm:px-6 lg:px-8 lg:py-7">
      <BackButton fallback="/library" />
      <CollectionHero kind="Favorites" title="Favorites" tint={FAVORITES_TINT} artworkUrl={null} artwork={<MosaicArtwork urls={covers} icon={Heart} gradient="bg-[radial-gradient(circle_at_30%_20%,hsl(var(--primary)),transparent_65%),linear-gradient(135deg,hsl(var(--primary)/0.85),hsl(var(--accent)/0.7))]" />}>
        <CollectionActions tracks={context} name="Favorites" disabled={isLoading} />
      </CollectionHero>

      {error && <div role="alert" className="flex items-center gap-2 text-sm text-red-400">{error.message}<Button variant="ghost" onClick={() => void refetch()}>Retry</Button></div>}

      {total > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div role="group" aria-label="Favorite types" className="no-scrollbar flex w-fit max-w-full overflow-x-auto rounded-full border border-white/10 bg-white/[0.04] p-1">
            {tabs.map((value) => (
              <button key={value} type="button" aria-pressed={tab === value} onClick={() => setTab(value)} className={cn("shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold capitalize text-muted-foreground transition hover:text-foreground", tab === value && "bg-foreground text-background hover:text-background")}>
                {value}{value !== "all" && <span className="ml-1.5 opacity-60">{counts[value]}</span>}
              </button>
            ))}
          </div>
          <div className="relative min-w-0 flex-1 sm:max-w-sm sm:ml-auto">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input aria-label="Search favorites" placeholder="Search favorites" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setQuery(""); }} className="h-10 pl-9 pr-10 text-sm" />
            {query && <button type="button" aria-label="Clear favorites search" onClick={() => setQuery("")} className="absolute right-1 top-1 grid h-8 w-8 place-items-center rounded-full hover:bg-white/10"><X className="h-4 w-4" /></button>}
          </div>
        </div>
      )}

      {isLoading ? (
        <div role="status" aria-label="Loading favorites" className="space-y-1">{Array.from({ length: 8 }).map((_, index) => <div key={index} className="h-14 animate-pulse rounded-xl bg-white/[0.04]" />)}</div>
      ) : total === 0 ? (
        <EmptyState icon={Heart} title="No favorites yet" description="Tap the heart on any song, album, artist or playlist." />
      ) : counts.all === 0 ? (
        <EmptyState icon={Heart} title="No matching favorites" description="Try another name." />
      ) : (
        <div className="space-y-8">
          {show("songs") && context.length > 0 && (
            <section aria-label="Favorite songs" className="space-y-3">
              {tab === "all" && <h2 className="text-xl font-bold tracking-tight">Songs</h2>}
              <div className="rounded-[1.6rem] border border-white/[0.06] bg-card/30 p-2 sm:p-3">
                {songs.map((song, index) => <SongCard key={`s${song.id}`} song={song} playerContext={context} showAlbum variant="list" number={index + 1} />)}
                {savedTracks.map((track, index) => <TrackRow key={`t${track.id}`} variant="list" number={songs.length + index + 1} track={libraryTrackToPlayerTrack(track)} context={context} explicit={track.explicit} isDownloaded={track.is_downloaded} />)}
              </div>
            </section>
          )}
          {show("albums") && albums.length > 0 && (
            <TileSection title={tab === "all" ? "Albums" : null}>
              {albums.map((album) => <MediaTile key={album.key} href={album.href} title={album.title} subtitle={album.subtitle || undefined} artworkUrl={cachedArtworkUrl(album.artwork)} fallbackArtworkUrl={cachedArtworkUrl(album.fallback)} placeholderIcon={Disc3} onPlay={album.publicId ? () => playAlbumById(album.publicId!) : undefined} />)}
            </TileSection>
          )}
          {show("artists") && artists.length > 0 && (
            <TileSection title={tab === "all" ? "Artists" : null}>
              {artists.map((artist) => <MediaTile key={artist.id} shape="circle" href={`/library/artists/${artist.id}`} title={artist.name} subtitle={`${artist.song_count} ${artist.song_count === 1 ? "song" : "songs"}`} artworkUrl={cachedArtworkUrl(artist.artwork_path || artist.artwork_url)} fallbackArtworkUrl={cachedArtworkUrl(artist.artwork_url)} placeholderIcon={Mic2} />)}
            </TileSection>
          )}
          {show("playlists") && playlists.length > 0 && (
            <TileSection title={tab === "all" ? "Playlists" : null}>
              {playlists.map((playlist) => <MediaTile key={playlist.id} href={`/library/playlists/${playlist.id}`} title={playlist.name} subtitle={`${playlist.song_count} ${playlist.song_count === 1 ? "song" : "songs"}`} artworkUrl={cachedArtworkUrl(playlist.artwork_path)} placeholder={<GeneratedCover name={playlist.name} />} placeholderIcon={ListMusic} onPlay={playlist.song_count > 0 ? () => playPlaylistById(playlist.id) : undefined} />)}
            </TileSection>
          )}
        </div>
      )}
    </motion.div>
  );
}

function TileSection({ title, children }: { title: string | null; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      {title && <h2 className="text-xl font-bold tracking-tight">{title}</h2>}
      <div className="-mx-2 grid grid-cols-2 gap-1 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">{children}</div>
    </section>
  );
}
