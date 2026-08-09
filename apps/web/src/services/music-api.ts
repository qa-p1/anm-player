import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@/services/api-client";
import type {
  Artist,
  ArtistDetail,
  DownloadCreateRequest,
  DownloadJob,
  LibraryAlbum,
  LibraryAlbumDetail,
  LibraryCounts,
  LibraryArtistDetail,
  FavoriteToggleRequest,
  FavoritesResponse,
  HistoryCreateRequest,
  HistoryEntry,
  ListeningInsights,
  Playlist,
  PlaylistAddSongsRequest,
  PlaylistAddOnlineTrackRequest,
  PlaylistCreateRequest,
  PlaylistBulkRemoveRequest,
  PlaylistDetail,
  PlaylistReorderRequest,
  PlaylistUpdateRequest,
  Song,
  OnlineHomeResponse,
  OnlineRelatedResponse,
  AlbumStatusResponse,
  LibrarySearchResponse,
  LibraryTrackDownloadRemoveResponse,
  SmartCollection,
  OnlineSearchResponse,
  LyricsResponse,
  UnifiedAlbum,
  TrackStatusResponse,
} from "@/types/api";

// Downloads
function listDownloads(limit = 100, offset = 0, signal?: AbortSignal) {
  return apiGet<DownloadJob[]>(`/downloads?limit=${limit}&offset=${offset}`, { signal });
}

