from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class StorageCategoryUsage(BaseModel):
    database: int = 0
    music: int = 0
    downloads: int = 0
    artwork: int = 0
    lyrics: int = 0
    streams: int = 0
    config: int = 0
    thumbnails: int = 0
    logs: int = 0
    other: int = 0


class StorageSummary(BaseModel):
    data_root: str
    used_bytes: int
    free_bytes: int
    total_bytes: int
    categories: StorageCategoryUsage
    migration: dict[str, object]


class DirectoryEntry(BaseModel):
    directory_id: str | None = None
    name: str
    display_path: str
    disabled: bool = False
    empty: bool = False
    same_device: bool | None = None
    reason: str | None = None


class DirectoryListing(BaseModel):
    current: DirectoryEntry | None = None
    parent: DirectoryEntry | None = None
    directories: list[DirectoryEntry]


class CreateDirectoryRequest(BaseModel):
    parent_id: str = Field(min_length=1, max_length=4096)
    name: str = Field(min_length=1, max_length=120, pattern=r"^[^<>:\"/\\|?*]+$")


class StartMigrationRequest(BaseModel):
    directory_id: str = Field(min_length=1, max_length=4096)


class StartMigrationResponse(BaseModel):
    operation_id: str
    status: Literal["accepted"] = "accepted"


class StartResetRequest(BaseModel):
    directory_id: str = Field(min_length=1, max_length=4096)
    confirmation: str = Field(min_length=1, max_length=32)


class CacheClearRequest(BaseModel):
    category: Literal["artwork", "streams", "lyrics", "all"]


class CacheClearResponse(BaseModel):
    files_removed: int
    bytes_removed: int
