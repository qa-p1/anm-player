export interface DownloadCreateRequest {
  source_url: string;
  video_id?: string;
  title?: string;
  artist?: string | null;
  album?: string | null;
  thumbnail_url?: string | null;
  search_query?: string;
}

export interface DownloadJob {
  id: number;
  status: string;
  progress: number;
  stage: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  thumbnail_url: string | null;
  source_url: string | null;
  video_id: string | null;
  search_query: string | null;
  speed: string | null;
  eta: string | null;
  error_message: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  group: { type: "album"; album_id: string; title: string; canonical_url: string } | null;
}

export interface Song {
  id: number;
  title: string;
  artist_id: number | null;
  artist_name: string | null;
  album_id: number | null;
  album_public_id: string | null;
  album_title: string | null;
  duration_seconds: number | null;
  track_number: number | null;
  disc_number: number | null;
  artwork_path: string | null;
  artwork_url: string | null;
  source_url: string | null;
  is_downloaded: boolean;
  is_favorited: boolean;
  created_at: string;
  updated_at: string;
}

export interface Artist {
  id: number;
  name: string;
  sort_name: string | null;
  artwork_path: string | null;
  artwork_url: string | null;
  song_count: number;
  album_count: number;
  is_favorited: boolean;
  created_at: string;
  updated_at: string;
}

export interface ArtistDetail extends Artist {
  albums: Album[];
  top_songs: Song[];
}

export interface Album {
  id: number;
  public_id: string | null;
  title: string;
  artist_id: number | null;
  artist_name: string | null;
  year: number | null;
  artwork_path: string | null;
  artwork_url: string | null;
  song_count: number;
  duration_seconds: number | null;
  is_favorited: boolean;
  created_at: string;
  updated_at: string;
}

export interface Playlist {
  id: number;
  name: string;
  description: string | null;
  artwork_path: string | null;
  song_count: number;
  duration_seconds: number | null;
  created_at: string;
  updated_at: string;
}

export interface PlaylistDetail extends Playlist {
  songs: Song[];
  library_tracks?: Array<{
    item_type: string;
    position: number;
    song_id: number | null;
    track: LibraryTrack | null;
  }>;
  items?: Array<{
    item_type: "song" | "library_track";
    position: number;
    song: Song | null;
    track: LibraryTrack | null;
  }>;
}

export interface PlaylistCreateRequest {
  name: string;
  description?: string | null;
}

export interface PlaylistAddSongsRequest {
  song_ids: number[];
}

export interface PlaylistAddOnlineTrackRequest {
  external_id: string;
  title: string;
  artist_name?: string | null;
  artist_external_id?: string | null;
  album_title?: string | null;
  duration_seconds?: number | null;
  source_url?: string | null;
  artwork_url?: string | null;
  explicit?: boolean;
}

export interface FavoriteToggleRequest {
  entity_type: "song" | "artist" | "album" | "playlist" | "library_album" | "library_track";
  entity_id: number;
}

export interface FavoritesResponse {
  songs: Song[];
  artists: Artist[];
  albums: Album[];
  playlists: Playlist[];
  library_albums: LibraryAlbum[];
  library_tracks: LibraryTrack[];
}

export interface HistoryEntry {
  id: number;
  song_id: number | null;
  song: Song | null;
  source: "local" | "youtube";
  external_id: string | null;
  title: string | null;
  artist_name: string | null;
  album_title: string | null;
  artwork_url: string | null;
  duration_seconds: number | null;
  source_url: string | null;
  event_type: string;
  played_at: string;
  position_seconds: number | null;
}

export interface HistoryCreateRequest {
  song_id?: number | null;
  source?: "local" | "youtube";
  external_id?: string | null;
  title?: string | null;
  artist_name?: string | null;
  album_title?: string | null;
  artwork_url?: string | null;
  duration_seconds?: number | null;
  source_url?: string | null;
  position_seconds?: number | null;
  event_type?: "played" | "skipped" | "completed";
}

export interface OnlineArtist {
  id: string | null;
  name: string;
}

export interface OnlineAlbum {
  id: string | null;
  name: string;
}

export type OnlineItemKind =
  | "song"
  | "video"
  | "album"
  | "artist"
  | "playlist"
  | "podcast"
  | "episode"
  | "unknown";

export interface OnlineMusicItem {
  source: "youtube";
  kind: OnlineItemKind;
  id: string;
  title: string;
  subtitle: string | null;
  artists: OnlineArtist[];
  album: OnlineAlbum | null;
  thumbnail: string | null;
  duration_seconds: number | null;
  explicit: boolean;
  playable: boolean;
  browse_id: string | null;
  playlist_id: string | null;
  endpoint: Record<string, unknown> | null;
  url: string;
}

export interface OnlineHomeChip {
  title: string;
  params: string | null;
}

export interface OnlineHomeSection {
  id: string;
  title: string;
  subtitle: string | null;
  layout: "hero" | "quick_grid" | "song_list" | "album_grid" | "playlist_grid" | "artist_grid" | "chips";
  items: OnlineMusicItem[];
  continuation: string | null;
}

export interface OnlineHomeResponse {
  region: string;
  generated_at: string;
  chips: OnlineHomeChip[];
  sections: OnlineHomeSection[];
}

