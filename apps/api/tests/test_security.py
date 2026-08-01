from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app
from app.services.artwork_cache import ArtworkCacheService


client = TestClient(app, base_url="http://localhost")


def test_removed_scanner_route_returns_not_found(monkeypatch) -> None:
    monkeypatch.setattr(settings, "api_access_token", "test-secret")

    response = client.post("/api/v1/scanner/scan", json={})

    assert response.status_code == 404


def test_remote_artwork_requires_auth_before_fetching(monkeypatch) -> None:
    monkeypatch.setattr(settings, "api_access_token", "test-secret")

    response = client.get(
        "/api/v1/media/remote-artwork",
        params={"url": "https://example.com/image.jpg"},
        headers={"Authorization": "Bearer test-secret"},
    )

    assert response.status_code == 400


def test_all_non_health_http_routes_require_operator_auth(monkeypatch) -> None:
    monkeypatch.setattr(settings, "api_env", "production")
    monkeypatch.setattr(settings, "api_access_token", "test-secret")

    for method, path in (
        ("GET", "/api/v1/settings"),
        ("GET", "/api/v1/playlists"),
        ("POST", "/api/v1/favorites/toggle"),
        ("POST", "/api/v1/history"),
        ("GET", "/api/v1/ytmusic/home"),
        ("GET", "/api/v1/openapi.json"),
    ):
        response = client.request(method, path)
        assert response.status_code == 401, (method, path, response.text)

    assert client.get("/api/v1/health").status_code == 200


def test_query_string_token_is_rejected(monkeypatch) -> None:
    monkeypatch.setattr(settings, "api_env", "production")
    monkeypatch.setattr(settings, "api_access_token", "test-secret")

    response = client.get("/api/v1/settings?access_token=test-secret")

    assert response.status_code == 401


def test_artwork_allowlist_blocks_ssrf_targets(tmp_path) -> None:
    service = ArtworkCacheService(tmp_path)

    assert service.is_allowed_remote_url("https://i.ytimg.com/vi/id/maxresdefault.jpg") is True
    assert service.is_allowed_remote_url("https://lh3.googleusercontent.com/image") is True
    assert service.is_allowed_remote_url("http://i.ytimg.com/image.jpg") is False
    assert service.is_allowed_remote_url("https://i.ytimg.com.evil.example/image.jpg") is False
    assert service.is_allowed_remote_url("https://127.0.0.1/image.jpg") is False
    assert service.is_allowed_remote_url("https://user@i.ytimg.com/image.jpg") is False


def test_unconfigured_token_allows_local_development(monkeypatch) -> None:
    monkeypatch.setattr(settings, "api_access_token", None)
    monkeypatch.setattr(settings, "api_env", "development")

    local_client = TestClient(app, base_url="http://localhost", client=("127.0.0.1", 50000))
    response = local_client.get("/api/v1/media/remote-artwork", params={"url": "https://example.com/image.jpg"})

    assert response.status_code == 400


def test_unconfigured_token_rejects_non_loopback_development_client(monkeypatch) -> None:
    monkeypatch.setattr(settings, "api_access_token", None)
    monkeypatch.setattr(settings, "api_env", "development")

    response = client.get("/api/v1/settings")

    assert response.status_code == 503


def test_unconfigured_token_remains_fail_closed_in_production(monkeypatch) -> None:
    monkeypatch.setattr(settings, "api_access_token", None)
    monkeypatch.setattr(settings, "api_env", "production")

    response = client.get("/api/v1/media/remote-artwork", params={"url": "https://i.ytimg.com/image.jpg"})

    assert response.status_code == 503


def test_untrusted_host_header_is_rejected() -> None:
    response = client.get("/api/v1/health", headers={"Host": "untrusted.example"})

    assert response.status_code == 400
