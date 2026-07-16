import json
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import Song, UserSettings
from app.schemas.settings import SettingsSummary, SettingsUpdateRequest


DEFAULTS: dict[str, Any] = {
    "startup_scan_enabled": True,
    "download_audio_format": "mp3",
    "download_overwrite_existing": False,
    "max_concurrent_downloads": 8,
    "album_download_max_parallel": 5,
    "auto_enrich_downloads": True,
    "download_artwork": True,
    "auto_fetch_lyrics": True,
    "stream_quality": "high",
    "stream_cache_retention_days": 30,
    "artwork_cache_limit_mb": 512,
    "theme_mode": "dark",
    "accent_theme": "rose",
}


class SettingsService:
    def __init__(self, session: Session | None = None) -> None:
        self.session = session

    def summary(self) -> SettingsSummary:
        values = {key: self.get_value(key, default) for key, default in DEFAULTS.items()}
        song_count = 0
        if self.session is not None:
            song_count = int(self.session.scalar(select(func.count(Song.id))) or 0)
        return SettingsSummary(
            **values,
            version=settings.app_version,
            environment=settings.api_env,
            song_count=song_count,
        )

    def update(self, request: SettingsUpdateRequest) -> SettingsSummary:
        for key, value in request.model_dump(exclude_none=True).items():
            if key in DEFAULTS:
                self.set_value(key, value)
        if self.session:
            self.session.commit()
        return self.summary()

    def get_value(self, key: str, default: Any = None) -> Any:
        if not self.session:
            return default
        row = self.session.scalars(select(UserSettings).where(UserSettings.key == key)).first()
        if not row:
            return default
        try:
            return json.loads(row.value_json)
        except (json.JSONDecodeError, TypeError):
            return default

    def get_int(self, key: str, default: int) -> int:
        value = self.get_value(key, default)
        return value if isinstance(value, int) and not isinstance(value, bool) else default

    def get_bool(self, key: str, default: bool) -> bool:
        value = self.get_value(key, default)
        return value if isinstance(value, bool) else default

    def get_str(self, key: str, default: str) -> str:
        value = self.get_value(key, default)
        return value if isinstance(value, str) else default

    def set_value(self, key: str, value: Any) -> None:
        if not self.session:
            return
        row = self.session.scalars(select(UserSettings).where(UserSettings.key == key)).first()
        payload = json.dumps(value)
        if row:
            row.value_json = payload
        else:
            self.session.add(UserSettings(key=key, value_json=payload))
