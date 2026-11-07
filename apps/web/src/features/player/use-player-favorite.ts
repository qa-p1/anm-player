import { toast } from "@/components/ui/toast";
import { useFavorites, useToggleFavorite } from "@/hooks/use-music-queries";
import type { PlayerTrack } from "@/types/player";

/** Both player views read the same favorite cache, including after reopening. */
export function usePlayerFavorite(track: PlayerTrack | null) {
  const mutation = useToggleFavorite();
  const { data: favorites } = useFavorites({ enabled: track?.source === "local" });
  const canFavorite = track?.source === "local";
  const isFavorited = track?.source !== "local" ? false
    : favorites
      ? track.localKind === "song"
        ? favorites.songs.some((song) => song.id === track.songId)
        : favorites.library_tracks.some((item) => item.id === track.libraryTrackId)
      : track.localKind === "song"
        ? Boolean(track.rawSong?.is_favorited)
        : Boolean(track.rawLibraryTrack?.is_favorited);

  async function toggleFavorite() {
    if (track?.source !== "local" || mutation.isPending) return;
    try {
      const result = await mutation.mutateAsync(track.localKind === "song"
        ? { entity_type: "song", entity_id: track.songId }
        : { entity_type: "library_track", entity_id: track.libraryTrackId });
      toast(result.is_favorited ? "Added to favorites" : "Removed from favorites", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Failed to update favorite", "error");
    }
  }

  return { canFavorite, isFavorited, isUpdating: mutation.isPending, toggleFavorite };
}
