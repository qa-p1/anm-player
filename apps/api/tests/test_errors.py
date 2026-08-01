from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app, base_url="http://localhost")


def test_validation_errors_use_consistent_shape() -> None:
    response = client.get("/api/v1/songs?limit=0")

    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "validation_error"
    assert body["error"]["message"] == "Request validation failed."