export interface OnlineRelatedResponse {
  seed_video_id: string;
  items: OnlineMusicItem[];
}

export interface OnlineSearchResponse {
  query: string;
  filter: string;
  items: OnlineMusicItem[];
  continuation: string | null;
}

export interface LibraryTrack {
  id: number;
  song_id: number | null;
  artist_id: number | null;
  source: "youtube" | "local";
  external_id: string;
  title: string;
  artist_name: string | null;
  artist_external_id: string | null;
  album_id: number | null;
  album_public_id: string | null;
  album_title: string | null;
  duration_seconds: number | null;
  track_number: number | null;
  disc_number: number | null;
  position: number;
  source_url: string | null;
  artwork_url: string | null;
  artwork_path: string | null;
  explicit: boolean;
  is_downloaded: boolean;
  is_favorited: boolean;
  is_in_library: boolean;
  created_at: string;
  updated_at: string;
}

export interface LibraryCounts {
  songs: number;
  albums: number;
  artists: number;
  playlists: number;
}

export interface LibraryAlbum {
  id: number;
  public_id: string;
  canonical_url: string;
  source: "youtube" | "local";
  external_id: string;
  title: string;
  artist_name: string | null;
  artist_external_id: string | null;
  year: number | null;
  artwork_url: string | null;
  artwork_path: string | null;
  description: string | null;
  track_count: number;
  duration_seconds: number | null;
  is_favorited: boolean;
  download_state: "none" | "partial" | "downloaded";
  downloaded_track_count: number;
  is_in_library: boolean;
  added_at: string;
  created_at: string;
  updated_at: string;
}

export interface LibraryAlbumDetail extends LibraryAlbum {
  tracks: LibraryTrack[];
}

export interface AlbumStatusItem {
  external_id: string;
  public_id: string;
  canonical_url: string;
  in_library: boolean;
  library_album_id: number | null;
  is_favorited: boolean;
  download_state: "none" | "partial" | "downloaded";
}

export type UnifiedAlbumDownloadState = "none" | "partial" | "queued" | "preparing" | "downloading" | "processing" | "paused" | "failed" | "downloaded";

export interface UnifiedAlbumTrack {
  id: string;
  title: string;
  artist_name: string | null;
  duration_seconds: number | null;
  track_number: number | null;
  disc_number: number | null;
  explicit: boolean;
  library_track_id: number | null;
  song_id: number | null;
  artist_id: number | null;
  provider_track_id: string | null;
  playback_source: "downloaded" | "streaming" | "unavailable";
  is_downloaded: boolean;
  is_available: boolean;
  stream_url: string | null;
}

export interface UnifiedAlbum {
  id: string;
  canonical_url: string;
  source: "youtube" | "local";
  internal: { library_album_id: number | null; local_album_id: number | null };
  title: string;
  artist: { name: string | null; id: string | null; href: string | null };
  year: number | null;
  artwork_url: string | null;
  description: string | null;
  track_count: number;
  duration_seconds: number | null;
  state: {
    in_library: boolean;
    is_favorited: boolean;
    download: UnifiedAlbumDownloadState;
    download_progress: number | null;
    downloaded_track_count: number;
    playable_track_count: number;
  };
  capabilities: {
    can_play: boolean;
    can_shuffle: boolean;
    can_add_to_library: boolean;
    can_remove_from_library: boolean;
    can_favorite: boolean;
    can_download: boolean;
    can_cancel_download: boolean;
    can_remove_download: boolean;
  };
  tracks: UnifiedAlbumTrack[];
}

export interface AlbumStatusResponse {
  statuses: AlbumStatusItem[];
}

export interface TrackStatusItem {
  external_id: string;
  is_downloaded: boolean;
  download_source: "song" | "library_track" | null;
  download_id: number | null;
}

export interface TrackStatusResponse {
  statuses: TrackStatusItem[];
}

export interface LibraryTrackDownloadRemoveResponse {
  track: LibraryTrack;
  file_deleted: boolean;
}

export type LyricsStatus = "cached" | "missing" | "fetching" | "not_found" | "offline" | "error" | "timeout" | "provider_error";

export interface LyricsResponse {
  song_id?: number | null;
  video_id?: string | null;
  lyrics: string | null;
  has_lyrics: boolean;
  source?: string | null;
  format?: "lrc" | "plain" | null;
  status: LyricsStatus;
  error_code?: string | null;
  fetched_at?: string | null;
}

interface LibraryArtist {
  id: number | null;
  source: "youtube";
  external_id: string;
  name: string;
  description: string | null;
  thumbnail_url: string | null;
  album_count: number;
  track_count: number;
  added_at: string | null;
}

export interface LibraryArtistDetail extends LibraryArtist {
  albums: LibraryAlbum[];
  top_tracks: LibraryTrack[];
}

export interface LibrarySearchResult {
  item_type: "album" | "track" | "artist" | "playlist" | string;
  id: number | string;
  title: string;
  subtitle: string | null;
  artwork_url: string | null;
  artwork_path: string | null;
  href: string;
}

export interface LibrarySearchResponse {
  query: string;
  results: LibrarySearchResult[];
}

export interface SmartCollection {
  id: string;
  title: string;
  description: string;
  tracks: LibraryTrack[];
  albums: LibraryAlbum[];
}
