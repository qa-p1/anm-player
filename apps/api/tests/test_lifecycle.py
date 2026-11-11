from contextlib import nullcontext
from types import SimpleNamespace

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.api.deps import require_operator
from app.api.v1.routes import lifecycle
from app.core.config import settings


def client():
    app = FastAPI()
    app.include_router(lifecycle.router, prefix="/app", dependencies=[Depends(require_operator)])
    return TestClient(app)


def test_shutdown_requires_operator(monkeypatch):
    monkeypatch.setattr(settings, "api_access_token", "test-token")
    response = client().post("/app/shutdown")
    assert response.status_code == 401


def test_shutdown_reports_unmanaged_start(monkeypatch):
    monkeypatch.delenv("ANM_LAUNCHER_CONTROL_PORT", raising=False)
    monkeypatch.delenv("ANM_LAUNCHER_CONTROL_TOKEN", raising=False)
    assert client().post("/app/shutdown").status_code == 409


def test_shutdown_forwards_secret_only_to_loopback_launcher(monkeypatch):
    monkeypatch.setenv("ANM_LAUNCHER_CONTROL_PORT", "12345")
    monkeypatch.setenv("ANM_LAUNCHER_CONTROL_TOKEN", "private-control-token")
    requests = []

    def open_request(request, timeout):
        requests.append(request)
        return nullcontext(SimpleNamespace(status=200))

    monkeypatch.setattr(lifecycle, "build_opener", lambda *args: SimpleNamespace(open=open_request))
    response = client().post("/app/shutdown")
    assert response.status_code == 202
    assert response.json() == {"status": "shutting_down"}
    assert requests[0].full_url == "http://127.0.0.1:12345/stop"
    assert requests[0].get_header("Authorization") == "Bearer private-control-token"
    assert "private-control-token" not in response.text


def test_update_routes_require_operator(monkeypatch):
    monkeypatch.setattr(settings, "api_access_token", "test-token")
    assert client().get("/app/updates").status_code == 401
    assert client().post("/app/updates/check").status_code == 401
    assert client().post("/app/updates/install").status_code == 401


def test_unmanaged_or_docker_install_cannot_self_update(monkeypatch):
    monkeypatch.delenv("ANM_LAUNCHER_CONTROL_PORT", raising=False)
    monkeypatch.delenv("ANM_LAUNCHER_CONTROL_TOKEN", raising=False)
    assert client().get("/app/updates").json()["supported"] is False
    assert client().post("/app/updates/check").status_code == 409


def test_update_commands_use_only_authenticated_launcher(monkeypatch):
    import json
    monkeypatch.setenv("ANM_LAUNCHER_CONTROL_PORT", "12345")
    monkeypatch.setenv("ANM_LAUNCHER_CONTROL_TOKEN", "private-control-token")
    requests = []
    def open_request(request, timeout):
        requests.append(request)
        return nullcontext(SimpleNamespace(read=lambda *_: json.dumps({"state": "checking", "supported": True}).encode()))
    monkeypatch.setattr(lifecycle, "build_opener", lambda *args: SimpleNamespace(open=open_request))
    response = client().post("/app/updates/check")
    assert response.status_code == 202
    assert requests[0].full_url == "http://127.0.0.1:12345/updates/check"
    assert requests[0].get_header("Authorization") == "Bearer private-control-token"
    assert "private-control-token" not in response.text


def test_update_rejects_cross_origin_requests(monkeypatch):
    monkeypatch.setenv("ANM_WEB_PORT", "5173")
    for origin in ("https://example.com", "null", "http://127.0.0.1:9999"):
        assert client().post("/app/updates/install", headers={"Origin": origin}).status_code == 403


def test_storage_changes_wait_for_native_updates(tmp_path, monkeypatch):
    import json
    from app.storage.middleware import StorageGateMiddleware
    state = tmp_path / "update.json"
    monkeypatch.setenv("ANM_UPDATE_STATE_FILE", str(state))
    app = FastAPI()
    app.add_middleware(StorageGateMiddleware)
    @app.post("/api/v1/settings/storage/reset")
    def reset_stub():
        return {"ok": True}
    with TestClient(app) as test:
        for phase in ("downloading", "installing", "building", "restarting"):
            state.write_text(json.dumps({"state": phase}))
            response = test.post("/api/v1/settings/storage/reset")
            assert response.status_code == 409
            assert response.json()["error"]["code"] == "app_update_in_progress"
        state.write_text(json.dumps({"state": "current"}))
        assert test.post("/api/v1/settings/storage/reset").status_code == 200
