from app.api.v1.routes import settings as settings_routes


def test_storage_usage_is_reused_briefly_and_refreshed_after_clearing(tmp_path, monkeypatch):
    settings_routes._usage_cache.clear()
    (tmp_path / "music").mkdir()
    (tmp_path / "music" / "a.mp3").write_bytes(b"x" * 10)
    first = settings_routes._storage_usage(tmp_path)
    (tmp_path / "music" / "b.mp3").write_bytes(b"x" * 5)
    assert settings_routes._storage_usage(tmp_path) == first
    monkeypatch.setattr(settings_routes, "USAGE_TTL_SECONDS", 0.0)
    assert settings_routes._storage_usage(tmp_path).music == 15
    settings_routes._usage_cache.clear()
