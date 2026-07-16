from app.api.v1.routes.discovery import get_discovery_service


def test_discovery_service_can_be_created() -> None:
    service = get_discovery_service()

    assert service is not None
