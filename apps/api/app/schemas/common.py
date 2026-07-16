from pydantic import BaseModel, Field


class PlaceholderResponse(BaseModel):
    feature: str = Field(description="Feature area represented by this placeholder.")
    status: str = Field(default="not_implemented", description="Implementation status.")
    message: str
    extension_points: list[str] = Field(default_factory=list)


class CountSummary(BaseModel):
    songs: int = 0
    artists: int = 0
    albums: int = 0
    playlists: int = 0
    downloads: int = 0
    queue_items: int = 0
