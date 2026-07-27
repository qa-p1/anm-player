import { motion } from "framer-motion";
import { ListMusic, Play, Shuffle, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";

import { pageTransition } from "@/animations/page-motion";
import { BackButton } from "@/components/navigation/back-button";
import { ArtworkImage } from "@/components/cards/artwork-image";
import { SongCard } from "@/components/cards/song-card";
import { TrackRow } from "@/components/cards/track-row";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import {
  deletePlaylist,
  getPlaylist,
  removeLibraryTrackFromPlaylist,
} from "@/services/music-api";
import { cachedArtworkUrl, isRequestCancelled } from "@/services/api-client";
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
  const artworkUrl = cachedArtworkUrl(playlist?.artwork_path);

  useEffect(() => {
    const resolvedPlaylistId = Number(playlistId);
    if (!Number.isSafeInteger(resolvedPlaylistId) || resolvedPlaylistId <= 0) {
      setIsLoading(false);
      return;
    }
    const controller = new AbortController();
    
    getPlaylist(resolvedPlaylistId, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setPlaylist(result);
      })
      .catch((error) => {
        if (!isRequestCancelled(error)) {
          console.error("Failed to load playlist:", error);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [playlistId]);

  function handlePlayAll() {
    if (!playlist) return;
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
      toast(error instanceof Error ? error.message : "Could not delete playlist", "error");
    }
  }

  function reloadPlaylist() {
    const resolvedPlaylistId = Number(playlistId);
    if (!Number.isSafeInteger(resolvedPlaylistId) || resolvedPlaylistId <= 0) return;

    getPlaylist(resolvedPlaylistId)
      .then(setPlaylist)
      .catch((error: unknown) => {
        if (!isRequestCancelled(error)) {
          toast(error instanceof Error ? error.message : "Could not refresh playlist", "error");
        }
      });
  }

  async function removeOnlineTrack(trackId: number) {
    if (!playlist) return;
    try {
      setPlaylist(await removeLibraryTrackFromPlaylist(playlist.id, trackId));
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not remove track", "error");
    }
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
        <div className="h-40 w-40 shrink-0 overflow-hidden rounded-2xl bg-white/10 sm:h-48 sm:w-48 sm:rounded-3xl">
          {artworkUrl ? (
            <ArtworkImage src={artworkUrl} alt={playlist.name} className="h-full w-full object-cover" />
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
          {playlistItems(playlist).map((entry, displayIndex) => {
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
              <OnlinePlaylistTrack
                key={`track-${entry.track.id}-${entry.position}`}
                track={entry.track}
                index={displayIndex}
                context={playlistToPlayerTracks(playlist)}
                onRemove={() => removeOnlineTrack(entry.track!.id)}
              />
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

function OnlinePlaylistTrack({
  track,
  index,
  context,
  onRemove,
}: {
  track: LibraryTrack;
  index: number;
  context: PlayerTrack[];
  onRemove: () => Promise<void>;
}) {
  const playerTrack = libraryTrackToPlayerTrack(track);
  return (
    <TrackRow
      track={playerTrack}
      context={context}
      leading={<span className="hidden w-8 shrink-0 text-center text-sm text-muted-foreground sm:block">{index + 1}</span>}
      isDownloaded={track.is_downloaded}
      onRemoveFromPlaylist={onRemove}
    />
  );
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
