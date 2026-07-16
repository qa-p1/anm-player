from pydantic import BaseModel, Field


class ApiError(BaseModel):
    code: str
    message: str
    details: dict[str, object] = Field(default_factory=dict)


class ApiErrorResponse(BaseModel):
    error: ApiError
