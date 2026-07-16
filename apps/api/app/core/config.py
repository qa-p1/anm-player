from functools import cached_property
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Aura"
    app_version: str = "0.1.0"
    api_prefix: str = "/api/v1"
    api_env: str = Field(default="development", alias="API_ENV")
    api_cors_origins: str = Field(
        default="http://localhost:5173",
        alias="API_CORS_ORIGINS",
    )
    api_access_token: str | None = Field(default=None, alias="API_ACCESS_TOKEN")
    # Only SQLite inside the managed root is supported. DATABASE_URL remains an
    # explicit escape hatch so deployments get a clear "unsupported" response.
    database_url: str | None = Field(default=None, alias="DATABASE_URL")
    # Non-environment compatibility hooks used by older embedders/tests. Runtime
    # code treats them only as explicit in-process overrides.
    music_directory: Path | None = Field(default=None, validation_alias="AURA_TEST_MUSIC_DIRECTORY")
    download_directory: Path | None = Field(default=None, validation_alias="AURA_TEST_DOWNLOAD_DIRECTORY")
    download_overwrite_existing: bool = Field(default=False, alias="DOWNLOAD_OVERWRITE_EXISTING")
    download_audio_format: Literal["mp3", "m4a", "flac", "opus", "ogg"] = Field(default="mp3", alias="DOWNLOAD_AUDIO_FORMAT")
    download_worker_poll_interval_seconds: float = Field(default=1.0, alias="DOWNLOAD_WORKER_POLL_INTERVAL_SECONDS")
    
    auto_enrich_downloads: bool = Field(default=True, alias="AUTO_ENRICH_DOWNLOADS")
    stream_cache_retention_days: int = Field(default=30, alias="STREAM_CACHE_RETENTION_DAYS")
    album_download_max_parallel: int = Field(default=5, alias="ALBUM_DOWNLOAD_MAX_PARALLEL")

    @cached_property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.api_cors_origins.split(",") if origin.strip()]

    @cached_property
    def is_sqlite(self) -> bool:
        return self.database_url is None or self.database_url.startswith("sqlite")


settings = Settings()


def get_settings() -> Settings:
    """Get settings instance."""
    return settings
