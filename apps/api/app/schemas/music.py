from datetime import datetime

from pydantic import BaseModel, Field, HttpUrl

from app.schemas.library import LibraryAlbumResponse, LibraryTrackResponse, MixedPlaylistTrackResponse


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=200)


class SearchResult(BaseModel):
    video_id: str
    title: str
    artist: str | None = None
    thumbnail: str | None = None
    duration: int | None = None
    upload_date: str | None = None
    view_count: int | None = None
    channel: str | None = None
    url: str
    rank_score: float = 0


class SearchResponse(BaseModel):
    query: str
    results: list[SearchResult]


class DownloadCreateRequest(BaseModel):
    source_url: HttpUrl
    video_id: str | None = None
    search_query: str | None = None
    title: str | None = None
    artist: str | None = None
    album: str | None = None
    thumbnail_url: str | None = None
    overwrite_existing: bool | None = None


class DownloadBatchCreateRequest(BaseModel):
    items: list[DownloadCreateRequest] = Field(min_length=1, max_length=50)


class SongResponse(BaseModel):
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


class ArtistResponse(BaseModel):
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


class AlbumResponse(BaseModel):
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


class PlaylistResponse(BaseModel):
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
    description: str | None = None


class PlaylistUpdateRequest(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = None


class PlaylistAddSongsRequest(BaseModel):
    song_ids: list[int] = Field(min_length=1, max_length=100)


class PlaylistAddOnlineTrackRequest(BaseModel):
    external_id: str = Field(min_length=1, max_length=255)
    title: str = Field(min_length=1, max_length=255)
    artist_name: str | None = Field(default=None, max_length=255)
    artist_external_id: str | None = Field(default=None, max_length=255)
    album_title: str | None = Field(default=None, max_length=255)
    duration_seconds: int | None = None
    source_url: str | None = Field(default=None, max_length=2048)
    artwork_url: str | None = Field(default=None, max_length=2048)
    explicit: bool = False


class PlaylistReorderRequest(BaseModel):
    song_id: int
    new_position: int = Field(ge=0)


class FavoriteToggleRequest(BaseModel):
    entity_type: str = Field(pattern="^(song|artist|album|playlist|library_album|library_track)$")
    entity_id: int


class FavoritesResponse(BaseModel):
    songs: list[SongResponse] = []
    artists: list[ArtistResponse] = []
    albums: list[AlbumResponse] = []
    playlists: list[PlaylistResponse] = []
    library_albums: list[LibraryAlbumResponse] = []
    library_tracks: list[LibraryTrackResponse] = []


class HistoryCreateRequest(BaseModel):
    song_id: int | None = None
    source: str = Field(default="local", pattern="^(local|youtube)$")
    external_id: str | None = Field(default=None, max_length=255)
    title: str | None = Field(default=None, max_length=255)
    artist_name: str | None = Field(default=None, max_length=255)
    album_title: str | None = Field(default=None, max_length=255)
    artwork_url: str | None = Field(default=None, max_length=2048)
    duration_seconds: int | None = None
    source_url: str | None = Field(default=None, max_length=2048)
    position_seconds: int | None = None
    event_type: str = Field(default="played", pattern="^(played|skipped|completed)$")


class HistoryResponse(BaseModel):
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


class RecommendationRequest(BaseModel):
    strategy: str = Field(
        default="mixed",
        pattern="^(mixed|similar_artists|popular|discovery|time_based)$",
    )
    limit: int = Field(default=20, ge=1, le=100)
    entity_type: str = Field(default="song", pattern="^(song|album)$")


class RecommendationResponse(BaseModel):
    strategy: str
    entity_type: str
    songs: list[SongResponse] = []
    albums: list[AlbumResponse] = []
