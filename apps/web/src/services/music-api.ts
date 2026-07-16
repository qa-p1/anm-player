import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@/services/api-client";
import type {
  Album,
  AlbumDetail,
  Artist,
  ArtistDetail,
  DownloadCreateRequest,
  DownloadJob,
  LibraryAlbum,
  LibraryAlbumDetail,
  LibraryArtistDetail,
  FavoriteToggleRequest,
  FavoritesResponse,
  HistoryCreateRequest,
  HistoryEntry,
  AlbumDownloadJob,
  Playlist,
  PlaylistAddSongsRequest,
  PlaylistAddOnlineTrackRequest,
  PlaylistCreateRequest,
  PlaylistDetail,
  PlaylistUpdateRequest,
  SearchResponse,
  Song,
  OnlineHomeResponse,
  OnlineRelatedResponse,
  OnlineAlbumPreview,
  AlbumStatusResponse,
  LibrarySearchResponse,
  LibraryRemoveResponse,
  LibraryTrackDownloadRemoveResponse,
  SmartCollection,
  OnlineSearchResponse,
  LyricsResponse,
  UnifiedAlbum,
  TrackStatusResponse,
} from "@/types/api";

// Search
export function searchMusic(query: string, signal?: AbortSignal) {
  return apiGet<SearchResponse>(`/search?q=${encodeURIComponent(query)}`, { signal });
}

// Downloads
export function listDownloads(signal?: AbortSignal) {
  return apiGet<DownloadJob[]>("/downloads?limit=100", { signal });
}

export function queueDownload(request: DownloadCreateRequest) {
  return apiPost<DownloadJob, DownloadCreateRequest>("/downloads", request);
}

export function cancelDownload(jobId: number) {
  return apiPost<DownloadJob, undefined>(`/downloads/${jobId}/cancel`);
}

export function retryDownload(jobId: number) {
  return apiPost<DownloadJob, undefined>(`/downloads/${jobId}/retry`);
}

export function pauseDownload(jobId: number) {
  return apiPost<DownloadJob, undefined>(`/downloads/${jobId}/pause`);
}

export function resumeDownload(jobId: number) {
  return apiPost<DownloadJob, undefined>(`/downloads/${jobId}/resume`);
}

export function removeCompletedDownloads() {
  return apiDelete<{ removed: number }>("/downloads/completed");
}

// Songs
export function listSongs(limit = 50, offset = 0, signal?: AbortSignal) {
  return apiGet<Song[]>(`/songs?limit=${limit}&offset=${offset}`, { signal });
}

export function getSong(songId: number, signal?: AbortSignal) {
  return apiGet<Song>(`/songs/${songId}`, { signal });
}

export function searchSongsLocal(query: string, limit = 50, signal?: AbortSignal) {
  return apiGet<Song[]>(`/songs/search?q=${encodeURIComponent(query)}&limit=${limit}`, { signal });
}

export function listFavoriteSongs(limit = 50, offset = 0, signal?: AbortSignal) {
  return apiGet<Song[]>(`/songs/favorites?limit=${limit}&offset=${offset}`, { signal });
}

export function listFavorites(signal?: AbortSignal) {
  return apiGet<FavoritesResponse>("/favorites", { signal });
}

export function getRecentlyPlayedSongs(limit = 50, signal?: AbortSignal) {
  return apiGet<Song[]>(`/songs/recently-played?limit=${limit}`, { signal });
}

export function getMostPlayedSongs(limit = 50, signal?: AbortSignal) {
  return apiGet<Song[]>(`/songs/most-played?limit=${limit}`, { signal });
}

export function getRecentlyAddedSongs(limit = 50, signal?: AbortSignal) {
  return apiGet<Song[]>(`/songs/recently-added?limit=${limit}`, { signal });
}

export function getRandomSongs(limit = 10, signal?: AbortSignal) {
  return apiGet<Song[]>(`/songs/random?limit=${limit}`, { signal });
}

