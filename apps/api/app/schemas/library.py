from datetime import datetime

from pydantic import BaseModel, Field


class LibraryTrackResponse(BaseModel):
    id: int
    source: str = "youtube"
    external_id: str
    title: str
    artist_name: str | None = None
    artist_external_id: str | None = None
    album_id: int | None = None
    album_public_id: str | None = None
    album_title: str | None = None
    duration_seconds: int | None = None
    track_number: int | None = None
    disc_number: int | None = None
    position: int
    source_url: str | None = None
    artwork_url: str | None = None
    artwork_path: str | None = None
    explicit: bool = False
    is_downloaded: bool = False
    is_favorited: bool = False
    is_in_library: bool = True
    created_at: datetime
    updated_at: datetime


class LibraryAlbumResponse(BaseModel):
    id: int
    public_id: str
    canonical_url: str
    source: str = "youtube"
    external_id: str
    title: str
    artist_name: str | None = None
    artist_external_id: str | None = None
    year: int | None = None
    artwork_url: str | None = None
    artwork_path: str | None = None
    description: str | None = None
    track_count: int = 0
    duration_seconds: int | None = None
    is_favorited: bool = False
    download_state: str = "none"
    downloaded_track_count: int = 0
    is_in_library: bool = True
    added_at: datetime
    created_at: datetime
    updated_at: datetime


class LibraryAlbumDetailResponse(LibraryAlbumResponse):
    tracks: list[LibraryTrackResponse] = []


class LibraryArtistResponse(BaseModel):
    id: int | None = None
    source: str = "youtube"
    external_id: str
    name: str
    description: str | None = None
    thumbnail_url: str | None = None
    album_count: int = 0
    track_count: int = 0
    added_at: datetime | None = None


class LibraryArtistDetailResponse(LibraryArtistResponse):
    albums: list[LibraryAlbumResponse] = []
    top_tracks: list[LibraryTrackResponse] = []


class OnlineAlbumTrackPreview(BaseModel):
    source: str = "youtube"
    external_id: str
    title: str
    artist_name: str | None = None
    artist_external_id: str | None = None
    album_title: str | None = None
    duration_seconds: int | None = None
    track_number: int | None = None
    disc_number: int | None = None
    position: int
    source_url: str | None = None
    artwork_url: str | None = None
    explicit: bool = False


class OnlineAlbumPreview(BaseModel):
    source: str = "youtube"
    external_id: str
    title: str
    artist_name: str | None = None
    artist_external_id: str | None = None
    year: int | None = None
    artwork_url: str | None = None
    description: str | None = None
    tracks: list[OnlineAlbumTrackPreview] = []


class SaveOnlineAlbumRequest(BaseModel):
    external_id: str = Field(min_length=1, max_length=255)


class AlbumFavoriteRequest(BaseModel):
    is_favorited: bool


class UnifiedAlbumInternal(BaseModel):
    library_album_id: int | None = None
    local_album_id: int | None = None


class UnifiedAlbumArtist(BaseModel):
    name: str | None = None
    id: str | None = None
    href: str | None = None


class UnifiedAlbumState(BaseModel):
    in_library: bool
    is_favorited: bool
    download: str
    download_progress: int | None = None
    downloaded_track_count: int = 0
    playable_track_count: int = 0


class UnifiedAlbumCapabilities(BaseModel):
    can_play: bool
    can_shuffle: bool
    can_add_to_library: bool
    can_remove_from_library: bool
    can_favorite: bool
    can_download: bool
    can_cancel_download: bool
    can_remove_download: bool


class UnifiedAlbumTrackResponse(BaseModel):
    id: str
    title: str
    artist_name: str | None = None
    duration_seconds: int | None = None
    track_number: int | None = None
    disc_number: int | None = None
    explicit: bool = False
    library_track_id: int | None = None
    song_id: int | None = None
    provider_track_id: str | None = None
    playback_source: str
    is_downloaded: bool
    is_available: bool
    stream_url: str | None = None


class UnifiedAlbumResponse(BaseModel):
    id: str
    canonical_url: str
    source: str
    internal: UnifiedAlbumInternal
    title: str
    artist: UnifiedAlbumArtist
    year: int | None = None
    artwork_url: str | None = None
    description: str | None = None
    track_count: int
    duration_seconds: int | None = None
    state: UnifiedAlbumState
    capabilities: UnifiedAlbumCapabilities
    tracks: list[UnifiedAlbumTrackResponse] = []


class AlbumStatusRequest(BaseModel):
    external_ids: list[str] = Field(min_length=1, max_length=100)


class AlbumStatusItem(BaseModel):
    external_id: str
    public_id: str
    canonical_url: str
    in_library: bool = False
    library_album_id: int | None = None
    is_favorited: bool = False
    download_state: str = "none"


class AlbumStatusResponse(BaseModel):
    statuses: list[AlbumStatusItem]


class TrackStatusRequest(BaseModel):
    external_ids: list[str] = Field(min_length=1, max_length=200)


class TrackStatusItem(BaseModel):
    external_id: str
    is_downloaded: bool = False
    download_source: str | None = None
    download_id: int | None = None


class TrackStatusResponse(BaseModel):
    statuses: list[TrackStatusItem]


class LibraryRemoveResponse(BaseModel):
    removed: bool = True
    deleted_files: int = 0


class LibraryTrackDownloadRemoveResponse(BaseModel):
    track: LibraryTrackResponse
    file_deleted: bool


class AlbumDownloadJobResponse(BaseModel):
    id: int
    album_id: int
    status: str
    progress: int
    total_tracks: int
    completed_tracks: int
    failed_tracks: int
    max_parallel: int
    error_message: str | None = None
    completed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class AlbumDownloadCreateRequest(BaseModel):
    max_parallel: int | None = Field(default=None, ge=1, le=8)


class PlaylistLibraryTrackAddRequest(BaseModel):
    track_ids: list[int] = Field(min_length=1, max_length=100)
    force: bool = False


class PlaylistImportRequest(BaseModel):
    url: str = Field(min_length=1, max_length=4096)
    name: str | None = Field(default=None, max_length=255)
    max_parallel: int | None = Field(default=None, ge=1, le=8)


class MixedPlaylistTrackResponse(BaseModel):
    item_type: str
    position: int
    song_id: int | None = None
    track: LibraryTrackResponse | None = None


class LibrarySearchResult(BaseModel):
    item_type: str
    id: int | str
    title: str
    subtitle: str | None = None
    artwork_url: str | None = None
    artwork_path: str | None = None
    href: str


class LibrarySearchResponse(BaseModel):
    query: str
    results: list[LibrarySearchResult]


class SmartCollectionResponse(BaseModel):
    id: str
    title: str
    description: str
    tracks: list[LibraryTrackResponse] = []
    albums: list[LibraryAlbumResponse] = []
