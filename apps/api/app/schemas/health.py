from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: str
    service: str


class VersionResponse(BaseModel):
    name: str
    version: str
    environment: str


class StorageInfo(BaseModel):
    data_root: str


class AppInfoResponse(BaseModel):
    name: str
    version: str
    environment: str
    api_prefix: str
    database: str
    storage: StorageInfo