// Artists
export function listArtists(limit = 50, offset = 0, signal?: AbortSignal) {
  return apiGet<Artist[]>(`/artists?limit=${limit}&offset=${offset}`, { signal });
}

export function getArtist(artistId: number, signal?: AbortSignal) {
  return apiGet<ArtistDetail>(`/artists/${artistId}`, { signal });
}

export function getFavoriteArtists(limit = 50, offset = 0, signal?: AbortSignal) {
  return apiGet<Artist[]>(`/artists/favorites?limit=${limit}&offset=${offset}`, { signal });
}

export function getRandomArtists(limit = 5, signal?: AbortSignal) {
  return apiGet<Artist[]>(`/artists/random?limit=${limit}`, { signal });
}

// Albums
export function listAlbums(limit = 50, offset = 0, signal?: AbortSignal) {
  return apiGet<Album[]>(`/albums?limit=${limit}&offset=${offset}`, { signal });
}

export function getAlbum(albumId: number, signal?: AbortSignal) {
  return apiGet<AlbumDetail>(`/albums/legacy/${albumId}`, { signal });
}

export function getUnifiedAlbum(publicId: string, signal?: AbortSignal) {
  return apiGet<UnifiedAlbum>(`/albums/${encodeURIComponent(publicId)}`, { signal });
}

export function resolveLegacyAlbumPublicId(albumId: number, signal?: AbortSignal) {
  return apiGet<{ public_id: string; canonical_url: string }>(`/albums/legacy/${albumId}/public-id`, { signal });
}

export function addUnifiedAlbumToLibrary(publicId: string) {
  return apiPut<UnifiedAlbum, undefined>(`/albums/${encodeURIComponent(publicId)}/library`);
}

export function removeUnifiedAlbumFromLibrary(publicId: string, deleteDownloads = false) {
  return apiDelete<UnifiedAlbum>(`/albums/${encodeURIComponent(publicId)}/library?delete_downloads=${deleteDownloads ? "true" : "false"}`);
}

export function setUnifiedAlbumFavorite(publicId: string, isFavorited: boolean) {
  return apiPut<UnifiedAlbum, { is_favorited: boolean }>(`/albums/${encodeURIComponent(publicId)}/favorite`, { is_favorited: isFavorited });
}

export function downloadUnifiedAlbum(publicId: string, maxParallel?: number) {
  return apiPost<UnifiedAlbum, { max_parallel?: number }>(`/albums/${encodeURIComponent(publicId)}/download`, { max_parallel: maxParallel });
}

export function cancelUnifiedAlbumDownload(publicId: string) {
  return apiPost<UnifiedAlbum, undefined>(`/albums/${encodeURIComponent(publicId)}/download/cancel`);
}

export function removeUnifiedAlbumDownload(publicId: string) {
  return apiDelete<UnifiedAlbum>(`/albums/${encodeURIComponent(publicId)}/download`);
}

export function getFavoriteAlbums(limit = 50, offset = 0, signal?: AbortSignal) {
  return apiGet<Album[]>(`/albums/favorites?limit=${limit}&offset=${offset}`, { signal });
}

export function getRecentlyAddedAlbums(limit = 10, signal?: AbortSignal) {
  return apiGet<Album[]>(`/albums/recently-added?limit=${limit}`, { signal });
}

export function getRandomAlbums(limit = 5, signal?: AbortSignal) {
  return apiGet<Album[]>(`/albums/random?limit=${limit}`, { signal });
}

// Playlists
export function listPlaylists(limit = 50, offset = 0, signal?: AbortSignal) {
  return apiGet<Playlist[]>(`/playlists?limit=${limit}&offset=${offset}`, { signal });
}

export function getPlaylist(playlistId: number, signal?: AbortSignal) {
  return apiGet<PlaylistDetail>(`/playlists/${playlistId}`, { signal });
}

export function createPlaylist(request: PlaylistCreateRequest) {
  return apiPost<Playlist, PlaylistCreateRequest>("/playlists", request);
}

