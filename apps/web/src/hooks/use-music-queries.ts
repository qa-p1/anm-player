import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { UseQueryOptions, UseMutationOptions } from "@tanstack/react-query";

import * as musicApi from "@/services/music-api";
import type {
  Song,
  Album,
  Artist,
  Playlist,
  PlaylistDetail,
  AlbumDetail,
  ArtistDetail,
  DownloadJob,
  DownloadCreateRequest,
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
  songsList: (limit: number, offset: number) => [...musicKeys.songs(), "list", { limit, offset }] as const,
  song: (id: number) => [...musicKeys.songs(), "detail", id] as const,
  songsSearch: (query: string, limit: number) => [...musicKeys.songs(), "search", { query, limit }] as const,
  songsFavorites: (limit: number, offset: number) => [...musicKeys.songs(), "favorites", { limit, offset }] as const,
  songsRecentlyPlayed: (limit: number) => [...musicKeys.songs(), "recently-played", { limit }] as const,
  songsMostPlayed: (limit: number) => [...musicKeys.songs(), "most-played", { limit }] as const,
  historyRecentlyPlayed: (limit: number) => [...musicKeys.all, "history", "recently-played", { limit }] as const,
  historyMostPlayed: (limit: number) => [...musicKeys.all, "history", "most-played", { limit }] as const,
  songsRecentlyAdded: (limit: number) => [...musicKeys.songs(), "recently-added", { limit }] as const,
  songsRandom: (limit: number) => [...musicKeys.songs(), "random", { limit }] as const,
  
  // Artists
  artists: () => [...musicKeys.all, "artists"] as const,
  artistsList: (limit: number, offset: number) => [...musicKeys.artists(), "list", { limit, offset }] as const,
  artist: (id: number) => [...musicKeys.artists(), "detail", id] as const,
  artistsFavorites: (limit: number, offset: number) => [...musicKeys.artists(), "favorites", { limit, offset }] as const,
  artistsRandom: (limit: number) => [...musicKeys.artists(), "random", { limit }] as const,
  
  // Albums
  albums: () => [...musicKeys.all, "albums"] as const,
  albumsList: (limit: number, offset: number) => [...musicKeys.albums(), "list", { limit, offset }] as const,
  album: (id: number) => [...musicKeys.albums(), "detail", id] as const,
  unifiedAlbum: (id: string) => [...musicKeys.albums(), "unified", id] as const,
  albumsFavorites: (limit: number, offset: number) => [...musicKeys.albums(), "favorites", { limit, offset }] as const,
  albumsRecentlyAdded: (limit: number) => [...musicKeys.albums(), "recently-added", { limit }] as const,
  albumsRandom: (limit: number) => [...musicKeys.albums(), "random", { limit }] as const,
  
  // Playlists
  playlists: () => [...musicKeys.all, "playlists"] as const,
  playlistsList: (limit: number, offset: number) => [...musicKeys.playlists(), "list", { limit, offset }] as const,
  playlist: (id: number) => [...musicKeys.playlists(), "detail", id] as const,
  
  // Downloads
  downloads: () => [...musicKeys.all, "downloads"] as const,
  downloadsList: () => [...musicKeys.downloads(), "list"] as const,
  
  // Recommendations
  recommendations: () => [...musicKeys.all, "recommendations"] as const,
  recommendationsList: (strategy: string, entityType: string, limit: number) => 
    [...musicKeys.recommendations(), { strategy, entityType, limit }] as const,
  
  // Discovery
  discovery: () => [...musicKeys.all, "discovery"] as const,
  discoveryHome: () => [...musicKeys.discovery(), "home"] as const,
  discoveryTrending: (limit: number) => [...musicKeys.discovery(), "trending", { limit }] as const,
  discoveryNewReleases: (limit: number) => [...musicKeys.discovery(), "new-releases", { limit }] as const,
  discoveryFeatured: (limit: number) => [...musicKeys.discovery(), "featured", { limit }] as const,
  discoveryGenres: () => [...musicKeys.discovery(), "genres"] as const,
  discoveryGenreAlbums: (genre: string, limit: number) => [...musicKeys.discovery(), "genre", genre, { limit }] as const,
} as const;

