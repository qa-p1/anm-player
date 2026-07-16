from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_health_endpoint() -> None:
    response = client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "aura-api"}


def test_version_endpoint() -> None:
    response = client.get("/api/v1/health/version")

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Aura"
    assert body["version"]
    assert body["environment"]


def test_openapi_is_available_under_v1() -> None:
    response = client.get("/api/v1/openapi.json")

    assert response.status_code == 200
    assert response.json()["info"]["title"] == "Aura API"
