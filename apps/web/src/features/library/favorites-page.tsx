import { motion } from "framer-motion";
import { Heart } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { pageTransition } from "@/animations/page-motion";
import { SongCard } from "@/components/cards/song-card";
import { ArtworkImage } from "@/components/cards/artwork-image";
import { TrackRow } from "@/components/cards/track-row";
import { EmptyState } from "@/components/empty-states/empty-state";
import { BackButton } from "@/components/navigation/back-button";
import { cachedArtworkUrl } from "@/services/api-client";
import { listFavorites } from "@/services/music-api";
import type { FavoritesResponse, LibraryTrack } from "@/types/api";
import { libraryTrackToPlayerTrack } from "@/types/player";

const EMPTY_FAVORITES: FavoritesResponse = {
  songs: [], artists: [], albums: [], playlists: [], library_albums: [], library_tracks: [],
};

export function FavoritesPage() {
  const [favorites, setFavorites] = useState<FavoritesResponse>(EMPTY_FAVORITES);
  const [isLoading, setIsLoading] = useState(true);
  const total = Object.values(favorites).reduce((count, items) => count + items.length, 0);

  useEffect(() => {
    const controller = new AbortController();
    listFavorites(controller.signal)
      .then(setFavorites)
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) console.error("Failed to load favorites:", error);
      })
      .finally(() => { if (!controller.signal.aborted) setIsLoading(false); });
    return () => controller.abort();
  }, []);

  return (
    <motion.div {...pageTransition} className="mx-auto max-w-7xl space-y-8 px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
      <section>
        <BackButton fallback="/library" />
        <p className="mb-2 text-sm font-semibold text-primary">Favorites</p>
        <h1 className="text-4xl font-black tracking-normal sm:text-5xl">Everything you love</h1>
        <p className="mt-4 text-muted-foreground">{total} favorite {total === 1 ? "item" : "items"}</p>
      </section>

      {isLoading ? <p className="text-center text-muted-foreground">Loading...</p> : total === 0 ? (
        <EmptyState icon={Heart} title="No favorites yet" description="Use the heart action on songs, artists, albums, playlists, or saved music." />
      ) : (
        <>
          {favorites.songs.length > 0 && <FavoriteSection title="Songs">{favorites.songs.map((song) => <SongCard key={song.id} song={song} context={favorites.songs} showAlbum />)}</FavoriteSection>}
          {favorites.library_tracks.length > 0 && <FavoriteSection title="Saved tracks">{favorites.library_tracks.map((track) => <FavoriteLibraryTrack key={track.id} track={track} />)}</FavoriteSection>}
          <FavoriteLinks title="Artists" items={favorites.artists.map((artist) => ({ id: artist.id, title: artist.name, subtitle: `${artist.song_count} songs`, artwork: artist.artwork_path || artist.artwork_url, href: `/library/artists/${artist.id}` }))} remoteArtwork />
          <FavoriteLinks title="Albums" items={favorites.albums.map((album) => ({ id: album.id, title: album.title, subtitle: album.artist_name, artwork: album.artwork_path || album.artwork_url, href: album.public_id ? `/albums/${album.public_id}` : "/library/albums" }))} remoteArtwork />
          <FavoriteLinks title="Saved albums" items={favorites.library_albums.map((album) => ({ id: album.id, title: album.title, subtitle: album.artist_name, artwork: album.artwork_path || album.artwork_url, href: album.canonical_url }))} remoteArtwork />
          <FavoriteLinks title="Playlists" items={favorites.playlists.map((playlist) => ({ id: playlist.id, title: playlist.name, subtitle: `${playlist.song_count} songs`, artwork: playlist.artwork_path, href: `/library/playlists/${playlist.id}` }))} />
        </>
      )}
    </motion.div>
  );
}

function FavoriteSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="space-y-3"><h2 className="text-2xl font-bold">{title}</h2><div className="space-y-2">{children}</div></section>;
}

function FavoriteLibraryTrack({ track }: { track: LibraryTrack }) {
  const playerTrack = libraryTrackToPlayerTrack(track);
  return <TrackRow track={playerTrack} isDownloaded={track.is_downloaded} />;
}

function FavoriteLinks({ title, items }: { title: string; items: Array<{ id: number; title: string; subtitle: string | null; artwork: string | null; href: string }>; remoteArtwork?: boolean }) {
  if (items.length === 0) return null;
  return <section className="space-y-3"><h2 className="text-2xl font-bold">{title}</h2><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{items.map((item) => <Link key={item.id} to={item.href} className="glass-panel rounded-2xl p-3"><div className="mb-3 aspect-square overflow-hidden rounded-xl bg-white/10"><ArtworkImage src={cachedArtworkUrl(item.artwork)} alt="" className="h-full w-full object-cover" /></div><p className="truncate font-semibold">{item.title}</p><p className="truncate text-xs text-muted-foreground">{item.subtitle}</p></Link>)}</div></section>;
}