export function updatePlaylist(playlistId: number, request: PlaylistUpdateRequest) {
  return apiPatch<Playlist, PlaylistUpdateRequest>(`/playlists/${playlistId}`, request);
}

export function deletePlaylist(playlistId: number) {
  return apiDelete<void>(`/playlists/${playlistId}`);
}

export function addSongsToPlaylist(playlistId: number, request: PlaylistAddSongsRequest) {
  return apiPost<PlaylistDetail, PlaylistAddSongsRequest>(`/playlists/${playlistId}/songs`, request);
}

export function addOnlineTrackToPlaylist(playlistId: number, request: PlaylistAddOnlineTrackRequest) {
  return apiPost<PlaylistDetail, PlaylistAddOnlineTrackRequest>(`/playlists/${playlistId}/online-track`, request);
}

export function removeSongFromPlaylist(playlistId: number, songId: number, deleteFile = false) {
  return apiDelete<PlaylistDetail>(`/playlists/${playlistId}/songs/${songId}?delete_file=${deleteFile ? "true" : "false"}`);
}

// Favorites
export function toggleFavorite(request: FavoriteToggleRequest) {
  return apiPost<{ is_favorited: boolean }, FavoriteToggleRequest>("/favorites/toggle", request);
}

// History
export function addHistory(request: HistoryCreateRequest) {
  return apiPost<HistoryEntry, HistoryCreateRequest>("/history", request);
}

export function listHistory(limit = 50, offset = 0, signal?: AbortSignal) {
  return apiGet<HistoryEntry[]>(`/history?limit=${limit}&offset=${offset}`, { signal });
}

export function getRecentlyPlayedHistory(limit = 50, signal?: AbortSignal) {
  return apiGet<HistoryEntry[]>(`/history/recently-played?limit=${limit}`, { signal });
}

export function getMostPlayedHistory(limit = 50, signal?: AbortSignal) {
  return apiGet<HistoryEntry[]>(`/history/most-played?limit=${limit}`, { signal });
}

// Media streaming
export function getSongStreamUrl(songId: number): string {
  const baseUrl = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api/v1";
  return `${baseUrl}/media/songs/${songId}/stream`;
}

export function getLibraryTrackStreamUrl(trackId: number): string {
  const baseUrl = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api/v1";
  return `${baseUrl}/media/library-tracks/${trackId}/stream`;
}

export function getYouTubeStreamUrl(videoId: string): string {
  const baseUrl = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api/v1";
  return `${baseUrl}/ytmusic/stream/${encodeURIComponent(videoId)}`;
}

export function getYouTubeStreamStatus(videoId: string, signal?: AbortSignal) {
  return apiGet<{ cached: boolean }>(`/ytmusic/stream/${encodeURIComponent(videoId)}/status`, { signal });
}

export function getYouTubeHome(signal?: AbortSignal) {
  return apiGet<OnlineHomeResponse>("/ytmusic/home", { signal });
}

export function getYouTubeRelated(videoId: string, signal?: AbortSignal) {
  return apiGet<OnlineRelatedResponse>(`/ytmusic/related/${encodeURIComponent(videoId)}`, { signal });
}

export function searchYouTubeMusic(query: string, filter = "all", continuation?: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ q: query, filter });
  if (continuation) params.set("continuation", continuation);
  return apiGet<OnlineSearchResponse>(`/ytmusic/search?${params.toString()}`, { signal });
}

export function previewOnlineAlbum(externalId: string, signal?: AbortSignal) {
  return apiGet<OnlineAlbumPreview>(`/library/albums/online/${encodeURIComponent(externalId)}`, { signal });
}

export function saveOnlineAlbum(externalId: string) {
  return apiPost<LibraryAlbumDetail, { external_id: string }>("/library/albums/save-online", { external_id: externalId });
}

export function getLibraryAlbumStatuses(externalIds: string[], signal?: AbortSignal) {
  return apiPost<AlbumStatusResponse, { external_ids: string[] }>("/library/albums/status", { external_ids: externalIds }, { signal });
}

