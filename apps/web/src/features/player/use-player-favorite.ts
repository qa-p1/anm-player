import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { toast } from "@/components/ui/toast";
import { useFavorites, useToggleFavorite } from "@/hooks/use-music-queries";
import { toggleOnlineTrackFavorite } from "@/services/music-api";
import { musicKeys } from "@/services/music-keys";
import { onlineTrackRequest } from "@/services/playlist-tracks";
import type { PlayerTrack } from "@/types/player";

/** Both player views and song menus read the same favorite cache, including after reopening. */
export function usePlayerFavorite(track: PlayerTrack | null) {
  const mutation = useToggleFavorite();
  const queryClient = useQueryClient();
  const [isSavingOnline, setIsSavingOnline] = useState(false);
  const { data: favorites } = useFavorites({ enabled: Boolean(track) });
  const canFavorite = Boolean(track);
  const isFavorited = !track ? false
    : track.source === "youtube"
      ? Boolean(favorites?.library_tracks.some((item) => item.source === "youtube" && item.external_id === track.videoId))
      : favorites
        ? track.localKind === "song"
          ? favorites.songs.some((song) => song.id === track.songId)
          : favorites.library_tracks.some((item) => item.id === track.libraryTrackId)
        : track.localKind === "song"
          ? Boolean(track.rawSong?.is_favorited)
          : Boolean(track.rawLibraryTrack?.is_favorited);
  const isUpdating = mutation.isPending || isSavingOnline;

  async function toggleFavorite() {
    if (!track || isUpdating) return;
    try {
      let liked: boolean;
      if (track.source === "youtube") {
        setIsSavingOnline(true);
        liked = (await toggleOnlineTrackFavorite(onlineTrackRequest(track))).is_favorited;
        await queryClient.invalidateQueries({ queryKey: musicKeys.all });
      } else {
        liked = (await mutation.mutateAsync(track.localKind === "song"
          ? { entity_type: "song", entity_id: track.songId }
          : { entity_type: "library_track", entity_id: track.libraryTrackId })).is_favorited;
      }
      toast(liked ? "Added to favorites" : "Removed from favorites", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Failed to update favorite", "error");
    } finally {
      setIsSavingOnline(false);
    }
  }

  return { canFavorite, isFavorited, isUpdating, toggleFavorite };
}
