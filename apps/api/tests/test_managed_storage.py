import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models import Base, DownloadJob, LibraryTrack, Song
from app.schemas.library import LibraryTrackResponse
from app.schemas.music import DownloadJobResponse, SongResponse
from app.schemas.settings import SettingsUpdateRequest
from app.services.settings import SettingsService
from app.storage.paths import InvalidStoragePath, StoragePaths
from app.storage.state import StorageStateStore
from app.storage.coordinator import storage_coordinator
from app.main import app


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)()


def test_storage_state_is_seeded_once_and_runtime_root_wins(tmp_path, monkeypatch) -> None:
    state_file = tmp_path / "bootstrap" / "storage-state.json"
    first = tmp_path / "first"
    second = tmp_path / "second"
    store = StorageStateStore(state_file, initial_root=first)

    assert Path(store.read()["data_root"]) == first.resolve()
    store.switch_root(second)
    reloaded = StorageStateStore(state_file, initial_root=first)

    assert Path(reloaded.read()["data_root"]) == second.resolve()
    assert json.loads(state_file.read_text(encoding="utf-8"))["schema_version"] == 1


def test_managed_paths_are_root_relative_and_contained(tmp_path) -> None:
    paths = StoragePaths(tmp_path)
    paths.ensure()
    track = paths.music / "Artist" / "song.mp3"

    assert paths.store_music(track) == "music/Artist/song.mp3"
    assert paths.music_file("music/Artist/song.mp3") == track
    with pytest.raises(InvalidStoragePath):
        paths.music_file("../outside.mp3")
    with pytest.raises(InvalidStoragePath):
        paths.music_file(str((tmp_path / "absolute.mp3").resolve()))


def test_settings_round_trip_all_runtime_controls() -> None:
    with make_session() as session:
        service = SettingsService(session)
        updated = service.update(SettingsUpdateRequest(
            startup_scan_enabled=False,
            download_audio_format="flac",
            download_overwrite_existing=True,
            max_concurrent_downloads=3,
            album_download_max_parallel=2,
            auto_enrich_downloads=False,
            download_artwork=False,
            auto_fetch_lyrics=False,
            stream_quality="low",
            stream_cache_retention_days=7,
            artwork_cache_limit_mb=256,
            theme_mode="system",
            accent_theme="teal",
        ))

        assert updated.startup_scan_enabled is False
        assert updated.download_audio_format == "flac"
        assert updated.max_concurrent_downloads == 3
        assert updated.stream_quality == "low"
        assert SettingsService(session).summary() == updated


def test_public_media_models_never_expose_physical_paths() -> None:
    fields = (
        SongResponse.model_fields,
        LibraryTrackResponse.model_fields,
        DownloadJobResponse.model_fields,
    )
    assert "file_path" not in fields[0]
    assert "file_path" not in fields[1]
    assert "target_path" not in fields[2]


def test_new_orm_columns_store_canonical_names() -> None:
    assert Song.__table__.c.relative_path is not None
    assert LibraryTrack.__table__.c.relative_path is not None
    assert DownloadJob.__table__.c.output_relative_path is not None
    assert DownloadJob.__table__.c.audio_format is not None


def test_storage_gate_returns_structured_423_but_keeps_health_and_status_available() -> None:
    client = TestClient(app)
    storage_coordinator._set_gate()
    try:
        locked = client.get("/api/v1/settings")
        health = client.get("/api/v1/health")
        migration = client.get("/api/v1/settings/storage/migrations/current")
    finally:
        storage_coordinator._unlock()

    assert locked.status_code == 423
    assert locked.json()["error"]["code"] == "storage_migration_in_progress"
    assert health.status_code == 200
    assert migration.status_code == 200
