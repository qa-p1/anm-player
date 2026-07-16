import logging
from http import HTTPStatus

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.core.exceptions import AppError
from app.schemas.errors import ApiError, ApiErrorResponse

logger = logging.getLogger(__name__)


def api_error_response(*, status_code: int, code: str, message: str, details: dict[str, object] | None = None) -> JSONResponse:
    payload = ApiErrorResponse(
        error=ApiError(
            code=code,
            message=message,
            details=details or {},
        ),
    )
    return JSONResponse(status_code=status_code, content=payload.model_dump())


async def app_error_handler(_: Request, exc: AppError) -> JSONResponse:
    logger.info("application error: %s", exc.message, extra={"code": exc.code})
    return api_error_response(
        status_code=int(exc.status_code),
        code=exc.code,
        message=exc.message,
        details=exc.details,
    )


async def validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    return api_error_response(
        status_code=HTTPStatus.UNPROCESSABLE_ENTITY,
        code="validation_error",
        message="Request validation failed.",
        details={"errors": exc.errors()},
    )


async def unhandled_error_handler(_: Request, exc: Exception) -> JSONResponse:
    logger.exception("unhandled application error")
    return api_error_response(
        status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
        code="internal_error",
        message="An unexpected error occurred.",
    )
