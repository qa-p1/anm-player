import { invalidatePlaylists } from "@/services/music-invalidation";
import { musicKeys } from "@/services/music-keys";
import { addPlayerTracksToPlaylist } from "@/services/playlist-tracks";
import type { PlayerTrack } from "@/types/player";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { UseQueryOptions, UseMutationOptions } from "@tanstack/react-query";

import * as musicApi from "@/services/music-api";
import { isActiveDownload } from "@/utils/downloads";
import type {
  Song,
  Playlist,
  PlaylistDetail,
  DownloadJob,
  HistoryEntry,
  PlaylistCreateRequest,
  FavoriteToggleRequest,
  UnifiedAlbum,
} from "@/types/api";

export function useAllSongs(options?: Omit<UseQueryOptions<Song[]>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: musicKeys.songsAll(),
    queryFn: ({ signal }) => musicApi.listAllSongs(signal),
    ...options,
  });
}

export function useRecentlyPlayedHistory(limit = 50, options?: Omit<UseQueryOptions<HistoryEntry[]>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: musicKeys.historyRecentlyPlayed(limit),
    queryFn: ({ signal }) => musicApi.getRecentlyPlayedHistory(limit, signal),
    ...options,
  });
}

export function useSearchAllSongs(query: string, options?: Omit<UseQueryOptions<Song[]>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: musicKeys.songsSearchAll(query),
    queryFn: ({ signal }) => musicApi.searchAllSongsLocal(query, signal),
    enabled: query.length > 0,
    ...options,
  });
}

export function useMostPlayedHistory(limit = 50, options?: Omit<UseQueryOptions<HistoryEntry[]>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: musicKeys.historyMostPlayed(limit),
    queryFn: ({ signal }) => musicApi.getMostPlayedHistory(limit, signal),
    ...options,
  });
}


export function useAllPlaylists(options?: Omit<UseQueryOptions<Playlist[]>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: musicKeys.playlistsAll(),
    queryFn: ({ signal }) => musicApi.listAllPlaylists(signal),
    ...options,
  });
}


export function useDownloads(options?: Omit<UseQueryOptions<DownloadJob[]>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: musicKeys.downloadsList(),
    queryFn: ({ signal }) => musicApi.listAllDownloads(signal),
    // Poll quickly only while something is in flight. Actions that create or
    // restart downloads invalidate this query, which resumes fast polling.
    refetchInterval: (query) => (query.state.data?.some(isActiveDownload) ? 2_000 : 15_000),
    ...options,
  });
}


export function useCreatePlaylist(options?: UseMutationOptions<Playlist, Error, PlaylistCreateRequest>) {
  const queryClient = useQueryClient();
  
  return useMutation({
    ...options,
    mutationFn: musicApi.createPlaylist,
    onSuccess: async (...args) => {
      await invalidatePlaylists(queryClient);
      await options?.onSuccess?.(...args);
    },
  });
}

export function useToggleFavorite(options?: UseMutationOptions<{ is_favorited: boolean }, Error, FavoriteToggleRequest>) {
  const queryClient = useQueryClient();
  
  return useMutation({
    ...options,
    mutationFn: musicApi.toggleFavorite,
    onSuccess: async (...args) => {
      await queryClient.invalidateQueries({ queryKey: musicKeys.all });
      await options?.onSuccess?.(...args);
    },
  });
}

export function useAddTracksToPlaylist() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ playlistId, tracks }: { playlistId: number; tracks: PlayerTrack[] }) => addPlayerTracksToPlaylist(playlistId, tracks),
    onSettled: () => invalidatePlaylists(client),
  });
}

export function useUnifiedAlbum(albumId: string, options?: Omit<UseQueryOptions<UnifiedAlbum>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: musicKeys.unifiedAlbum(albumId),
    queryFn: ({ signal }) => musicApi.getUnifiedAlbum(albumId, signal),
    ...options,
  });
}

export function useRemoveSongFromPlaylist(options?: UseMutationOptions<PlaylistDetail, Error, { playlistId: number; songId: number }>) {
  const queryClient = useQueryClient();
  
  return useMutation({
    ...options,
    mutationFn: ({ playlistId, songId }) => musicApi.removeSongFromPlaylist(playlistId, songId),
    onSuccess: async (...args) => {
      await invalidatePlaylists(queryClient);
      await options?.onSuccess?.(...args);
    },
  });
}

export function usePlaylist(id: number) {
  return useQuery({
    queryKey: musicKeys.playlist(id),
    queryFn: ({ signal }) => musicApi.getPlaylist(id, signal),
    enabled: Number.isSafeInteger(id) && id > 0,
  });
}

export function useFavorites(options?: { enabled?: boolean }) {
  return useQuery({ queryKey: musicKeys.favorites(), queryFn: ({ signal }) => musicApi.listFavorites(signal), ...options });
}
