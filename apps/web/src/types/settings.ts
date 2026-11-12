import type { AccentTheme, ThemeMode } from "@/stores/theme-store";

export interface StorageMigrationStatus {
  active: boolean;
  operation_kind?: "migration" | "reset";
  phase: string;
  message: string;
  files_processed: number;
  files_total: number;
  bytes_processed: number;
  bytes_total: number;
  percent: number;
  error: string | null;
  cleanup_warning: string | null;
}

export type AudioFormat = "original" | "mp3" | "m4a" | "flac" | "opus" | "ogg";
export type StreamQuality = "low" | "auto" | "high";

export interface SettingsSummary {
  startup_scan_enabled: boolean;
  download_audio_format: AudioFormat;
  download_overwrite_existing: boolean;
  max_concurrent_downloads: number;
  album_download_max_parallel: number;
  auto_enrich_downloads: boolean;
  download_artwork: boolean;
  auto_fetch_lyrics: boolean;
  stream_quality: StreamQuality;
  stream_cache_retention_days: number;
  artwork_cache_limit_mb: number;
  theme_mode: ThemeMode;
  accent_theme: AccentTheme;
  /** "auto" or a country code for Home's regional rows. */
  home_region: string;
  version: string;
  environment: string;
  database_backend: "SQLite";
  song_count: number;
}

export interface StorageSummary {
  data_root: string;
  used_bytes: number;
  free_bytes: number;
  total_bytes: number;
  categories: Record<"database" | "music" | "downloads" | "artwork" | "lyrics" | "streams" | "config" | "thumbnails" | "logs" | "other", number>;
  migration: StorageMigrationStatus;
}

export interface DirectoryEntry {
  directory_id: string | null;
  name: string;
  display_path: string;
  disabled: boolean;
  empty: boolean;
  same_device: boolean | null;
  reason: string | null;
}

export interface DirectoryListing {
  current: DirectoryEntry | null;
  parent: DirectoryEntry | null;
  directories: DirectoryEntry[];
}
