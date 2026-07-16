from app.core.exceptions import ResourceNotFoundError
from sqlalchemy import func, select

from app.models import Favorite, LibraryAlbum, LibraryTrack, Playlist, PlaylistLibraryTrack, PlaylistSong
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
    AlbumResponse,
    ArtistDetailResponse,
    ArtistResponse,
    FavoriteToggleRequest,
    FavoritesResponse,
    HistoryCreateRequest,
    HistoryResponse,
    PlaylistAddOnlineTrackRequest,
    PlaylistAddSongsRequest,
    PlaylistCreateRequest,
    PlaylistDetailResponse,
    PlaylistItemResponse,
    PlaylistReorderRequest,
    PlaylistResponse,
    PlaylistUpdateRequest,
    RecommendationRequest,
    RecommendationResponse,
    SongResponse,
)
from app.schemas.library import MixedPlaylistTrackResponse
from app.services.recommendations import RecommendationService
from app.services.file_paths import resolve_library_path


class CatalogService:
    def __init__(
        self,
        songs: SongRepository,
        artists: ArtistRepository,
        albums: AlbumRepository,
        playlists: PlaylistRepository,
        favorites: FavoriteRepository,
        history: HistoryRepository,
    ) -> None:
        self.songs = songs
        self.artists = artists
        self.albums = albums
        self.playlists = playlists
        self.favorites = favorites
        self.history = history

    def list_songs(self, *, limit: int = 50, offset: int = 0) -> list[SongResponse]:
        songs = self.songs.list_with_details(limit=limit, offset=offset)
        return [self._song_to_response(song) for song in songs]

    def get_song(self, song_id: int) -> SongResponse:
        song = self.songs.get(song_id)
        if not song:
            raise ResourceNotFoundError("Song not found", details={"song_id": song_id})
        return self._song_to_response(song)

    def search_songs(self, query: str, *, limit: int = 50) -> list[SongResponse]:
        songs = self.songs.search_local(query, limit=limit)
        return [self._song_to_response(song) for song in songs]

    def list_artists(self, *, limit: int = 50, offset: int = 0) -> list[ArtistResponse]:
        results = self.artists.list_with_counts(limit=limit, offset=offset)
        return [self._artist_to_response(artist, song_count, album_count) for artist, song_count, album_count in results]

    def get_artist(self, artist_id: int) -> ArtistDetailResponse:
        artist = self.artists.get_with_details(artist_id)
        if not artist:
            raise ResourceNotFoundError("Artist not found", details={"artist_id": artist_id})

        is_favorited = self.favorites.is_favorited("artist", artist_id)
        available_songs = [song for song in artist.songs if self._downloaded_song_file_exists(song)]
        albums = [self._album_to_response_simple(album) for album in artist.albums]
        top_songs = [self._song_to_response(song) for song in available_songs[:10]]

        return ArtistDetailResponse(
            id=artist.id,
            name=artist.name,
            sort_name=artist.sort_name,
            artwork_path=artist.artwork_path,
            artwork_url=artist.artwork_url,
            song_count=len(available_songs),
            album_count=len(artist.albums),
            is_favorited=is_favorited,
            created_at=artist.created_at,
            updated_at=artist.updated_at,
            albums=albums,
            top_songs=top_songs,
        )

    def list_albums(self, *, limit: int = 50, offset: int = 0) -> list[AlbumResponse]:
        results = self.albums.list_with_counts(limit=limit, offset=offset)
        return [self._album_to_response(album, song_count, duration) for album, song_count, duration in results]

    def get_album(self, album_id: int) -> AlbumDetailResponse:
        album = self.albums.get_with_details(album_id)
        if not album:
            raise ResourceNotFoundError("Album not found", details={"album_id": album_id})

        is_favorited = self.favorites.is_favorited("album", album_id)
        available_songs = [song for song in album.songs if self._downloaded_song_file_exists(song)]
        songs = [self._song_to_response(song) for song in available_songs]
        duration_seconds = sum(song.duration_seconds or 0 for song in available_songs)

        return AlbumDetailResponse(
            id=album.id,
            public_id=self._album_public_id(album.id),
            title=album.title,
            artist_id=album.artist_id,
            artist_name=album.artist.name if album.artist else None,
            year=album.year,
            artwork_path=album.artwork_path,
            artwork_url=album.artwork_url,
            song_count=len(songs),
            duration_seconds=duration_seconds,
            is_favorited=is_favorited,
            created_at=album.created_at,
            updated_at=album.updated_at,
            songs=songs,
        )

    def list_playlists(self, *, limit: int = 50, offset: int = 0) -> list[PlaylistResponse]:
        playlists = self.playlists.list(limit=limit, offset=offset)
        return [self._playlist_to_response(playlist) for playlist in playlists]

    def get_playlist(self, playlist_id: int) -> PlaylistDetailResponse:
        playlist = self.playlists.get_with_songs(playlist_id)
        if not playlist:
            raise ResourceNotFoundError("Playlist not found", details={"playlist_id": playlist_id})

        for link in playlist.songs:
            song = link.song
            if song and song.is_downloaded and song.relative_path and not resolve_library_path(song.relative_path).is_file():
                song.is_downloaded = False
                song.relative_path = None
        self.playlists.session.commit()
        songs = [self._song_to_response(ps.song) for ps in playlist.songs if ps.song]
        online_links = list(
            self.playlists.session.scalars(
                select(PlaylistLibraryTrack)
                .where(PlaylistLibraryTrack.playlist_id == playlist_id)
                .order_by(PlaylistLibraryTrack.position.asc())
            )
        )
        library_tracks = [
            MixedPlaylistTrackResponse(
                item_type="library_track",
                position=link.position,
                track=self._library_track_to_response(link.track),
            )
            for link in online_links
            if link.track
        ]
        items = [
            PlaylistItemResponse(item_type="song", position=link.position, song=self._song_to_response(link.song))
            for link in playlist.songs
            if link.song
        ]
        items.extend(
            PlaylistItemResponse(
                item_type="library_track",
                position=link.position,
                track=self._library_track_to_response(link.track),
            )
            for link in online_links
            if link.track
        )
        items.sort(key=lambda item: (item.position, 0 if item.item_type == "song" else 1))
        duration_seconds = sum(song.duration_seconds or 0 for song in songs if song.duration_seconds)
        duration_seconds += sum(link.track.duration_seconds or 0 for link in online_links if link.track and link.track.duration_seconds)

        return PlaylistDetailResponse(
            id=playlist.id,
            name=playlist.name,
            description=playlist.description,
            artwork_path=playlist.artwork_path,
            song_count=len(items),
            duration_seconds=duration_seconds,
            created_at=playlist.created_at,
            updated_at=playlist.updated_at,
            songs=songs,
            library_tracks=library_tracks,
            items=items,
        )

    def create_playlist(self, request: PlaylistCreateRequest) -> PlaylistResponse:
        playlist = Playlist(name=request.name, description=request.description)
        self.playlists.add(playlist)
        self.playlists.session.commit()
        return self._playlist_to_response(playlist)

    def update_playlist(self, playlist_id: int, request: PlaylistUpdateRequest) -> PlaylistResponse:
        playlist = self.playlists.get(playlist_id)
        if not playlist:
            raise ResourceNotFoundError("Playlist not found", details={"playlist_id": playlist_id})

        if request.name is not None:
            playlist.name = request.name
        if request.description is not None:
            playlist.description = request.description

        self.playlists.session.commit()
        return self._playlist_to_response(playlist)

    def delete_playlist(self, playlist_id: int) -> None:
        playlist = self.playlists.get(playlist_id)
        if not playlist:
            raise ResourceNotFoundError("Playlist not found", details={"playlist_id": playlist_id})
        self.playlists.delete(playlist)
        self.playlists.session.commit()

    def add_songs_to_playlist(self, playlist_id: int, request: PlaylistAddSongsRequest) -> PlaylistDetailResponse:
        for song_id in request.song_ids:
            self.playlists.add_song(playlist_id, song_id)
        self.playlists.session.commit()
        return self.get_playlist(playlist_id)

    def add_online_track_to_playlist(self, playlist_id: int, request: PlaylistAddOnlineTrackRequest) -> PlaylistDetailResponse:
        playlist = self.playlists.get(playlist_id)
        if not playlist:
            raise ResourceNotFoundError("Playlist not found", details={"playlist_id": playlist_id})

        track = self.playlists.session.scalars(
            select(LibraryTrack).where(
                LibraryTrack.source == "youtube",
                LibraryTrack.external_id == request.external_id,
            )
        ).first()
        if not track:
            track = LibraryTrack(
                source="youtube",
                external_id=request.external_id,
                title=request.title,
                artist_name=request.artist_name,
                artist_external_id=request.artist_external_id,
                album_title=request.album_title,
                duration_seconds=request.duration_seconds,
                position=0,
                source_url=request.source_url,
                artwork_url=request.artwork_url,
                explicit=request.explicit,
                is_in_library=False,
            )
            self.playlists.session.add(track)
            self.playlists.session.flush()
        elif track.duration_seconds is None and request.duration_seconds:
            track.duration_seconds = request.duration_seconds

        existing_link = self.playlists.session.scalars(
            select(PlaylistLibraryTrack).where(
                PlaylistLibraryTrack.playlist_id == playlist_id,
                PlaylistLibraryTrack.track_id == track.id,
            )
        ).first()
        if not existing_link:
            max_position = self.playlists.session.execute(
                select(
                    func.max(
                        func.coalesce(select(func.max(PlaylistLibraryTrack.position)).where(PlaylistLibraryTrack.playlist_id == playlist_id).scalar_subquery(), -1),
                        func.coalesce(select(func.max(PlaylistSong.position)).where(PlaylistSong.playlist_id == playlist_id).scalar_subquery(), -1),
                    )
                )
            ).scalar()
            self.playlists.session.add(
                PlaylistLibraryTrack(
                    playlist_id=playlist_id,
                    track_id=track.id,
                    position=max_position + 1,
                )
            )
        self.playlists.session.commit()
        return self.get_playlist(playlist_id)

    def remove_song_from_playlist(self, playlist_id: int, song_id: int, *, delete_file: bool = False) -> PlaylistDetailResponse:
        song = self.songs.get(song_id)
        if not song:
            raise ResourceNotFoundError("Song not found", details={"song_id": song_id})
        self.playlists.remove_song(playlist_id, song_id)
        if delete_file and song.is_downloaded and song.relative_path:
            file_path = song.relative_path
            resolve_library_path(file_path).unlink(missing_ok=True)
            song.relative_path = None
            song.is_downloaded = False
            linked_tracks = self.playlists.session.scalars(select(LibraryTrack).where(LibraryTrack.relative_path == file_path)).all()
            for track in linked_tracks:
                track.relative_path = None
                track.is_downloaded = False
        self.playlists.session.commit()
        return self.get_playlist(playlist_id)

    def _downloaded_song_file_exists(self, song) -> bool:
        return bool(song.is_downloaded and song.relative_path and resolve_library_path(song.relative_path).is_file())

    def reorder_playlist_song(self, playlist_id: int, request: PlaylistReorderRequest) -> PlaylistDetailResponse:
        self.playlists.reorder_song(playlist_id, request.song_id, request.new_position)
        self.playlists.session.commit()
        return self.get_playlist(playlist_id)

    def toggle_favorite(self, request: FavoriteToggleRequest) -> bool:
        targets = {
            "song": self.songs.get,
            "artist": self.artists.get,
            "album": self.albums.get,
            "playlist": self.playlists.get,
            "library_album": lambda entity_id: self.favorites.session.get(LibraryAlbum, entity_id),
            "library_track": lambda entity_id: self.favorites.session.get(LibraryTrack, entity_id),
        }
        target_getter = targets.get(request.entity_type)
        if not target_getter or not target_getter(request.entity_id):
            raise ResourceNotFoundError(
                "Favorite target not found",
                details={"entity_type": request.entity_type, "entity_id": request.entity_id},
            )
        is_favorited = self.favorites.toggle(request.entity_type, request.entity_id)
        self.favorites.session.commit()
        return is_favorited

    def list_favorite_songs(self, *, limit: int = 50, offset: int = 0) -> list[SongResponse]:
        songs = self.favorites.list_songs(limit=limit, offset=offset)
        return [self._song_to_response(song) for song in songs]

    def list_favorites(self) -> FavoritesResponse:
        from app.services.library_albums import LibraryAlbumService

        response = FavoritesResponse()
        library_service = LibraryAlbumService(self.favorites.session)
        for favorite in self.favorites.list_all():
            if favorite.song_id and (song := self.songs.get(favorite.song_id)):
                response.songs.append(self._song_to_response(song))
            elif favorite.artist_id and (artist := self.artists.get(favorite.artist_id)):
                downloaded = [song for song in artist.songs if song.is_downloaded]
                response.artists.append(self._artist_to_response(artist, len(downloaded), len(artist.albums)))
            elif favorite.album_id and (album := self.albums.get(favorite.album_id)):
                downloaded = [song for song in album.songs if song.is_downloaded]
                response.albums.append(self._album_to_response(album, len(downloaded), sum(song.duration_seconds or 0 for song in downloaded)))
            elif favorite.playlist_id and (playlist := self.playlists.get(favorite.playlist_id)):
                response.playlists.append(self._playlist_to_response(playlist))
            elif favorite.library_album_id and (album := self.favorites.session.get(LibraryAlbum, favorite.library_album_id)):
                response.library_albums.append(library_service._album_to_response(album))
            elif favorite.library_track_id and (track := self.favorites.session.get(LibraryTrack, favorite.library_track_id)):
                response.library_tracks.append(library_service._track_to_response(track))
        return response

    def add_history(self, request: HistoryCreateRequest) -> HistoryResponse:
        from app.models.history import History

        song = self.songs.get(request.song_id) if request.song_id else None
        library_track = None
        if request.source == "local" and not song:
            raise ResourceNotFoundError("Song not found", details={"song_id": request.song_id})
        if request.source == "youtube" and not request.external_id:
            raise ResourceNotFoundError("History item missing video id")
        if request.source == "youtube" and request.external_id:
            library_track = self.history.session.scalars(
                select(LibraryTrack).where(
                    LibraryTrack.source == "youtube",
                    LibraryTrack.external_id == request.external_id,
                )
            ).first()
            if library_track and library_track.duration_seconds is None and request.duration_seconds:
                library_track.duration_seconds = request.duration_seconds

        history_entry = History(
            song_id=song.id if song else None,
            source=request.source,
            external_id=request.external_id or (str(song.id) if song else None),
            title=request.title or (song.title if song else None),
            artist_name=request.artist_name or (song.artist.name if song and song.artist else None),
            album_title=request.album_title or (song.album.title if song and song.album else None),
            artwork_url=request.artwork_url or (song.artwork_path if song else None),
            duration_seconds=request.duration_seconds
            or (song.duration_seconds if song else None)
            or (library_track.duration_seconds if library_track else None),
            source_url=request.source_url or (song.source_url if song else None),
            event_type=request.event_type,
            position_seconds=request.position_seconds,
        )
        self.history.add(history_entry)
        self.history.session.commit()
        return self._history_to_response(history_entry)

    def list_history(self, *, limit: int = 50, offset: int = 0) -> list[HistoryResponse]:
        entries = self.history.list_with_songs(limit=limit, offset=offset)
        return [self._history_to_response(entry) for entry in entries]

    def get_recent_history(self, *, limit: int = 50) -> list[HistoryResponse]:
        entries = self.history.get_recent_history(limit=limit)
        return [self._history_to_response(entry) for entry in entries]

    def get_most_played_history(self, *, limit: int = 50) -> list[HistoryResponse]:
        entries = self.history.get_most_played_history(limit=limit)
        return [self._history_to_response(entry) for entry in entries]

    def get_recently_played(self, *, limit: int = 50) -> list[SongResponse]:
        songs = self.history.get_recently_played_songs(limit=limit)
        return [self._song_to_response(song) for song in songs]

    def get_most_played(self, *, limit: int = 50) -> list[SongResponse]:
        songs = self.history.get_most_played_songs(limit=limit)
        return [self._song_to_response(song) for song in songs]

    def get_recently_added(self, *, limit: int = 50) -> list[SongResponse]:
        songs = self.songs.get_recently_added(limit=limit)
        return [self._song_to_response(song) for song in songs]

    def get_random_songs(self, *, limit: int = 10) -> list[SongResponse]:
        songs = self.songs.get_random(limit=limit)
        return [self._song_to_response(song) for song in songs]

    def list_favorite_artists(self, *, limit: int = 50, offset: int = 0) -> list[ArtistResponse]:
        results = self.favorites.list_artists_with_counts(limit=limit, offset=offset)
        return [self._artist_to_response(artist, song_count, album_count) for artist, song_count, album_count in results]

    def get_random_artists(self, *, limit: int = 5) -> list[ArtistResponse]:
        results = self.artists.get_random_with_counts(limit=limit)
        return [self._artist_to_response(artist, song_count, album_count) for artist, song_count, album_count in results]

    def list_favorite_albums(self, *, limit: int = 50, offset: int = 0) -> list[AlbumResponse]:
        results = self.favorites.list_albums_with_counts(limit=limit, offset=offset)
        return [self._album_to_response(album, song_count, duration) for album, song_count, duration in results]

    def get_recently_added_albums(self, *, limit: int = 10) -> list[AlbumResponse]:
        results = self.albums.get_recently_added_with_counts(limit=limit)
        return [self._album_to_response(album, song_count, duration) for album, song_count, duration in results]

    def get_random_albums(self, *, limit: int = 5) -> list[AlbumResponse]:
        results = self.albums.get_random_with_counts(limit=limit)
        return [self._album_to_response(album, song_count, duration) for album, song_count, duration in results]

    def get_recommendations(self, request: RecommendationRequest, recommendation_service: RecommendationService) -> RecommendationResponse:
        """
        Get personalized recommendations for songs or albums.
        
        Args:
            request: The recommendation request with strategy, limit, and entity_type
            recommendation_service: The recommendation service instance
            
        Returns:
            RecommendationResponse with songs or albums based on entity_type
        """
        if request.entity_type == "album":
            albums = recommendation_service.get_album_recommendations(limit=request.limit)
            album_responses = []
            for album in albums:
                is_favorited = self.favorites.is_favorited("album", album.id)
                song_count = len([s for s in album.songs if s.is_downloaded])
                duration_seconds = sum(s.duration_seconds or 0 for s in album.songs if s.is_downloaded)
                album_responses.append(
                    AlbumResponse(
                        id=album.id,
                        title=album.title,
                        artist_id=album.artist_id,
                        artist_name=album.artist.name if album.artist else None,
                        year=album.year,
                        artwork_path=album.artwork_path,
                        artwork_url=album.artwork_url,
                        song_count=song_count,
                        duration_seconds=duration_seconds,
                        is_favorited=is_favorited,
                        created_at=album.created_at,
                        updated_at=album.updated_at,
                    )
                )
            
            return RecommendationResponse(
                strategy=request.strategy,
                entity_type="album",
                albums=album_responses,
            )
        else:
            # Song recommendations
            if request.strategy == "time_based":
                songs = recommendation_service.get_time_based_recommendations(limit=request.limit)
            else:
                songs = recommendation_service.get_song_recommendations(
                    limit=request.limit,
                    strategy=request.strategy,
                )
            
            song_responses = [self._song_to_response(song) for song in songs]
            
            return RecommendationResponse(
                strategy=request.strategy,
                entity_type="song",
                songs=song_responses,
            )

    def _song_to_response(self, song) -> SongResponse:
        is_favorited = self.favorites.is_favorited("song", song.id)
        canonical_album = self.favorites.session.scalars(
            select(LibraryAlbum).where(LibraryAlbum.local_album_id == song.album_id)
        ).first() if song.album_id else None
        return SongResponse(
            id=song.id,
            title=song.title,
            artist_id=song.artist_id,
            artist_name=song.artist.name if song.artist else None,
            album_id=song.album_id,
            album_public_id=canonical_album.public_id if canonical_album else None,
            album_title=song.album.title if song.album else None,
            duration_seconds=song.duration_seconds,
            track_number=song.track_number,
            disc_number=song.disc_number,
            artwork_path=song.artwork_path or (song.album.artwork_path if song.album else None),
            artwork_url=song.artwork_url or (song.album.artwork_url if song.album else None),
            source_url=song.source_url,
            is_downloaded=song.is_downloaded,
            is_favorited=is_favorited,
            created_at=song.created_at,
            updated_at=song.updated_at,
        )

    def _artist_to_response(self, artist, song_count: int, album_count: int) -> ArtistResponse:
        is_favorited = self.favorites.is_favorited("artist", artist.id)
        return ArtistResponse(
            id=artist.id,
            name=artist.name,
            sort_name=artist.sort_name,
            artwork_path=artist.artwork_path,
            artwork_url=artist.artwork_url,
            song_count=song_count,
            album_count=album_count,
            is_favorited=is_favorited,
            created_at=artist.created_at,
            updated_at=artist.updated_at,
        )

    def _album_to_response(self, album, song_count: int, duration_seconds: int | None) -> AlbumResponse:
        is_favorited = self.favorites.is_favorited("album", album.id)
        return AlbumResponse(
            id=album.id,
            public_id=self._album_public_id(album.id),
            title=album.title,
            artist_id=album.artist_id,
            artist_name=album.artist.name if album.artist else None,
            year=album.year,
            artwork_path=album.artwork_path,
            artwork_url=album.artwork_url,
            song_count=song_count,
            duration_seconds=duration_seconds,
            is_favorited=is_favorited,
            created_at=album.created_at,
            updated_at=album.updated_at,
        )

    def _album_to_response_simple(self, album) -> AlbumResponse:
        is_favorited = self.favorites.is_favorited("album", album.id)
        song_count = len([s for s in album.songs if s.is_downloaded])
        duration_seconds = sum(s.duration_seconds or 0 for s in album.songs if s.is_downloaded)
        return AlbumResponse(
            id=album.id,
            public_id=self._album_public_id(album.id),
            title=album.title,
            artist_id=album.artist_id,
            artist_name=album.artist.name if album.artist else None,
            year=album.year,
            artwork_path=album.artwork_path,
            artwork_url=album.artwork_url,
            song_count=song_count,
            duration_seconds=duration_seconds,
            is_favorited=is_favorited,
            created_at=album.created_at,
            updated_at=album.updated_at,
        )

    def _album_public_id(self, local_album_id: int) -> str | None:
        return self.favorites.session.scalars(
            select(LibraryAlbum.public_id).where(LibraryAlbum.local_album_id == local_album_id)
        ).first()

    def _playlist_to_response(self, playlist: Playlist) -> PlaylistResponse:
        song_count = len(playlist.songs) if hasattr(playlist, "songs") else 0
        duration_seconds = sum(ps.song.duration_seconds or 0 for ps in playlist.songs if ps.song and ps.song.duration_seconds) if hasattr(playlist, "songs") else 0
        online_links = list(
            self.playlists.session.scalars(
                select(PlaylistLibraryTrack).where(PlaylistLibraryTrack.playlist_id == playlist.id)
            )
        )
        song_count += len(online_links)
        duration_seconds += sum(link.track.duration_seconds or 0 for link in online_links if link.track and link.track.duration_seconds)
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

    def _library_track_to_response(self, track):
        from app.schemas.library import LibraryTrackResponse

        return LibraryTrackResponse(
            id=track.id,
            source=track.source,
            external_id=track.external_id,
            title=track.title,
            artist_name=track.artist_name,
            artist_external_id=track.artist_external_id,
            album_id=track.album_id,
            album_public_id=track.album.public_id if track.album else None,
            album_title=track.album_title,
            duration_seconds=track.duration_seconds or (track.song.duration_seconds if track.song else None),
            track_number=track.track_number,
            disc_number=track.disc_number,
            position=track.position,
            source_url=track.source_url,
            artwork_url=track.artwork_url,
            artwork_path=track.artwork_path,
            explicit=track.explicit,
            is_downloaded=track.is_downloaded,
            created_at=track.created_at,
            updated_at=track.updated_at,
        )

    def _history_to_response(self, entry) -> HistoryResponse:
        song_response = self._song_to_response(entry.song) if entry.song else None
        return HistoryResponse(
            id=entry.id,
            song_id=entry.song_id,
            song=song_response,
            source=entry.source,
            external_id=entry.external_id,
            title=entry.title or (song_response.title if song_response else None),
            artist_name=entry.artist_name or (song_response.artist_name if song_response else None),
            album_title=entry.album_title or (song_response.album_title if song_response else None),
            artwork_url=entry.artwork_url or (song_response.artwork_path if song_response else None),
            duration_seconds=entry.duration_seconds or (song_response.duration_seconds if song_response else None),
            source_url=entry.source_url or (song_response.source_url if song_response else None),
            event_type=entry.event_type,
            played_at=entry.played_at,
            position_seconds=entry.position_seconds,
        )
