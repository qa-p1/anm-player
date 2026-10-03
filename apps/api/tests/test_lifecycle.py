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
