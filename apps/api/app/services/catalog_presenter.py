from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.models import (
    Favorite,
    LibraryAlbum,
    LibraryTrack,
    Playlist,
    PlaylistLibraryTrack,
)
from app.repositories.music import (
    FavoriteRepository,
)
from app.schemas.music import (
    AlbumResponse,
    ArtistResponse,
    HistoryResponse,
    PlaylistResponse,
    SongResponse,
)
from app.services.file_paths import download_available
from app.services.library_presenter import LibraryPresenter


class CatalogPresenter:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.favorites = FavoriteRepository(session)
        self.library = LibraryPresenter(session)

    def album_public_ids(self, album_ids: list[int]) -> dict[int, str]:
        ids = set(album_ids)
        if not ids:
            return {}
        rows = self.session.execute(
            select(LibraryAlbum.local_album_id, LibraryAlbum.public_id).where(
                LibraryAlbum.local_album_id.in_(ids)
            )
        )
        # Rows unpack as tuples directly; Result.tuples() is deprecated in SQLAlchemy 2.1.
        return {local_id: public_id for local_id, public_id in rows}

    def songs_to_response(
        self,
        songs,
        *,
        favorite_ids: set[int] | None = None,
    ) -> list[SongResponse]:
        song_list = list(songs)
        if favorite_ids is None:
            favorite_ids = self.favorites.ids_for(
                Favorite.song_id, [song.id for song in song_list]
            )
        public_ids = self.album_public_ids(
            [song.album_id for song in song_list if song.album_id]
        )
        return [
            self.song_to_response(
                song, favorite_ids=favorite_ids, public_ids=public_ids
            )
            for song in song_list
        ]

    def simple_albums_to_response(self, albums) -> list[AlbumResponse]:
        album_list = list(albums)
        favorite_ids = self.favorites.ids_for(
            Favorite.album_id, [album.id for album in album_list]
        )
        public_ids = self.album_public_ids([album.id for album in album_list])
        return [
            self.album_to_response_simple(
                album, favorite_ids=favorite_ids, public_ids=public_ids
            )
            for album in album_list
        ]

    def online_playlist_links(
        self, playlist_ids: list[int]
    ) -> dict[int, list[PlaylistLibraryTrack]]:
        ids = set(playlist_ids)
        if not ids:
            return {}
        links = self.session.scalars(
            select(PlaylistLibraryTrack)
            .options(
                joinedload(PlaylistLibraryTrack.track).joinedload(LibraryTrack.album),
                joinedload(PlaylistLibraryTrack.track).joinedload(LibraryTrack.song),
            )
            .where(PlaylistLibraryTrack.playlist_id.in_(ids))
            .order_by(PlaylistLibraryTrack.playlist_id, PlaylistLibraryTrack.position)
        ).unique()
        grouped = {playlist_id: [] for playlist_id in ids}
        for link in links:
            grouped[link.playlist_id].append(link)
        return grouped

    def history_entries_to_response(self, entries) -> list[HistoryResponse]:
        entry_list = list(entries)
        song_responses = self.songs_to_response(
            [entry.song for entry in entry_list if entry.song]
        )
        songs_by_id = {song.id: song for song in song_responses}
        return [
            self.history_to_response(entry, songs_by_id=songs_by_id)
            for entry in entry_list
        ]

    def song_to_response(
        self,
        song,
        *,
        favorite_ids: set[int] | None = None,
        public_ids: dict[int, str] | None = None,
    ) -> SongResponse:
        is_favorited = (
            self.favorites.is_favorited("song", song.id)
            if favorite_ids is None
            else song.id in favorite_ids
        )
        album_public_id = (
            self.album_public_id(song.album_id)
            if public_ids is None and song.album_id
            else (public_ids or {}).get(song.album_id)
        )
        return SongResponse(
            id=song.id,
            title=song.title,
            artist_id=song.artist_id,
            artist_name=song.artist.name if song.artist else None,
            album_id=song.album_id,
            album_public_id=album_public_id,
            album_title=song.album.title if song.album else None,
            duration_seconds=song.duration_seconds,
            track_number=song.track_number,
            disc_number=song.disc_number,
            artwork_path=song.artwork_path
            or (song.album.artwork_path if song.album else None),
            artwork_url=song.artwork_url
            or (song.album.artwork_url if song.album else None),
            source_url=song.source_url,
            is_downloaded=self.downloaded_song_file_exists(song),
            is_favorited=is_favorited,
            created_at=song.created_at,
            updated_at=song.updated_at,
        )

    def artist_to_response(
        self,
        artist,
        song_count: int,
        album_count: int,
        *,
        favorite_ids: set[int] | None = None,
    ) -> ArtistResponse:
        is_favorited = (
            self.favorites.is_favorited("artist", artist.id)
            if favorite_ids is None
            else artist.id in favorite_ids
        )
        artwork_path, artwork_url = self.artist_artwork(artist)
        return ArtistResponse(
            id=artist.id,
            name=artist.name,
            sort_name=artist.sort_name,
            artwork_path=artwork_path,
            artwork_url=artwork_url,
            song_count=song_count,
            album_count=album_count,
            is_favorited=is_favorited,
            created_at=artist.created_at,
            updated_at=artist.updated_at,
        )

    def album_to_response_simple(
        self,
        album,
        *,
        favorite_ids: set[int] | None = None,
        public_ids: dict[int, str] | None = None,
    ) -> AlbumResponse:
        is_favorited = (
            self.favorites.is_favorited("album", album.id)
            if favorite_ids is None
            else album.id in favorite_ids
        )
        available_songs = [
            song for song in album.songs if self.downloaded_song_file_exists(song)
        ]
        song_count = len(available_songs)
        duration_seconds = sum(song.duration_seconds or 0 for song in available_songs)
        artwork_path, artwork_url = self.album_artwork(album)
        return AlbumResponse(
            id=album.id,
            public_id=self.album_public_id(album.id)
            if public_ids is None
            else public_ids.get(album.id),
            title=album.title,
            artist_id=album.artist_id,
            artist_name=album.artist.name if album.artist else None,
            year=album.year,
            artwork_path=artwork_path,
            artwork_url=artwork_url,
            song_count=song_count,
            duration_seconds=duration_seconds,
            is_favorited=is_favorited,
            created_at=album.created_at,
            updated_at=album.updated_at,
        )

    def album_public_id(self, local_album_id: int) -> str | None:
        return self.session.scalars(
            select(LibraryAlbum.public_id).where(
                LibraryAlbum.local_album_id == local_album_id
            )
        ).first()

    def playlist_to_response(
        self,
        playlist: Playlist,
        *,
        online_links: list[PlaylistLibraryTrack] | None = None,
    ) -> PlaylistResponse:
        song_count = len(playlist.songs) if hasattr(playlist, "songs") else 0
        duration_seconds = (
            sum(
                ps.song.duration_seconds or 0
                for ps in playlist.songs
                if ps.song and ps.song.duration_seconds
            )
            if hasattr(playlist, "songs")
            else 0
        )
        if online_links is None:
            online_links = self.online_playlist_links([playlist.id]).get(
                playlist.id, []
            )
        song_count += len(online_links)
        duration_seconds += sum(
            link.track.duration_seconds or 0
            for link in online_links
            if link.track and link.track.duration_seconds
        )
        return PlaylistResponse(
            id=playlist.id,
            name=playlist.name,
            description=playlist.description,
            artwork_path=playlist.artwork_path,
            song_count=song_count,
            duration_seconds=duration_seconds,
            created_at=playlist.created_at,
            updated_at=playlist.updated_at,
        )

    @staticmethod
    def album_artwork(album) -> tuple[str | None, str | None]:
        if album.artwork_path or album.artwork_url:
            return album.artwork_path, album.artwork_url
        for song in getattr(album, "songs", ()):
            if song.artwork_path or song.artwork_url:
                return song.artwork_path, song.artwork_url
        return None, None

    @classmethod
    def artist_artwork(cls, artist) -> tuple[str | None, str | None]:
        if artist.artwork_path or artist.artwork_url:
            return artist.artwork_path, artist.artwork_url
        for album in getattr(artist, "albums", ()):
            artwork = cls.album_artwork(album)
            if any(artwork):
                return artwork
        for song in getattr(artist, "songs", ()):
            if song.artwork_path or song.artwork_url:
                return song.artwork_path, song.artwork_url
        return None, None

    def history_to_response(
        self,
        entry,
        *,
        songs_by_id: dict[int, SongResponse] | None = None,
    ) -> HistoryResponse:
        song_response = None
        if entry.song:
            song_response = (
                self.song_to_response(entry.song)
                if songs_by_id is None
                else songs_by_id.get(entry.song.id)
            )
        return HistoryResponse(
            id=entry.id,
            song_id=entry.song_id,
            song=song_response,
            source=entry.source,
            external_id=entry.external_id,
            title=entry.title or (song_response.title if song_response else None),
            artist_name=entry.artist_name
            or (song_response.artist_name if song_response else None),
            album_title=entry.album_title
            or (song_response.album_title if song_response else None),
            artwork_url=(
                song_response.artwork_path
                or song_response.artwork_url
                or entry.artwork_url
                if song_response
                else entry.artwork_url
            ),
            duration_seconds=entry.duration_seconds
            or (song_response.duration_seconds if song_response else None),
            source_url=entry.source_url
            or (song_response.source_url if song_response else None),
            event_type=entry.event_type,
            played_at=entry.played_at,
            position_seconds=entry.position_seconds,
            outcome=entry.outcome,
        )

    @staticmethod
    def downloaded_song_file_exists(song) -> bool:
        return download_available(song.is_downloaded, song.relative_path)