export function getLibraryTrackStatuses(externalIds: string[], signal?: AbortSignal) {
  return apiPost<TrackStatusResponse, { external_ids: string[] }>("/library/tracks/status", { external_ids: externalIds }, { signal });
}

export function listLibraryAlbums(query?: string, limit = 50, offset = 0, signal?: AbortSignal) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (query) params.set("q", query);
  return apiGet<LibraryAlbum[]>(`/library/albums?${params.toString()}`, { signal });
}

export function getLibraryAlbum(albumId: number, signal?: AbortSignal) {
  return apiGet<LibraryAlbumDetail>(`/library/albums/${albumId}`, { signal });
}

export function downloadLibraryAlbum(albumId: number, maxParallel?: number) {
  return apiPost<AlbumDownloadJob, { max_parallel?: number }>(`/library/albums/${albumId}/download`, {
    max_parallel: maxParallel,
  });
}

export function cancelLibraryAlbumDownload(albumId: number) {
  return apiDelete<AlbumDownloadJob>(`/library/albums/${albumId}/download`);
}

export function removeLibraryAlbum(albumId: number, deleteDownloads = false) {
  return apiDelete<LibraryRemoveResponse>(`/library/albums/${albumId}?delete_downloads=${deleteDownloads ? "true" : "false"}`);
}

export function removeLibraryTrack(trackId: number, deleteDownloads = false) {
  return apiDelete<LibraryRemoveResponse>(`/library/tracks/${trackId}?delete_downloads=${deleteDownloads ? "true" : "false"}`);
}

export function removeLibraryTrackDownload(trackId: number, deleteFile = true) {
  return apiDelete<LibraryTrackDownloadRemoveResponse>(`/library/tracks/${trackId}/download?delete_file=${deleteFile ? "true" : "false"}`);
}

export function searchLibrary(query: string, limit = 50, signal?: AbortSignal) {
  return apiGet<LibrarySearchResponse>(`/library/search?q=${encodeURIComponent(query)}&limit=${limit}`, { signal });
}

export function getSmartCollection(collectionId: string, limit = 50, signal?: AbortSignal) {
  return apiGet<SmartCollection>(`/library/smart/${encodeURIComponent(collectionId)}?limit=${limit}`, { signal });
}

export function getOnlineArtist(externalId: string, signal?: AbortSignal) {
  return apiGet<LibraryArtistDetail>(`/library/artists/online/${encodeURIComponent(externalId)}`, { signal });
}

export function addLibraryTracksToPlaylist(playlistId: number, trackIds: number[], force = false) {
  return apiPost<{ added: number }, { track_ids: number[]; force: boolean }>(`/library/playlists/${playlistId}/tracks`, {
    track_ids: trackIds,
    force,
  });
}

export function importPlaylistUrl(url: string, name?: string, maxParallel?: number) {
  return apiPost<{ playlist_id: number; tracks: number; download_job_id: number }, { url: string; name?: string; max_parallel?: number }>(
    "/library/playlists/import-url",
    { url, name, max_parallel: maxParallel },
  );
}

// Recommendations
export function getRecommendations(
  strategy: "mixed" | "similar_artists" | "popular" | "discovery" | "time_based" = "mixed",
  entityType: "song" | "album" = "song",
  limit = 20,
  signal?: AbortSignal
) {
  return apiPost<
    { strategy: string; entity_type: string; songs: Song[]; albums: Album[] },
    { strategy: string; entity_type: string; limit: number }
  >("/recommendations", { strategy, entity_type: entityType, limit }, { signal });
}

// Advanced Search
export function advancedSearchSongs(params: {
  q?: string;
  artist_ids?: string;
  album_ids?: string;
  year_min?: number;
  year_max?: number;
  duration_min?: number;
  duration_max?: number;
  has_artwork?: boolean;
  sort_by?: string;
  sort_order?: string;
  limit?: number;
  offset?: number;
}, signal?: AbortSignal) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      query.append(key, String(value));
    }
  });
  return apiGet<Song[]>(`/advanced-search/songs?${query}`, { signal });
}

