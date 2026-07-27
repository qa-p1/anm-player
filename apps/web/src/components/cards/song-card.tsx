import { useState } from "react";
import { useNavigate } from "react-router";

import { TrackRow } from "@/components/cards/track-row";
import { toast } from "@/components/ui/toast";
import { musicKeys, useRemoveSongFromPlaylist, useToggleFavorite } from "@/hooks/use-music-queries";
import { queryClient } from "@/lib/query-client";
import { enrichSong } from "@/services/music-api";
import type { Song } from "@/types/api";
import type { PlayerTrack } from "@/types/player";
import { songToPlayerTrack } from "@/types/player";

interface SongCardProps {
  song: Song;
  context?: Song[];
  playerContext?: PlayerTrack[];
  showArtist?: boolean;
  showAlbum?: boolean;
  className?: string;
  playlistId?: number;
  onRemoved?: () => void;
}

export function SongCard({
  song,
  context,
  playerContext,
  showArtist = true,
  showAlbum = false,
  className,
  playlistId,
  onRemoved,
}: SongCardProps) {
  const navigate = useNavigate();
  const [isFavorited, setIsFavorited] = useState(song.is_favorited);
  const toggleFavoriteMutation = useToggleFavorite();
  const removeSongMutation = useRemoveSongFromPlaylist();

  const track = songToPlayerTrack(song);
  const contextTracks = playerContext ?? context?.map(songToPlayerTrack);
  async function handleToggleFavorite() {
    try {
      const result = await toggleFavoriteMutation.mutateAsync({ entity_type: "song", entity_id: song.id });
      setIsFavorited(result.is_favorited);
      toast(result.is_favorited ? "Added to favorites" : "Removed from favorites", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Failed to update favorite", "error");
    }
  }

  async function handleRemoveFromPlaylist() {
    if (!playlistId) return;
    try {
      await removeSongMutation.mutateAsync({ playlistId, songId: song.id });
      onRemoved?.();
      toast("Removed from playlist", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Failed to remove song", "error");
    }
  }

  async function handleEnrich() {
    try {
      await enrichSong(song.id);
      await queryClient.invalidateQueries({ queryKey: musicKeys.song(song.id) });
      await queryClient.invalidateQueries({ queryKey: musicKeys.songs() });
      toast("Metadata enriched", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Failed to enrich metadata", "error");
    }
  }

  return (
    <TrackRow
      track={track}
      context={contextTracks}
      subtitle={showArtist ? `${song.artist_name || "Unknown Artist"}${showAlbum && song.album_title ? ` · ${song.album_title}` : ""}` : song.album_title}
      className={className}
      isFavorited={isFavorited}
      onToggleFavorite={handleToggleFavorite}
      onGoToArtist={song.artist_id ? () => navigate(`/library/artists/${song.artist_id}`) : undefined}
      onGoToAlbum={song.album_public_id ? () => navigate(`/albums/${song.album_public_id}`) : undefined}
      onRemoveFromPlaylist={playlistId ? handleRemoveFromPlaylist : undefined}
      onEnrich={handleEnrich}
      isDownloaded={song.is_downloaded}
    />
  );
}
