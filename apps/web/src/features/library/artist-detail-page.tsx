import { motion } from "framer-motion";
import { Heart, Mic, Play, Shuffle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";

import { pageTransition } from "@/animations/page-motion";
import { SongCard } from "@/components/cards/song-card";
import { ArtworkImage } from "@/components/cards/artwork-image";
import { TrackRow } from "@/components/cards/track-row";
import { BackButton } from "@/components/navigation/back-button";
import { Button } from "@/components/ui/button";
import { cachedArtworkUrl } from "@/services/api-client";
import { getArtist, getOnlineArtist, toggleFavorite } from "@/services/music-api";
import { usePlayerStore } from "@/stores/player-store";
import type { ArtistDetail, LibraryArtistDetail, LibraryTrack } from "@/types/api";
import type { PlayerTrack } from "@/types/player";
import { libraryTrackToPlayerTrack, songToPlayerTrack } from "@/types/player";
import { cn } from "@/lib/utils";

export function ArtistDetailPage() {
  const { artistId } = useParams<{ artistId: string }>();
  const location = useLocation();
  const isOnline = location.pathname.includes("/artists/online/");
  const [localArtist, setLocalArtist] = useState<ArtistDetail | null>(null);
  const [onlineArtist, setOnlineArtist] = useState<LibraryArtistDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isFavorited, setIsFavorited] = useState(false);
  const { playAlbum } = usePlayerStore();

  useEffect(() => {
    if (!artistId) return;
    const controller = new AbortController();
    setIsLoading(true);

    const request = isOnline ? getOnlineArtist(artistId, controller.signal) : getArtist(Number(artistId), controller.signal);
    request
      .then((data) => {
        if (controller.signal.aborted) return;
        if (isOnline) {
          setOnlineArtist(data as LibraryArtistDetail);
          setLocalArtist(null);
        } else {
          const artist = data as ArtistDetail;
          setLocalArtist(artist);
          setOnlineArtist(null);
          setIsFavorited(artist.is_favorited);
        }
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.error("Failed to load artist:", error);
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [artistId, isOnline]);

  const view = useMemo(() => {
    if (isOnline && onlineArtist) {
      return {
        name: onlineArtist.name,
        artwork: onlineArtist.thumbnail_url,
        songCount: onlineArtist.track_count,
        albumCount: onlineArtist.album_count,
        albums: onlineArtist.albums,
        localSongs: [],
        onlineTracks: onlineArtist.top_tracks,
      };
    }
    if (!isOnline && localArtist) {
      return {
        name: localArtist.name,
        artwork: localArtist.artwork_path || localArtist.artwork_url,
        songCount: localArtist.song_count,
        albumCount: localArtist.album_count,
        albums: localArtist.albums,
        localSongs: localArtist.top_songs,
        onlineTracks: [],
      };
    }
    return null;
  }, [isOnline, localArtist, onlineArtist]);

  const playerTracks = [
    ...(localArtist?.top_songs.map(songToPlayerTrack) ?? []),
    ...(onlineArtist?.top_tracks.map(libraryTrackToPlayerTrack) ?? []),
  ];

  async function handleToggleFavorite() {
    if (!localArtist) return;
    const result = await toggleFavorite({ entity_type: "artist", entity_id: localArtist.id });
    setIsFavorited(result.is_favorited);
  }

  function handlePlayAll() {
    if (playerTracks.length === 0) return;
    playAlbum(playerTracks, 0);
  }

  function handleShuffle() {
    if (playerTracks.length === 0) return;
    const { toggleShuffle, shuffle } = usePlayerStore.getState();
    if (!shuffle) toggleShuffle();
    playAlbum(playerTracks, 0);
  }

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading...</div>;
  }

  if (!view) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Artist not found</div>;
  }

  const artistArtworkUrl = cachedArtworkUrl(view.artwork);

  return (
    <motion.div {...pageTransition} className="mx-auto max-w-7xl space-y-8 px-3 py-4 sm:px-6 lg:px-8 lg:py-7">
      <BackButton fallback="/library/artists" />
      <section className="flex flex-col gap-5 md:flex-row md:items-end">
        <div className="h-40 w-40 shrink-0 overflow-hidden rounded-full sm:h-48 sm:w-48">
          {artistArtworkUrl ? (
            <ArtworkImage src={artistArtworkUrl} fallbackSrc={cachedArtworkUrl(localArtist?.artwork_url)} alt={view.name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-white/10">
              <Mic className="h-20 w-20 text-muted-foreground" />
            </div>
          )}
        </div>

        <div className="flex-1 space-y-4">
          <div>
            <p className="text-sm font-semibold text-primary">Artist</p>
            <h1 className="break-words text-3xl font-black tracking-normal sm:text-5xl lg:text-6xl">{view.name}</h1>
          </div>

          <p className="text-muted-foreground">
            {view.songCount} {view.songCount === 1 ? "song" : "songs"} · {view.albumCount} {view.albumCount === 1 ? "album" : "albums"}
          </p>

          <div className="flex flex-wrap gap-3">
            <Button onClick={handlePlayAll} disabled={playerTracks.length === 0}>
              <Play className="h-4 w-4 fill-current" />
              Play
            </Button>
            <Button variant="glass" onClick={handleShuffle} disabled={playerTracks.length === 0}>
              <Shuffle className="h-4 w-4" />
              Shuffle
            </Button>
            {!isOnline && (
              <Button variant="glass" onClick={handleToggleFavorite}>
                <Heart className={cn("h-4 w-4", isFavorited && "fill-current text-primary")} />
                {isFavorited ? "Favorited" : "Favorite"}
              </Button>
            )}
          </div>
        </div>
      </section>

      {view.localSongs.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-2xl font-bold">Top Songs</h2>
          <div className="space-y-2">
            {view.localSongs.map((song) => (
              <SongCard key={song.id} song={song} context={view.localSongs} showAlbum />
            ))}
          </div>
        </section>
      )}

      {view.onlineTracks.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-2xl font-bold">Top Songs</h2>
          <div className="space-y-2">
            {view.onlineTracks.map((track, index) => (
              <OnlineTrackRow key={track.id} track={track} index={index} context={playerTracks} />
            ))}
          </div>
        </section>
      )}

      {view.albums.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-2xl font-bold">Albums</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {view.albums.map((album) => {
              const artworkUrl = cachedArtworkUrl(album.artwork_path || ("artwork_url" in album ? album.artwork_url : null));
              const count = "track_count" in album ? album.track_count : album.song_count;
              return (
                <Link key={album.id} to={"canonical_url" in album ? album.canonical_url : album.public_id ? `/albums/${album.public_id}` : "/library/albums"} className="group min-w-0">
                  <div className="mb-3 aspect-square overflow-hidden rounded-xl bg-white/10 shadow-glass sm:rounded-2xl">
                    {artworkUrl ? (
                      <ArtworkImage src={artworkUrl} fallbackSrc={cachedArtworkUrl("artwork_url" in album ? album.artwork_url : null)} alt={album.title} className="h-full w-full object-cover transition group-hover:scale-105" />
                    ) : (
                      <div className="h-full w-full bg-white/10" />
                    )}
                  </div>
                  <h3 className="truncate text-sm font-semibold">{album.title}</h3>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {album.year || "Unknown"} · {count} songs
                  </p>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </motion.div>
  );
}

function OnlineTrackRow({ track, index, context }: { track: LibraryTrack; index: number; context: PlayerTrack[] }) {
  const playerTrack = libraryTrackToPlayerTrack(track);
  return (
    <TrackRow
      track={playerTrack}
      context={context}
      subtitle={`${track.artist_name || "Unknown Artist"}${track.album_title ? ` · ${track.album_title}` : ""}`}
      leading={<span className="hidden w-8 shrink-0 text-center text-sm text-muted-foreground sm:block">{track.track_number ?? index + 1}</span>}
      isDownloaded={track.is_downloaded}
    />
  );
}
