from datetime import datetime
from typing import Annotated
from urllib.parse import urlsplit

from pydantic import BaseModel, Field, HttpUrl, field_validator

from app.schemas.artwork import ArtworkResponseModel
from app.schemas.library import LibraryAlbumResponse, LibraryTrackResponse, MixedPlaylistTrackResponse


class DownloadCreateRequest(BaseModel):
    source_url: HttpUrl
    video_id: str | None = Field(default=None, min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")
    search_query: str | None = Field(default=None, min_length=1, max_length=512)
    title: str | None = Field(default=None, max_length=255)
    artist: str | None = Field(default=None, max_length=255)
    album: str | None = Field(default=None, max_length=255)
    thumbnail_url: str | None = Field(default=None, max_length=2048)
    overwrite_existing: bool | None = None

    @field_validator("source_url")
    @classmethod
    def validate_source_url(cls, value: HttpUrl) -> HttpUrl:
        if not _is_https_youtube_url(str(value)):
            raise ValueError("Download source must be an HTTPS YouTube URL")
        return value


class DownloadBatchCreateRequest(BaseModel):
    items: list[DownloadCreateRequest] = Field(min_length=1, max_length=50)


class SongResponse(ArtworkResponseModel):
    id: int
    title: str
    artist_id: int | None = None
    artist_name: str | None = None
    album_id: int | None = None
    album_public_id: str | None = None
    album_title: str | None = None
    duration_seconds: int | None = None
    track_number: int | None = None
    disc_number: int | None = None
    artwork_path: str | None = None
    artwork_url: str | None = None
    source_url: str | None = None
    is_downloaded: bool = False
    is_favorited: bool = False
    created_at: datetime
    updated_at: datetime


class ArtistResponse(ArtworkResponseModel):
    id: int
    name: str
    sort_name: str | None = None
    artwork_path: str | None = None
    artwork_url: str | None = None
    song_count: int = 0
    album_count: int = 0
    is_favorited: bool = False
    created_at: datetime
    updated_at: datetime


class AlbumResponse(ArtworkResponseModel):
    id: int
    public_id: str | None = None
    title: str
    artist_id: int | None = None
    artist_name: str | None = None
    year: int | None = None
    artwork_path: str | None = None
    artwork_url: str | None = None
    song_count: int = 0
    duration_seconds: int | None = None
    is_favorited: bool = False
    created_at: datetime
    updated_at: datetime


class PlaylistResponse(ArtworkResponseModel):
    id: int
    name: str
    description: str | None = None
    artwork_path: str | None = None
    song_count: int = 0
    duration_seconds: int | None = None
    created_at: datetime
    updated_at: datetime


class PlaylistItemResponse(BaseModel):
    item_type: str
    position: int
    song: SongResponse | None = None
    track: LibraryTrackResponse | None = None


class PlaylistDetailResponse(PlaylistResponse):
    songs: list[SongResponse] = []
    library_tracks: list[MixedPlaylistTrackResponse] = []
    items: list[PlaylistItemResponse] = []


class ArtistDetailResponse(ArtistResponse):
    albums: list[AlbumResponse] = []
    top_songs: list[SongResponse] = []


class AlbumDetailResponse(AlbumResponse):
    songs: list[SongResponse] = []


class PlaylistCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)


PositiveId = Annotated[int, Field(gt=0, le=2_147_483_647)]


class PlaylistAddSongsRequest(BaseModel):
    song_ids: list[PositiveId] = Field(min_length=1, max_length=50)


class PlaylistAddOnlineTrackRequest(BaseModel):
    external_id: str = Field(min_length=1, max_length=255)
    title: str = Field(min_length=1, max_length=255)
    artist_name: str | None = Field(default=None, max_length=255)
    artist_external_id: str | None = Field(default=None, max_length=255)
    album_title: str | None = Field(default=None, max_length=255)
    duration_seconds: int | None = Field(default=None, ge=0, le=86400)
    source_url: str | None = Field(default=None, max_length=2048)
    artwork_url: str | None = Field(default=None, max_length=2048)
    explicit: bool = False

    @field_validator("source_url")
    @classmethod
    def validate_source_url(cls, value: str | None) -> str | None:
        if value and not _is_https_youtube_url(value):
            raise ValueError("Track source must be an HTTPS YouTube URL")
        return value


class FavoriteToggleRequest(BaseModel):
    entity_type: str = Field(pattern="^(song|artist|album|playlist|library_album|library_track)$")
    entity_id: int = Field(gt=0, le=2_147_483_647)


class FavoritesResponse(BaseModel):
    songs: list[SongResponse] = []
    artists: list[ArtistResponse] = []
    albums: list[AlbumResponse] = []
    playlists: list[PlaylistResponse] = []
    library_albums: list[LibraryAlbumResponse] = []
    library_tracks: list[LibraryTrackResponse] = []


class HistoryCreateRequest(BaseModel):
    song_id: int | None = Field(default=None, gt=0, le=2_147_483_647)
    source: str = Field(default="local", pattern="^(local|youtube)$")
    external_id: str | None = Field(default=None, max_length=255)
    title: str | None = Field(default=None, max_length=255)
    artist_name: str | None = Field(default=None, max_length=255)
    album_title: str | None = Field(default=None, max_length=255)
    artwork_url: str | None = Field(default=None, max_length=2048)
    duration_seconds: int | None = Field(default=None, ge=0, le=86400)
    source_url: str | None = Field(default=None, max_length=2048)
    position_seconds: int | None = Field(default=None, ge=0, le=86400)
    event_type: str = Field(default="played", pattern="^(played|skipped|completed)$")


class HistoryResponse(ArtworkResponseModel):
    id: int
    song_id: int | None = None
    song: SongResponse | None = None
    source: str = "local"
    external_id: str | None = None
    title: str | None = None
    artist_name: str | None = None
    album_title: str | None = None
    artwork_url: str | None = None
    duration_seconds: int | None = None
    source_url: str | None = None
    event_type: str
    played_at: datetime
    position_seconds: int | None = None


class DownloadJobResponse(BaseModel):
    id: int
    status: str
    progress: int = Field(ge=0, le=100)
    stage: str
    title: str | None = None
    artist: str | None = None
    album: str | None = None
    thumbnail_url: str | None = None
    source_url: str | None = None
    video_id: str | None = None
    search_query: str | None = None
    speed: str | None = None
    eta: str | None = None
    error_message: str | None = None
    completed_at: datetime | None = None
    cancelled_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    group: "DownloadGroupRef | None" = None


class DownloadGroupRef(BaseModel):
    type: str = "album"
    album_id: str
    title: str
    canonical_url: str


class QueueItemResponse(BaseModel):
    id: int
    download_job_id: int | None = None
    item_type: str
    status: str
    priority: int
    created_at: datetime
    updated_at: datetime


def _is_https_youtube_url(value: str) -> bool:
    try:
        parsed = urlsplit(value)
        host = (parsed.hostname or "").casefold().rstrip(".")
        if parsed.scheme != "https" or parsed.username or parsed.password:
            return False
        if parsed.port not in (None, 443):
            return False
    except ValueError:
        return False
    return host == "youtu.be" or host == "youtube.com" or host.endswith(".youtube.com")