// Metadata
export function searchMetadata(data: {
  title?: string;
  artist?: string;
  album?: string;
  duration_ms?: number;
  provider?: string;
  limit?: number;
}, signal?: AbortSignal) {
  return apiPost<unknown[], typeof data>("/metadata/search", data, { signal });
}

export function enrichSong(songId: number, provider?: string) {
  return apiPost<Song, { provider?: string }>(`/metadata/songs/${songId}/enrich`, { provider });
}

// Lyrics
export function getSongLyrics(songId: number, signal?: AbortSignal) {
  return apiGet<LyricsResponse>(
    `/lyrics/songs/${songId}`,
    { signal }
  );
}

export function fetchSongLyrics(songId: number, signal?: AbortSignal, force = false) {
  return apiPost<LyricsResponse, undefined>(
    `/lyrics/songs/${songId}/fetch?force=${force ? "true" : "false"}`,
    undefined,
    { signal }
  );
}

export function getYouTubeLyrics(params: {
  videoId: string;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  duration?: number | null;
}, signal?: AbortSignal) {
  const query = new URLSearchParams();
  if (params.title) query.set("title", params.title);
  if (params.artist) query.set("artist", params.artist);
  if (params.album) query.set("album", params.album);
  if (params.duration) query.set("duration", String(Math.round(params.duration)));
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return apiGet<LyricsResponse>(
    `/lyrics/youtube/${encodeURIComponent(params.videoId)}${suffix}`,
    { signal }
  );
}

export function fetchYouTubeLyrics(params: {
  videoId: string;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  duration?: number | null;
}, signal?: AbortSignal, force = false) {
  const query = new URLSearchParams({ force: force ? "true" : "false" });
  if (params.title) query.set("title", params.title);
  if (params.artist) query.set("artist", params.artist);
  if (params.album) query.set("album", params.album);
  if (params.duration) query.set("duration", String(Math.round(params.duration)));
  return apiPost<LyricsResponse, undefined>(
    `/lyrics/youtube/${encodeURIComponent(params.videoId)}/fetch?${query.toString()}`,
    undefined,
    { signal }
  );
}

export function saveSongLyrics(songId: number, lyrics: string) {
  return apiPost<LyricsResponse, { lyrics: string }>(
    `/lyrics/songs/${songId}`,
    { lyrics }
  );
}

// Discovery
export function getHomeDiscovery(signal?: AbortSignal) {
  return apiGet<import("@/types/api").HomeDiscovery>("/discovery/home", { signal });
}

export function getTrendingAlbums(limit = 20, signal?: AbortSignal) {
  return apiGet<{ section: string; title: string; items: import("@/types/api").DiscoveryItem[] }>(
    `/discovery/trending?limit=${limit}`,
    { signal }
  );
}

export function getNewReleases(limit = 20, signal?: AbortSignal) {
  return apiGet<{ section: string; title: string; items: import("@/types/api").DiscoveryItem[] }>(
    `/discovery/new-releases?limit=${limit}`,
    { signal }
  );
}

export function getFeaturedAlbums(limit = 10, signal?: AbortSignal) {
  return apiGet<{ section: string; title: string; items: import("@/types/api").DiscoveryItem[] }>(
    `/discovery/featured?limit=${limit}`,
    { signal }
  );
}

export function getDiscoveryGenres(signal?: AbortSignal) {
  return apiGet<{ genres: string[] }>("/discovery/genres", { signal });
}

export function getGenreAlbums(genre: string, limit = 20, signal?: AbortSignal) {
  return apiGet<{ section: string; genre: string; title: string; items: import("@/types/api").DiscoveryItem[] }>(
    `/discovery/genres/${encodeURIComponent(genre)}?limit=${limit}`,
    { signal }
  );
}
