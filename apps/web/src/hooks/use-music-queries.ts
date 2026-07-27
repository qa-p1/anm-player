import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { UseQueryOptions, UseMutationOptions } from "@tanstack/react-query";

import * as musicApi from "@/services/music-api";
import type {
  Song,
  Playlist,
  PlaylistDetail,
  DownloadJob,
  HistoryEntry,
  PlaylistAddOnlineTrackRequest,
  PlaylistCreateRequest,
  FavoriteToggleRequest,
  UnifiedAlbum,
} from "@/types/api";

// Query Keys
export const musicKeys = {
  all: ["music"] as const,
  
  // Songs
  songs: () => [...musicKeys.all, "songs"] as const,
  songsAll: () => [...musicKeys.songs(), "all"] as const,
  song: (id: number) => [...musicKeys.songs(), "detail", id] as const,
  songsSearchAll: (query: string) => [...musicKeys.songs(), "search-all", { query }] as const,
  songsFavorites: (limit: number, offset: number) => [...musicKeys.songs(), "favorites", { limit, offset }] as const,
  historyRecentlyPlayed: (limit: number) => [...musicKeys.all, "history", "recently-played", { limit }] as const,
  historyMostPlayed: (limit: number) => [...musicKeys.all, "history", "most-played", { limit }] as const,
  
  // Artists
  artists: () => [...musicKeys.all, "artists"] as const,
  artist: (id: number) => [...musicKeys.artists(), "detail", id] as const,
  artistsFavorites: (limit: number, offset: number) => [...musicKeys.artists(), "favorites", { limit, offset }] as const,
  
  // Albums
  albums: () => [...musicKeys.all, "albums"] as const,
  album: (id: number) => [...musicKeys.albums(), "detail", id] as const,
  unifiedAlbum: (id: string) => [...musicKeys.albums(), "unified", id] as const,
  albumsFavorites: (limit: number, offset: number) => [...musicKeys.albums(), "favorites", { limit, offset }] as const,
  
  // Playlists
  playlists: () => [...musicKeys.all, "playlists"] as const,
  playlistsAll: () => [...musicKeys.playlists(), "all"] as const,
  playlist: (id: number) => [...musicKeys.playlists(), "detail", id] as const,
  
  // Downloads
  downloads: () => [...musicKeys.all, "downloads"] as const,
  downloadsList: () => [...musicKeys.downloads(), "list"] as const,
} as const;

// ============================================================================
// SONGS HOOKS
// ============================================================================

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

// ============================================================================
// PLAYLISTS HOOKS
// ============================================================================

export function useAllPlaylists(options?: Omit<UseQueryOptions<Playlist[]>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: musicKeys.playlistsAll(),
    queryFn: ({ signal }) => musicApi.listAllPlaylists(signal),
    ...options,
  });
}

// ============================================================================
// DOWNLOADS HOOKS
// ============================================================================

export function useDownloads(options?: Omit<UseQueryOptions<DownloadJob[]>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: musicKeys.downloadsList(),
    queryFn: ({ signal }) => musicApi.listAllDownloads(signal),
    // Refetch downloads more frequently
    refetchInterval: 2000,
    ...options,
  });
}

// ============================================================================
// MUTATIONS
// ============================================================================

export function useCreatePlaylist(options?: UseMutationOptions<Playlist, Error, PlaylistCreateRequest>) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: musicApi.createPlaylist,
    onSuccess: () => {
      // Invalidate playlists list
      queryClient.invalidateQueries({ queryKey: musicKeys.playlists() });
    },
    ...options,
  });
}

export function useToggleFavorite(options?: UseMutationOptions<{ is_favorited: boolean }, Error, FavoriteToggleRequest>) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: musicApi.toggleFavorite,
    onSuccess: (_, variables) => {
      // Invalidate relevant queries based on entity type
      if (variables.entity_type === "song") {
        queryClient.invalidateQueries({ queryKey: musicKeys.songsFavorites(50, 0) });
        queryClient.invalidateQueries({ queryKey: musicKeys.song(variables.entity_id) });
      } else if (variables.entity_type === "album") {
        queryClient.invalidateQueries({ queryKey: musicKeys.albumsFavorites(50, 0) });
        queryClient.invalidateQueries({ queryKey: musicKeys.album(variables.entity_id) });
      } else if (variables.entity_type === "artist") {
        queryClient.invalidateQueries({ queryKey: musicKeys.artistsFavorites(50, 0) });
        queryClient.invalidateQueries({ queryKey: musicKeys.artist(variables.entity_id) });
      }
    },
    ...options,
  });
}

export function useAddSongsToPlaylist(options?: UseMutationOptions<PlaylistDetail, Error, { playlistId: number; songIds: number[] }>) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ playlistId, songIds }) => 
      musicApi.addSongsToPlaylist(playlistId, { song_ids: songIds }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: musicKeys.playlist(variables.playlistId) });
      queryClient.invalidateQueries({ queryKey: musicKeys.playlists() });
    },
    ...options,
  });
}

export function useUnifiedAlbum(albumId: string, options?: Omit<UseQueryOptions<UnifiedAlbum>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: musicKeys.unifiedAlbum(albumId),
    queryFn: ({ signal }) => musicApi.getUnifiedAlbum(albumId, signal),
    ...options,
  });
}

export function useAddOnlineTrackToPlaylist(options?: UseMutationOptions<PlaylistDetail, Error, { playlistId: number; track: PlaylistAddOnlineTrackRequest }>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ playlistId, track }) => musicApi.addOnlineTrackToPlaylist(playlistId, track),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: musicKeys.playlist(variables.playlistId) });
      queryClient.invalidateQueries({ queryKey: musicKeys.playlists() });
    },
    ...options,
  });
}

export function useRemoveSongFromPlaylist(options?: UseMutationOptions<PlaylistDetail, Error, { playlistId: number; songId: number }>) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ playlistId, songId }) => musicApi.removeSongFromPlaylist(playlistId, songId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: musicKeys.playlist(variables.playlistId) });
      queryClient.invalidateQueries({ queryKey: musicKeys.playlists() });
    },
    ...options,
  });
}
