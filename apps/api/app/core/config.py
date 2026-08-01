from pathlib import Path
import re
from typing import Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.version import VERSION


REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
TOKEN_PLACEHOLDERS = {
    "change-me",
    "replace-me",
    "replace-with-a-long-random-token",
    "your-token-here",
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=REPOSITORY_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "ANM Player"
    app_version: str = VERSION
    api_prefix: str = "/api/v1"
    api_env: Literal["development", "test", "production"] = Field(default="development", alias="API_ENV")
    api_access_token: str | None = Field(default=None, alias="API_ACCESS_TOKEN")
    api_trusted_hosts: str = Field(default="localhost,127.0.0.1,testserver", alias="API_TRUSTED_HOSTS")
    aura_data_root: Path = Field(default=REPOSITORY_ROOT / "data", alias="AURA_DATA_ROOT")
    aura_state_file: Path = Field(
        default=REPOSITORY_ROOT / ".aura" / "storage-state.json",
        alias="AURA_STATE_FILE",
    )
    download_worker_poll_interval_seconds: float = Field(
        default=1.0,
        gt=0,
        le=60,
        alias="DOWNLOAD_WORKER_POLL_INTERVAL_SECONDS",
    )
    stream_fetch_max_concurrency: int = Field(default=2, ge=1, le=8, alias="STREAM_FETCH_MAX_CONCURRENCY")
    stream_max_file_mb: int = Field(default=256, ge=16, le=2048, alias="STREAM_MAX_FILE_MB")
    stream_cache_budget_mb: int = Field(default=2048, ge=64, le=32768, alias="STREAM_CACHE_BUDGET_MB")
    artwork_max_response_mb: int = Field(default=12, ge=1, le=64, alias="ARTWORK_MAX_RESPONSE_MB")
    artwork_max_pixels: int = Field(default=40_000_000, ge=1_000_000, le=100_000_000, alias="ARTWORK_MAX_PIXELS")
    artwork_max_concurrency: int = Field(default=4, ge=1, le=16, alias="ARTWORK_MAX_CONCURRENCY")

    @property
    def trusted_hosts(self) -> list[str]:
        return [host.strip() for host in self.api_trusted_hosts.split(",") if host.strip()]

    @property
    def is_sqlite(self) -> bool:
        return True

    @field_validator("aura_data_root", "aura_state_file", mode="before")
    @classmethod
    def resolve_repository_path(cls, value: str | Path) -> Path:
        path = Path(value).expanduser()
        if not path.is_absolute():
            path = REPOSITORY_ROOT / path
        return path.resolve()

    @model_validator(mode="after")
    def validate_production_token(self) -> "Settings":
        token = (self.api_access_token or "").strip()
        if self.api_env == "production" and (not token or token.casefold() in TOKEN_PLACEHOLDERS):
            raise ValueError("API_ACCESS_TOKEN must be a generated secret in production")
        if token and not re.fullmatch(r"[A-Za-z0-9_-]{32,256}", token):
            raise ValueError("API_ACCESS_TOKEN must contain 32-256 URL-safe characters")
        self.api_access_token = token or None
        if self.stream_cache_budget_mb < self.stream_max_file_mb:
            raise ValueError("STREAM_CACHE_BUDGET_MB must be at least STREAM_MAX_FILE_MB")
        return self


settings = Settings()
