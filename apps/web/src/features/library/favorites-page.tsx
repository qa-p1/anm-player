import { motion } from "framer-motion";
import { Heart } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { pageTransition } from "@/animations/page-motion";
import { SongCard } from "@/components/cards/song-card";
import { ArtworkImage } from "@/components/cards/artwork-image";
import { TrackRow } from "@/components/cards/track-row";
import { EmptyState } from "@/components/empty-states/empty-state";
import { BackButton } from "@/components/navigation/back-button";
import { cachedArtworkUrl } from "@/services/api-client";
import { useFavorites } from "@/hooks/use-music-queries";
import { CollectionActions } from "@/components/cards/collection-actions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { matchesTrack } from "@/utils/track-collection";
import type { PlayerTrack } from "@/types/player";
import type { FavoritesResponse, LibraryTrack } from "@/types/api";
import { libraryTrackToPlayerTrack, songToPlayerTrack } from "@/types/player";

const EMPTY_FAVORITES: FavoritesResponse = {
  songs: [], artists: [], albums: [], playlists: [], library_albums: [], library_tracks: [],
};

export function FavoritesPage() {
  const { data: favorites = EMPTY_FAVORITES, isLoading, error, refetch } = useFavorites();
  const [query, setQuery] = useState("");
  const total = Object.values(favorites).reduce((count, items) => count + items.length, 0);
  const songs = favorites.songs.filter((song) => matchesTrack(songToPlayerTrack(song), query));
  const savedTracks = favorites.library_tracks.filter((track) => matchesTrack(libraryTrackToPlayerTrack(track), query));
  const context = [...songs.map(songToPlayerTrack), ...savedTracks.map(libraryTrackToPlayerTrack)];
  const term = query.trim().toLocaleLowerCase();
  const matches = (title: string, subtitle?: string | null) => `${title} ${subtitle || ""}`.toLocaleLowerCase().includes(term);

  const matchingLinks = favorites.artists.filter((item) => matches(item.name)).length + favorites.albums.filter((item) => matches(item.title, item.artist_name)).length
    + favorites.library_albums.filter((item) => matches(item.title, item.artist_name)).length + favorites.playlists.filter((item) => matches(item.name)).length;

  return (
    <motion.div {...pageTransition} className="mx-auto max-w-7xl space-y-8 px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
      <section>
        <BackButton fallback="/library" />
        <p className="mb-2 text-sm font-semibold text-primary">Favorites</p>
        <h1 className="text-4xl font-black tracking-normal sm:text-5xl">Everything you love</h1>
        <p className="mt-4 text-muted-foreground">{total} favorite {total === 1 ? "item" : "items"}</p>
      </section>

      <Input aria-label="Search favorites" placeholder="Search your favorites…" value={query} onChange={(event) => setQuery(event.target.value)} />
      {query && <Button size="sm" variant="ghost" onClick={() => setQuery("")}>Clear favorites search</Button>}
      {!isLoading && total > 0 && context.length + matchingLinks === 0 && <EmptyState icon={Heart} title="No matching favorites" description="Try another song, artist, album, or playlist name." />}
      <CollectionActions tracks={context} name="Favorites" disabled={isLoading} />
      {error && <div role="alert" className="text-sm text-red-400">{error.message}<Button variant="ghost" onClick={() => void refetch()}>Retry</Button></div>}
      {isLoading ? <p className="text-center text-muted-foreground">Loading...</p> : total === 0 ? (
        <EmptyState icon={Heart} title="No favorites yet" description="Use the heart action on songs, artists, albums, playlists, or saved music." />
      ) : (
        <>
          {songs.length > 0 && <FavoriteSection title="Songs">{songs.map((song) => <SongCard key={song.id} song={song} playerContext={context} showAlbum />)}</FavoriteSection>}
          {savedTracks.length > 0 && <FavoriteSection title="Saved tracks">{savedTracks.map((track) => <FavoriteLibraryTrack key={track.id} track={track} context={context} />)}</FavoriteSection>}
          <FavoriteLinks title="Artists" items={favorites.artists.filter((item) => matches(item.name)).map((artist) => ({ id: artist.id, title: artist.name, subtitle: `${artist.song_count} songs`, artwork: artist.artwork_path || artist.artwork_url, href: `/library/artists/${artist.id}` }))} />
          <FavoriteLinks title="Albums" items={favorites.albums.filter((item) => matches(item.title, item.artist_name)).map((album) => ({ id: album.id, title: album.title, subtitle: album.artist_name, artwork: album.artwork_path || album.artwork_url, href: album.public_id ? `/albums/${album.public_id}` : "/library/albums" }))} />
          <FavoriteLinks title="Saved albums" items={favorites.library_albums.filter((item) => matches(item.title, item.artist_name)).map((album) => ({ id: album.id, title: album.title, subtitle: album.artist_name, artwork: album.artwork_path || album.artwork_url, href: album.canonical_url }))} />
          <FavoriteLinks title="Playlists" items={favorites.playlists.filter((item) => matches(item.name)).map((playlist) => ({ id: playlist.id, title: playlist.name, subtitle: `${playlist.song_count} songs`, artwork: playlist.artwork_path, href: `/library/playlists/${playlist.id}` }))} />
        </>
      )}
    </motion.div>
  );
}

function FavoriteSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="space-y-3"><h2 className="text-2xl font-bold">{title}</h2><div className="space-y-2">{children}</div></section>;
}

function FavoriteLibraryTrack({ track, context }: { track: LibraryTrack; context: PlayerTrack[] }) {
  const playerTrack = libraryTrackToPlayerTrack(track);
  return <TrackRow track={playerTrack} context={context} isDownloaded={track.is_downloaded} />;
}

function FavoriteLinks({ title, items }: { title: string; items: Array<{ id: number; title: string; subtitle: string | null; artwork: string | null; href: string }> }) {
  if (items.length === 0) return null;
  return <section className="space-y-3"><h2 className="text-2xl font-bold">{title}</h2><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{items.map((item) => <Link key={item.id} to={item.href} className="glass-panel rounded-2xl p-3"><div className="mb-3 aspect-square overflow-hidden rounded-xl bg-white/10"><ArtworkImage src={cachedArtworkUrl(item.artwork)} alt="" className="h-full w-full object-cover" /></div><p className="truncate font-semibold">{item.title}</p><p className="truncate text-xs text-muted-foreground">{item.subtitle}</p></Link>)}</div></section>;
}
