from http import HTTPStatus


class AppError(Exception):
    status_code = HTTPStatus.INTERNAL_SERVER_ERROR
    code = "internal_error"

    def __init__(self, message: str, *, details: dict[str, object] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or {}


class ResourceNotFoundError(AppError):
    status_code = HTTPStatus.NOT_FOUND
    code = "resource_not_found"


class ConflictError(AppError):
    status_code = HTTPStatus.CONFLICT
    code = "conflict"


class FeatureNotImplementedError(AppError):
    status_code = HTTPStatus.NOT_IMPLEMENTED
    code = "feature_not_implemented"
