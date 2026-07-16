from app.repositories.music import (
    AlbumRepository,
    ArtistRepository,
    DownloadJobRepository,
    PlaylistRepository,
    QueueItemRepository,
    SongRepository,
)
from app.schemas.common import CountSummary


class LibraryService:
    def __init__(
        self,
        songs: SongRepository,
        artists: ArtistRepository,
        albums: AlbumRepository,
        playlists: PlaylistRepository,
        downloads: DownloadJobRepository,
        queue_items: QueueItemRepository,
    ) -> None:
        self.songs = songs
        self.artists = artists
        self.albums = albums
        self.playlists = playlists
        self.downloads = downloads
        self.queue_items = queue_items

    def summary(self) -> CountSummary:
        return CountSummary(
            songs=self.songs.count(),
            artists=self.artists.count(),
            albums=self.albums.count(),
            playlists=self.playlists.count(),
            downloads=self.downloads.count(),
            queue_items=self.queue_items.count(),
        )
