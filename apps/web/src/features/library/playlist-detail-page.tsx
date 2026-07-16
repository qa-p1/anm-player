import { motion } from "framer-motion";
import { ListMusic, Play, Shuffle, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { pageTransition } from "@/animations/page-motion";
import { BackButton } from "@/components/navigation/back-button";
import { SongCard } from "@/components/cards/song-card";
import { TrackRow } from "@/components/cards/track-row";
import { Button } from "@/components/ui/button";
import { deletePlaylist, getPlaylist } from "@/services/music-api";
import { upgradeArtworkUrl } from "@/services/api-client";
import { usePlayerStore } from "@/stores/player-store";
import type { LibraryTrack, PlaylistDetail } from "@/types/api";
import type { PlayerTrack } from "@/types/player";
import { libraryTrackToPlayerTrack, songToPlayerTrack } from "@/types/player";
import { formatDuration } from "@/utils/format";

export function PlaylistDetailPage() {
  const { playlistId } = useParams<{ playlistId: string }>();
  const navigate = useNavigate();
  const [playlist, setPlaylist] = useState<PlaylistDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { playPlaylist } = usePlayerStore();
  const artworkUrl = upgradeArtworkUrl(playlist?.artwork_path);

  useEffect(() => {
    if (!playlistId) return;

    const controller = new AbortController();
    
    getPlaylist(parseInt(playlistId), controller.signal)
      .then(setPlaylist)
      .catch((error) => {
        if (error.name !== "AbortError") {
          console.error("Failed to load playlist:", error);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [playlistId]);

  function handlePlayAll() {
    if (!playlist || playlist.songs.length === 0) return;
    const tracks = playlistToPlayerTracks(playlist);
    if (tracks.length === 0) return;
    playPlaylist(tracks, 0);
  }

  function handleShuffle() {
    if (!playlist) return;
    const tracks = playlistToPlayerTracks(playlist);
    if (tracks.length === 0) return;
    const { toggleShuffle, shuffle } = usePlayerStore.getState();
    if (!shuffle) toggleShuffle();
    playPlaylist(tracks, 0);
  }

  async function handleDelete() {
    if (!playlist) return;
    
    if (!confirm(`Delete playlist "${playlist.name}"?`)) return;

    try {
      await deletePlaylist(playlist.id);
      navigate("/library/playlists");
    } catch (error) {
      console.error("Failed to delete playlist:", error);
      alert("Failed to delete playlist");
    }
  }

  function reloadPlaylist() {
    if (!playlistId) return;
    
    getPlaylist(parseInt(playlistId))
      .then(setPlaylist)
      .catch(console.error);
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!playlist) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Playlist not found</p>
      </div>
    );
  }

  return (
    <motion.div {...pageTransition} className="mx-auto max-w-7xl space-y-8 px-3 py-4 sm:px-6 lg:px-8 lg:py-7">
      <BackButton fallback="/library/playlists" />
      <section className="flex flex-col gap-5 md:flex-row md:items-end">
        <div className="h-40 w-40 shrink-0 overflow-hidden rounded-2xl sm:h-48 sm:w-48 sm:rounded-3xl">
          {artworkUrl ? (
            <img src={artworkUrl} alt={playlist.name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-white/10">
              <ListMusic className="h-20 w-20 text-muted-foreground" />
            </div>
          )}
        </div>

        <div className="flex-1 space-y-4">
          <div>
            <p className="text-sm font-semibold text-primary">Playlist</p>
            <h1 className="break-words text-3xl font-black tracking-normal sm:text-5xl lg:text-6xl">{playlist.name}</h1>
            {playlist.description && (
              <p className="mt-2 text-muted-foreground">{playlist.description}</p>
            )}
          </div>

          <p className="text-sm text-muted-foreground sm:text-base">
            {playlist.song_count} {playlist.song_count === 1 ? "song" : "songs"}
            {playlist.duration_seconds && ` · ${formatDuration(playlist.duration_seconds)}`}
          </p>

          <div className="flex flex-wrap gap-3">
            <Button onClick={handlePlayAll} disabled={playlistToPlayerTracks(playlist).length === 0}>
              <Play className="h-4 w-4 fill-current" />
              Play
            </Button>
            <Button variant="glass" onClick={handleShuffle} disabled={playlistToPlayerTracks(playlist).length === 0}>
              <Shuffle className="h-4 w-4" />
              Shuffle
            </Button>
            <Button variant="glass" onClick={handleDelete}>
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          </div>
        </div>
      </section>

      {playlistItems(playlist).length > 0 && (
        <section className="space-y-2">
          {playlistItems(playlist).map((entry) => {
            if (entry.item_type === "song" && entry.song) {
              return (
                <SongCard
                  key={`song-${entry.song.id}-${entry.position}`}
                  song={entry.song}
                  playerContext={playlistToPlayerTracks(playlist)}
                  showAlbum
                  showArtist
                  playlistId={playlist.id}
                  onRemoved={reloadPlaylist}
                />
              );
            }
            return entry.track ? (
              <OnlinePlaylistTrack key={`track-${entry.track.id}-${entry.position}`} track={entry.track} index={entry.position} context={playlistToPlayerTracks(playlist)} />
            ) : null;
          })}
        </section>
      )}

      {playlist.songs.length === 0 && (playlist.library_tracks ?? []).length === 0 && (
        <div className="glass-panel rounded-3xl p-8 text-center">
          <p className="text-muted-foreground">This playlist is empty</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Add songs from the library by clicking the menu button on any song
          </p>
        </div>
      )}
    </motion.div>
  );
}

function OnlinePlaylistTrack({ track, index, context }: { track: LibraryTrack; index: number; context: PlayerTrack[] }) {
  const playerTrack = libraryTrackToPlayerTrack(track);
  return <TrackRow track={playerTrack} context={context} leading={<span className="hidden w-8 shrink-0 text-center text-sm text-muted-foreground sm:block">{index + 1}</span>} isDownloaded={track.is_downloaded} />;
}

function playlistToPlayerTracks(playlist: PlaylistDetail): PlayerTrack[] {
  return playlistItems(playlist)
    .map((entry) => entry.song ? songToPlayerTrack(entry.song) : entry.track ? libraryTrackToPlayerTrack(entry.track) : null)
    .filter((track): track is PlayerTrack => Boolean(track));
}

function playlistItems(playlist: PlaylistDetail) {
  if (playlist.items) return playlist.items;
  return [
    ...playlist.songs.map((song, position) => ({ item_type: "song" as const, position, song, track: null })),
    ...(playlist.library_tracks ?? []).map((entry) => ({
      item_type: "library_track" as const,
      position: entry.position,
      song: null,
      track: entry.track,
    })),
  ].sort((left, right) => left.position - right.position);
}
