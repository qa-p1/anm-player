from app.schemas.common import PlaceholderResponse


class PlaceholderService:
    def response(self, *, feature: str, message: str, extension_points: list[str] | None = None) -> PlaceholderResponse:
        return PlaceholderResponse(
            feature=feature,
            message=message,
            extension_points=extension_points or [],
        )