// ============================================================================
// SONGS HOOKS
// ============================================================================

export function useSongs(limit = 50, offset = 0, options?: Omit<UseQueryOptions<Song[]>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: musicKeys.songsList(limit, offset),
    queryFn: ({ signal }) => musicApi.listSongs(limit, offset, signal),
    ...options,
  });
}

export function useSong(songId: number, options?: Omit<UseQueryOptions<Song>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: musicKeys.song(songId),
    queryFn: ({ signal }) => musicApi.getSong(songId, signal),
    ...options,
  });
}

export function useSearchSongs(query: string, limit = 50, options?: Omit<UseQueryOptions<Song[]>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: musicKeys.songsSearch(query, limit),
    queryFn: ({ signal }) => musicApi.searchSongsLocal(query, limit, signal),
    enabled: query.length > 0,
    ...options,
  });
}

export function useFavoriteSongs(limit = 50, offset = 0, options?: Omit<UseQueryOptions<Song[]>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: musicKeys.songsFavorites(limit, offset),
    queryFn: ({ signal }) => musicApi.listFavoriteSongs(limit, offset, signal),
    ...options,
  });
}

export function useRecentlyPlayedSongs(limit = 50, options?: Omit<UseQueryOptions<Song[]>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: musicKeys.songsRecentlyPlayed(limit),
    queryFn: ({ signal }) => musicApi.getRecentlyPlayedSongs(limit, signal),
    ...options,
  });
}

export function useMostPlayedSongs(limit = 50, options?: Omit<UseQueryOptions<Song[]>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: musicKeys.songsMostPlayed(limit),
    queryFn: ({ signal }) => musicApi.getMostPlayedSongs(limit, signal),
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

export function useMostPlayedHistory(limit = 50, options?: Omit<UseQueryOptions<HistoryEntry[]>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: musicKeys.historyMostPlayed(limit),
    queryFn: ({ signal }) => musicApi.getMostPlayedHistory(limit, signal),
    ...options,
  });
}

export function useRecentlyAddedSongs(limit = 50, options?: Omit<UseQueryOptions<Song[]>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: musicKeys.songsRecentlyAdded(limit),
    queryFn: ({ signal }) => musicApi.getRecentlyAddedSongs(limit, signal),
    ...options,
  });
}

export function useRandomSongs(limit = 10, options?: Omit<UseQueryOptions<Song[]>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: musicKeys.songsRandom(limit),
    queryFn: ({ signal }) => musicApi.getRandomSongs(limit, signal),
    // Random songs should always be fresh
    staleTime: 0,
    ...options,
  });
}

// ============================================================================
// ARTISTS HOOKS
// ============================================================================

export function useArtists(limit = 50, offset = 0, options?: Omit<UseQueryOptions<Artist[]>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: musicKeys.artistsList(limit, offset),
    queryFn: ({ signal }) => musicApi.listArtists(limit, offset, signal),
    ...options,
  });
}

export function useArtist(artistId: number, options?: Omit<UseQueryOptions<ArtistDetail>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: musicKeys.artist(artistId),
    queryFn: ({ signal }) => musicApi.getArtist(artistId, signal),
    ...options,
  });
}

export function useFavoriteArtists(limit = 50, offset = 0, options?: Omit<UseQueryOptions<Artist[]>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: musicKeys.artistsFavorites(limit, offset),
    queryFn: ({ signal }) => musicApi.getFavoriteArtists(limit, offset, signal),
    ...options,
  });
}

export function useRandomArtists(limit = 5, options?: Omit<UseQueryOptions<Artist[]>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: musicKeys.artistsRandom(limit),
    queryFn: ({ signal }) => musicApi.getRandomArtists(limit, signal),
    staleTime: 0,
    ...options,
  });
}

// ============================================================================
// ALBUMS HOOKS
// ============================================================================

export function useAlbums(limit = 50, offset = 0, options?: Omit<UseQueryOptions<Album[]>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: musicKeys.albumsList(limit, offset),
    queryFn: ({ signal }) => musicApi.listAlbums(limit, offset, signal),
    ...options,
  });
}

