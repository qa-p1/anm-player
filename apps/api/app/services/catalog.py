from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.exceptions import ResourceNotFoundError
from app.models import (
    Album,
    Artist,
    Favorite,
    LibraryAlbum,
    LibraryTrack,
    Playlist,
    PlaylistSong,
    Song,
)
from app.repositories.music import (
    AlbumRepository,
    ArtistRepository,
    FavoriteRepository,
    HistoryRepository,
    PlaylistRepository,
    SongRepository,
)
from app.schemas.music import (
    AlbumDetailResponse,
    ArtistDetailResponse,
    ArtistResponse,
    FavoritesResponse,
    FavoriteToggleRequest,
    HistoryCreateRequest,
    HistoryResponse,
    SongResponse,
)
from app.services.catalog_presenter import CatalogPresenter
from app.services.library_presenter import LibraryPresenter


class CatalogService:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.songs = SongRepository(session)
        self.artists = ArtistRepository(session)
        self.albums = AlbumRepository(session)
        self.playlists = PlaylistRepository(session)
        self.favorites = FavoriteRepository(session)
        self.history = HistoryRepository(session)
        self.responses = CatalogPresenter(session)

    def list_songs(self, *, limit: int = 50, offset: int = 0) -> list[SongResponse]:
        songs = self.songs.list_with_details(limit=limit, offset=offset)
        return self.responses.songs_to_response(songs)

    def list_artists(self, *, limit: int = 50, offset: int = 0) -> list[ArtistResponse]:
        results = self.artists.list_with_counts(limit=limit, offset=offset)
        favorite_ids = self.responses.favorites.ids_for(
            Favorite.artist_id, [artist.id for artist, _, _ in results]
        )
        return [
            self.responses.artist_to_response(
                artist, song_count, album_count, favorite_ids=favorite_ids
            )
            for artist, song_count, album_count in results
        ]

    def get_artist(self, artist_id: int) -> ArtistDetailResponse:
        artist = self.artists.get_with_details(artist_id)
        if not artist:
            raise ResourceNotFoundError(
                "Artist not found", details={"artist_id": artist_id}
            )

        is_favorited = self.favorites.is_favorited("artist", artist_id)
        available_songs = [
            song
            for song in artist.songs
            if self.responses.downloaded_song_file_exists(song)
        ]
        available_albums = [
            album
            for album in artist.albums
            if any(
                self.responses.downloaded_song_file_exists(song) for song in album.songs
            )
        ]
        albums = self.responses.simple_albums_to_response(available_albums)
        top_songs = self.responses.songs_to_response(available_songs[:10])
        artwork_path, artwork_url = self.responses.artist_artwork(artist)

        return ArtistDetailResponse(
            id=artist.id,
            name=artist.name,
            sort_name=artist.sort_name,
            artwork_path=artwork_path,
            artwork_url=artwork_url,
            song_count=len(available_songs),
            album_count=len(available_albums),
            is_favorited=is_favorited,
            created_at=artist.created_at,
            updated_at=artist.updated_at,
            albums=albums,
            top_songs=top_songs,
        )

    def get_album(self, album_id: int) -> AlbumDetailResponse:
        album = self.albums.get_with_details(album_id)
        if not album:
            raise ResourceNotFoundError(
                "Album not found", details={"album_id": album_id}
            )

        is_favorited = self.favorites.is_favorited("album", album_id)
        available_songs = [
            song
            for song in album.songs
            if self.responses.downloaded_song_file_exists(song)
        ]
        songs = self.responses.songs_to_response(available_songs)
        duration_seconds = sum(song.duration_seconds or 0 for song in available_songs)
        artwork_path, artwork_url = self.responses.album_artwork(album)

        return AlbumDetailResponse(
            id=album.id,
            public_id=self.responses.album_public_id(album.id),
            title=album.title,
            artist_id=album.artist_id,
            artist_name=album.artist.name if album.artist else None,
            year=album.year,
            artwork_path=artwork_path,
            artwork_url=artwork_url,
            song_count=len(songs),
            duration_seconds=duration_seconds,
            is_favorited=is_favorited,
            created_at=album.created_at,
            updated_at=album.updated_at,
            songs=songs,
        )

    def toggle_favorite(self, request: FavoriteToggleRequest) -> bool:
        targets = {
            "song": self.songs.get,
            "artist": self.artists.get,
            "album": self.albums.get,
            "playlist": self.playlists.get,
            "library_album": lambda entity_id: self.favorites.session.get(
                LibraryAlbum, entity_id
            ),
            "library_track": lambda entity_id: self.favorites.session.get(
                LibraryTrack, entity_id
            ),
        }
        target_getter = targets.get(request.entity_type)
        if not target_getter or not target_getter(request.entity_id):
            raise ResourceNotFoundError(
                "Favorite target not found",
                details={
                    "entity_type": request.entity_type,
                    "entity_id": request.entity_id,
                },
            )
        is_favorited = self.favorites.toggle(request.entity_type, request.entity_id)
        self.favorites.session.commit()
        return is_favorited

    def list_favorites(self) -> FavoritesResponse:
        response = FavoritesResponse()
        library_responses = LibraryPresenter(self.session)
        favorites = self.favorites.list_all()
        song_ids = {favorite.song_id for favorite in favorites if favorite.song_id}
        artist_ids = {
            favorite.artist_id for favorite in favorites if favorite.artist_id
        }
        album_ids = {favorite.album_id for favorite in favorites if favorite.album_id}
        playlist_ids = {
            favorite.playlist_id for favorite in favorites if favorite.playlist_id
        }
        library_album_ids = {
            favorite.library_album_id
            for favorite in favorites
            if favorite.library_album_id
        }
        library_track_ids = {
            favorite.library_track_id
            for favorite in favorites
            if favorite.library_track_id
        }

        songs = (
            list(
                self.favorites.session.scalars(
                    select(Song)
                    .options(joinedload(Song.artist), joinedload(Song.album))
                    .where(Song.id.in_(song_ids))
                )
            )
            if song_ids
            else []
        )
        artists = (
            list(
                self.favorites.session.scalars(
                    select(Artist)
                    .options(
                        selectinload(Artist.songs),
                        selectinload(Artist.albums).selectinload(Album.songs),
                    )
                    .where(Artist.id.in_(artist_ids))
                )
            )
            if artist_ids
            else []
        )
        albums = (
            list(
                self.favorites.session.scalars(
                    select(Album)
                    .options(joinedload(Album.artist), selectinload(Album.songs))
                    .where(Album.id.in_(album_ids))
                )
            )
            if album_ids
            else []
        )
        playlists = (
            list(
                self.favorites.session.scalars(
                    select(Playlist)
                    .options(selectinload(Playlist.songs).joinedload(PlaylistSong.song))
                    .where(Playlist.id.in_(playlist_ids))
                )
            )
            if playlist_ids
            else []
        )
        library_albums = (
            list(
                self.favorites.session.scalars(
                    select(LibraryAlbum)
                    .options(
                        selectinload(LibraryAlbum.tracks).joinedload(LibraryTrack.song)
                    )
                    .where(LibraryAlbum.id.in_(library_album_ids))
                )
            )
            if library_album_ids
            else []
        )
        library_tracks = (
            list(
                self.favorites.session.scalars(
                    select(LibraryTrack)
                    .options(
                        joinedload(LibraryTrack.album), joinedload(LibraryTrack.song)
                    )
                    .where(LibraryTrack.id.in_(library_track_ids))
                )
            )
            if library_track_ids
            else []
        )

        song_responses = {
            song.id: song
            for song in self.responses.songs_to_response(songs, favorite_ids=song_ids)
        }
        artists_by_id = {artist.id: artist for artist in artists}
        albums_by_id = {album.id: album for album in albums}
        playlists_by_id = {playlist.id: playlist for playlist in playlists}
        library_albums_by_id = {album.id: album for album in library_albums}
        library_tracks_by_id = {track.id: track for track in library_tracks}
        public_ids = self.responses.album_public_ids([album.id for album in albums])
        online_by_playlist = self.responses.online_playlist_links(
            [playlist.id for playlist in playlists]
        )
        for favorite in favorites:
            if favorite.song_id and (song := song_responses.get(favorite.song_id)):
                response.songs.append(song)
            elif favorite.artist_id and (
                artist := artists_by_id.get(favorite.artist_id)
            ):
                response.artists.append(
                    self.responses.artist_to_response(
                        artist,
                        len([song for song in artist.songs if song.is_downloaded]),
                        len(artist.albums),
                        favorite_ids=artist_ids,
                    )
                )
            elif favorite.album_id and (album := albums_by_id.get(favorite.album_id)):
                response.albums.append(
                    self.responses.album_to_response_simple(
                        album,
                        favorite_ids=album_ids,
                        public_ids=public_ids,
                    )
                )
            elif favorite.playlist_id and (
                playlist := playlists_by_id.get(favorite.playlist_id)
            ):
                response.playlists.append(
                    self.responses.playlist_to_response(
                        playlist,
                        online_links=online_by_playlist.get(playlist.id, []),
                    )
                )
            elif favorite.library_album_id and (
                album := library_albums_by_id.get(favorite.library_album_id)
            ):
                response.library_albums.append(
                    library_responses.album_to_response(album, is_favorited=True)
                )
            elif favorite.library_track_id and (
                track := library_tracks_by_id.get(favorite.library_track_id)
            ):
                response.library_tracks.append(
                    library_responses.track_to_response(track, is_favorited=True)
                )
        return response

    def add_history(self, request: HistoryCreateRequest) -> HistoryResponse:
        from app.models.history import History

        song = self.songs.get(request.song_id) if request.song_id else None
        library_track = None
        if request.source == "local" and not song:
            raise ResourceNotFoundError(
                "Song not found", details={"song_id": request.song_id}
            )
        if request.source == "youtube" and not request.external_id:
            raise ResourceNotFoundError("History item missing video id")
        if request.source == "youtube" and request.external_id:
            library_track = self.history.session.scalars(
                select(LibraryTrack).where(
                    LibraryTrack.source == "youtube",
                    LibraryTrack.external_id == request.external_id,
                )
            ).first()
            if (
                library_track
                and library_track.duration_seconds is None
                and request.duration_seconds
            ):
                library_track.duration_seconds = request.duration_seconds

        history_entry = History(
            song_id=song.id if song else None,
            source=request.source,
            external_id=request.external_id or (str(song.id) if song else None),
            title=request.title or (song.title if song else None),
            artist_name=request.artist_name
            or (song.artist.name if song and song.artist else None),
            album_title=request.album_title
            or (song.album.title if song and song.album else None),
            artwork_url=request.artwork_url
            or (song.artwork_path or song.artwork_url if song else None),
            duration_seconds=request.duration_seconds
            or (song.duration_seconds if song else None)
            or (library_track.duration_seconds if library_track else None),
            source_url=request.source_url or (song.source_url if song else None),
            event_type=request.event_type,
            position_seconds=request.position_seconds,
            outcome=request.outcome if request.event_type == "played" else None,
        )
        self.history.add(history_entry)
        self.history.session.commit()
        return self.responses.history_to_response(history_entry)

    def list_history(
        self, *, limit: int = 50, offset: int = 0, event_type: str | None = None
    ) -> list[HistoryResponse]:
        entries = self.history.list_with_songs(
            limit=limit, offset=offset, event_type=event_type
        )
        return self.responses.history_entries_to_response(entries)

    def get_recent_history(self, *, limit: int = 50) -> list[HistoryResponse]:
        entries = self.history.get_recent_history(limit=limit)
        return self.responses.history_entries_to_response(entries)

    def get_most_played_history(self, *, limit: int = 50) -> list[HistoryResponse]:
        entries = self.history.get_most_played_history(limit=limit)
        return self.responses.history_entries_to_response(entries)
