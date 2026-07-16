from typing import Literal

from pydantic import BaseModel, Field

AudioFormat = Literal["mp3", "m4a", "flac", "opus", "ogg"]
StreamQuality = Literal["low", "auto", "high"]
ThemeMode = Literal["dark", "light", "system"]
AccentTheme = Literal["rose", "teal", "amber", "violet"]


class SettingsSummary(BaseModel):
    startup_scan_enabled: bool
    download_audio_format: AudioFormat
    download_overwrite_existing: bool
    max_concurrent_downloads: int
    album_download_max_parallel: int
    auto_enrich_downloads: bool
    download_artwork: bool
    auto_fetch_lyrics: bool
    stream_quality: StreamQuality
    stream_cache_retention_days: int
    artwork_cache_limit_mb: int
    theme_mode: ThemeMode
    accent_theme: AccentTheme
    version: str
    environment: str
    database_backend: Literal["SQLite"] = "SQLite"
    song_count: int = 0


class SettingsUpdateRequest(BaseModel):
    startup_scan_enabled: bool | None = None
    download_audio_format: AudioFormat | None = None
    download_overwrite_existing: bool | None = None
    max_concurrent_downloads: int | None = Field(default=None, ge=1, le=8)
    album_download_max_parallel: int | None = Field(default=None, ge=1, le=8)
    auto_enrich_downloads: bool | None = None
    download_artwork: bool | None = None
    auto_fetch_lyrics: bool | None = None
    stream_quality: StreamQuality | None = None
    stream_cache_retention_days: int | None = Field(default=None, ge=1, le=365)
    artwork_cache_limit_mb: int | None = Field(default=None, ge=64, le=2048)
    theme_mode: ThemeMode | None = None
    accent_theme: AccentTheme | None = None