export function useAlbum(albumId: number, options?: Omit<UseQueryOptions<AlbumDetail>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: musicKeys.album(albumId),
    queryFn: ({ signal }) => musicApi.getAlbum(albumId, signal),
    ...options,
  });
}

export function useFavoriteAlbums(limit = 50, offset = 0, options?: Omit<UseQueryOptions<Album[]>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: musicKeys.albumsFavorites(limit, offset),
    queryFn: ({ signal }) => musicApi.getFavoriteAlbums(limit, offset, signal),
    ...options,
  });
}

export function useRecentlyAddedAlbums(limit = 10, options?: Omit<UseQueryOptions<Album[]>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: musicKeys.albumsRecentlyAdded(limit),
    queryFn: ({ signal }) => musicApi.getRecentlyAddedAlbums(limit, signal),
    ...options,
  });
}

export function useRandomAlbums(limit = 5, options?: Omit<UseQueryOptions<Album[]>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: musicKeys.albumsRandom(limit),
    queryFn: ({ signal }) => musicApi.getRandomAlbums(limit, signal),
    staleTime: 0,
    ...options,
  });
}

// ============================================================================
// PLAYLISTS HOOKS
// ============================================================================

export function usePlaylists(limit = 50, offset = 0, options?: Omit<UseQueryOptions<Playlist[]>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: musicKeys.playlistsList(limit, offset),
    queryFn: ({ signal }) => musicApi.listPlaylists(limit, offset, signal),
    ...options,
  });
}

export function usePlaylist(playlistId: number, options?: Omit<UseQueryOptions<PlaylistDetail>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: musicKeys.playlist(playlistId),
    queryFn: ({ signal }) => musicApi.getPlaylist(playlistId, signal),
    ...options,
  });
}

// ============================================================================
// DOWNLOADS HOOKS
// ============================================================================

export function useDownloads(options?: Omit<UseQueryOptions<DownloadJob[]>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: musicKeys.downloadsList(),
    queryFn: ({ signal }) => musicApi.listDownloads(signal),
    // Refetch downloads more frequently
    refetchInterval: 2000,
    ...options,
  });
}

// ============================================================================
// RECOMMENDATIONS HOOKS
// ============================================================================

export function useRecommendations(
  strategy: "mixed" | "similar_artists" | "popular" | "discovery" | "time_based" = "mixed",
  entityType: "song" | "album" = "song",
  limit = 20,
  options?: Omit<UseQueryOptions<{ strategy: string; entity_type: string; songs: Song[]; albums: Album[] }>, "queryKey" | "queryFn">
) {
  return useQuery({
    queryKey: musicKeys.recommendationsList(strategy, entityType, limit),
    queryFn: ({ signal }) => musicApi.getRecommendations(strategy, entityType, limit, signal),
    // Recommendations should be refreshed periodically
    staleTime: 5 * 60 * 1000, // 5 minutes
    ...options,
  });
}

// ============================================================================
// DISCOVERY HOOKS
// ============================================================================

export function useHomeDiscovery(options?: Omit<UseQueryOptions<import("@/types/api").HomeDiscovery>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: musicKeys.discoveryHome(),
    queryFn: ({ signal }) => musicApi.getHomeDiscovery(signal),
    staleTime: 10 * 60 * 1000, // 10 minutes - discovery data doesn't change frequently
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

export function useDeletePlaylist(options?: UseMutationOptions<void, Error, number>) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: musicApi.deletePlaylist,
    onSuccess: () => {
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

export function useQueueDownload(options?: UseMutationOptions<DownloadJob, Error, DownloadCreateRequest>) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: musicApi.queueDownload,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: musicKeys.downloadsList() });
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

export function useRemoveSongFromPlaylist(options?: UseMutationOptions<PlaylistDetail, Error, { playlistId: number; songId: number; deleteFile?: boolean }>) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ playlistId, songId, deleteFile }) => 
      musicApi.removeSongFromPlaylist(playlistId, songId, deleteFile),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: musicKeys.playlist(variables.playlistId) });
      queryClient.invalidateQueries({ queryKey: musicKeys.playlists() });
    },
    ...options,
  });
}