export function listAllDownloads(signal?: AbortSignal) {
  return collectAllPages((limit, offset) => listDownloads(limit, offset, signal));
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
function listSongs(limit = 50, offset = 0, signal?: AbortSignal) {
  return apiGet<Song[]>(`/songs?limit=${limit}&offset=${offset}`, { signal });
}

export function listAllSongs(signal?: AbortSignal) {
  return collectAllPages((limit, offset) => listSongs(limit, offset, signal));
}

export function searchAllSongsLocal(query: string, signal?: AbortSignal) {
  return collectAllPages(
    (limit, offset) => advancedSearchSongs({ q: query, limit, offset }, signal),
  );
}

export function listFavorites(signal?: AbortSignal) {
  return apiGet<FavoritesResponse>("/favorites", { signal });
}

// Artists
function listArtists(limit = 50, offset = 0, signal?: AbortSignal) {
  return apiGet<Artist[]>(`/artists?limit=${limit}&offset=${offset}`, { signal });
}

export function listAllArtists(signal?: AbortSignal) {
  return collectAllPages((limit, offset) => listArtists(limit, offset, signal));
}

export function getArtist(artistId: number, signal?: AbortSignal) {
  return apiGet<ArtistDetail>(`/artists/${artistId}`, { signal });
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

// Playlists
function listPlaylists(limit = 50, offset = 0, signal?: AbortSignal) {
  return apiGet<Playlist[]>(`/playlists?limit=${limit}&offset=${offset}`, { signal });
}

export function listAllPlaylists(signal?: AbortSignal) {
  return collectAllPages((limit, offset) => listPlaylists(limit, offset, signal));
}

export function getPlaylist(playlistId: number, signal?: AbortSignal) {
  return apiGet<PlaylistDetail>(`/playlists/${playlistId}`, { signal });
}

export function createPlaylist(request: PlaylistCreateRequest) {
  return apiPost<Playlist, PlaylistCreateRequest>("/playlists", request);
}

export function deletePlaylist(playlistId: number) {
  return apiDelete<void>(`/playlists/${playlistId}`);
}

export function updatePlaylist(playlistId: number, request: PlaylistUpdateRequest) {
  return apiPatch<PlaylistDetail, PlaylistUpdateRequest>(`/playlists/${playlistId}`, request);
}

export function duplicatePlaylist(playlistId: number, name?: string) {
  return apiPost<PlaylistDetail, { name?: string }>(`/playlists/${playlistId}/duplicate`, name ? { name } : {});
}

export function reorderPlaylist(playlistId: number, request: PlaylistReorderRequest) {
  return apiPut<PlaylistDetail, PlaylistReorderRequest>(`/playlists/${playlistId}/reorder`, request);
}

export function bulkRemovePlaylistItems(playlistId: number, request: PlaylistBulkRemoveRequest) {
  return apiPost<PlaylistDetail, PlaylistBulkRemoveRequest>(`/playlists/${playlistId}/items/bulk-remove`, request);
}

export function clearPlaylistItems(playlistId: number) {
  return apiDelete<PlaylistDetail>(`/playlists/${playlistId}/items`);
}

export function getPlaylistExportUrl(playlistId: number) {
  return `/api/v1/playlists/${playlistId}/export.m3u8`;
}

export function addSongsToPlaylist(playlistId: number, request: PlaylistAddSongsRequest) {
  return apiPost<PlaylistDetail, PlaylistAddSongsRequest>(`/playlists/${playlistId}/songs`, request);
}

export function addOnlineTrackToPlaylist(playlistId: number, request: PlaylistAddOnlineTrackRequest) {
  return apiPost<PlaylistDetail, PlaylistAddOnlineTrackRequest>(`/playlists/${playlistId}/online-track`, request);
}

export function removeSongFromPlaylist(playlistId: number, songId: number) {
  return apiDelete<PlaylistDetail>(`/playlists/${playlistId}/songs/${songId}`);
}

export function removeLibraryTrackFromPlaylist(playlistId: number, trackId: number) {
  return apiDelete<PlaylistDetail>(`/playlists/${playlistId}/tracks/${trackId}`);
}

// Favorites
export function toggleFavorite(request: FavoriteToggleRequest) {
  return apiPost<{ is_favorited: boolean }, FavoriteToggleRequest>("/favorites/toggle", request);
}

// History
export function addHistory(request: HistoryCreateRequest) {
  return apiPost<HistoryEntry, HistoryCreateRequest>("/history", request);
}

export function getRecentlyPlayedHistory(limit = 50, signal?: AbortSignal) {
  return apiGet<HistoryEntry[]>(`/history/recently-played?limit=${limit}`, { signal });
}

export function getMostPlayedHistory(limit = 50, signal?: AbortSignal) {
  return apiGet<HistoryEntry[]>(`/history/most-played?limit=${limit}`, { signal });
}

export function listHistory(limit = 100, offset = 0, signal?: AbortSignal) {
  return apiGet<HistoryEntry[]>(`/history?limit=${limit}&offset=${offset}`, { signal });
}

export function deleteHistoryEntry(historyId: number) {
  return apiDelete<void>(`/history/${historyId}`);
}

export function clearHistory() {
  return apiDelete<{ deleted: number }>("/history");
}

export function getListeningInsights(days = 30, signal?: AbortSignal) {
  return apiGet<ListeningInsights>(`/insights?days=${days}`, { signal });
}

// Media streaming
export function getSongStreamUrl(songId: number): string {
  return `/api/v1/media/songs/${songId}/stream`;
}

export function getLibraryTrackStreamUrl(trackId: number): string {
  return `/api/v1/media/library-tracks/${trackId}/stream`;
}

export function getYouTubeStreamUrl(videoId: string): string {
  return `/api/v1/ytmusic/stream/${encodeURIComponent(videoId)}`;
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

export function listAllLibraryAlbums(query?: string, signal?: AbortSignal) {
  return collectAllPages(
    (limit, offset) => listLibraryAlbums(query, limit, offset, signal),
  );
}

export function getLibraryCounts(signal?: AbortSignal) {
  return apiGet<LibraryCounts>("/library/counts", { signal });
}

export function getLibraryAlbum(albumId: number, signal?: AbortSignal) {
  return apiGet<LibraryAlbumDetail>(`/library/albums/${albumId}`, { signal });
}

export function removeLibraryTrackDownload(trackId: number) {
  return apiDelete<LibraryTrackDownloadRemoveResponse>(`/library/tracks/${trackId}/download`);
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

// Advanced Search
function advancedSearchSongs(params: {
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

export function advancedSearchAllSongs(
  params: Omit<Parameters<typeof advancedSearchSongs>[0], "limit" | "offset">,
  signal?: AbortSignal,
) {
  return collectAllPages(
    (limit, offset) => advancedSearchSongs({ ...params, limit, offset }, signal),
  );
}

async function collectAllPages<T extends { id: string | number }>(
  loadPage: (limit: number, offset: number) => Promise<T[]>,
): Promise<T[]> {
  const pageSize = 100;
  const items = new Map<string | number, T>();
  for (let offset = 0; ; offset += pageSize) {
    const page = await loadPage(pageSize, offset);
    for (const item of page) items.set(item.id, item);
    if (page.length < pageSize) return [...items.values()];
  }
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
