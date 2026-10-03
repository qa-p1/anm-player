import re
import unicodedata
from urllib.parse import quote, urlsplit

from app.core.exceptions import ConflictError, ResourceNotFoundError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import joinedload, selectinload

from app.models import (
    Album,
    Artist,
    Favorite,
    LibraryAlbum,
    LibraryTrack,
    Playlist,
    PlaylistLibraryTrack,
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
    AlbumResponse,
    ArtistDetailResponse,
    ArtistResponse,
    FavoriteToggleRequest,
    FavoritesResponse,
    HistoryCreateRequest,
    HistoryResponse,
    PlaylistAddOnlineTrackRequest,
    PlaylistAddSongsRequest,
    PlaylistBulkRemoveRequest,
    PlaylistCreateRequest,
    PlaylistDetailResponse,
    PlaylistDuplicateRequest,
    PlaylistItemResponse,
    PlaylistReorderRequest,
    PlaylistResponse,
    PlaylistUpdateRequest,
    SongResponse,
)
from app.schemas.library import MixedPlaylistTrackResponse
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
        return self._songs_to_response(songs)

    def list_artists(self, *, limit: int = 50, offset: int = 0) -> list[ArtistResponse]:
        results = self.artists.list_with_counts(limit=limit, offset=offset)
        favorite_ids = self._favorite_ids(Favorite.artist_id, [artist.id for artist, _, _ in results])
        return [
            self._artist_to_response(artist, song_count, album_count, favorite_ids=favorite_ids)
            for artist, song_count, album_count in results
        ]

    def get_artist(self, artist_id: int) -> ArtistDetailResponse:
        artist = self.artists.get_with_details(artist_id)
        if not artist:
            raise ResourceNotFoundError("Artist not found", details={"artist_id": artist_id})

        is_favorited = self.favorites.is_favorited("artist", artist_id)
        available_songs = [song for song in artist.songs if self._downloaded_song_file_exists(song)]
        available_albums = [
            album
            for album in artist.albums
            if any(self._downloaded_song_file_exists(song) for song in album.songs)
        ]
        albums = self._simple_albums_to_response(available_albums)
        top_songs = self._songs_to_response(available_songs[:10])
        artwork_path, artwork_url = self._artist_artwork(artist)

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
            raise ResourceNotFoundError("Album not found", details={"album_id": album_id})

        is_favorited = self.favorites.is_favorited("album", album_id)
        available_songs = [song for song in album.songs if self._downloaded_song_file_exists(song)]
        songs = self._songs_to_response(available_songs)
        duration_seconds = sum(song.duration_seconds or 0 for song in available_songs)
        artwork_path, artwork_url = self._album_artwork(album)

        return AlbumDetailResponse(
            id=album.id,
            public_id=self._album_public_id(album.id),
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

    def list_playlists(self, *, limit: int = 50, offset: int = 0) -> list[PlaylistResponse]:
        playlists = list(
            self.playlists.session.scalars(
                select(Playlist)
                .options(
                    selectinload(Playlist.songs).joinedload(PlaylistSong.song).joinedload(Song.artist),
                    selectinload(Playlist.songs).joinedload(PlaylistSong.song).joinedload(Song.album),
                )
                .order_by(Playlist.created_at.desc(), Playlist.id.desc())
                .offset(offset)
                .limit(limit)
            )
        )
        online_by_playlist = self._online_playlist_links([playlist.id for playlist in playlists])
        return [
            self._playlist_to_response(playlist, online_links=online_by_playlist.get(playlist.id, []))
            for playlist in playlists
        ]

    def get_playlist(self, playlist_id: int) -> PlaylistDetailResponse:
        playlist = self.playlists.get_with_songs(playlist_id)
        if not playlist:
            raise ResourceNotFoundError("Playlist not found", details={"playlist_id": playlist_id})

        song_links = [link for link in playlist.songs if link.song]
        songs = self._songs_to_response([link.song for link in song_links])
        songs_by_id = {song.id: song for song in songs}
        online_links = self._online_playlist_links([playlist_id]).get(playlist_id, [])
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
            PlaylistItemResponse(item_type="song", position=link.position, song=songs_by_id[link.song.id])
            for link in song_links
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
        try:
            self.playlists.add(playlist)
            self.playlists.session.commit()
        except IntegrityError as exc:
            self.playlists.session.rollback()
            raise ConflictError("A playlist with that name already exists.") from exc
        return self._playlist_to_response(playlist)

    def update_playlist(self, playlist_id: int, request: PlaylistUpdateRequest) -> PlaylistDetailResponse:
        playlist = self.playlists.get(playlist_id)
        if not playlist:
            raise ResourceNotFoundError("Playlist not found", details={"playlist_id": playlist_id})

        changes = request.model_dump(exclude_unset=True)
        if "name" in changes:
            playlist.name = changes["name"]
        if "description" in changes:
            playlist.description = changes["description"]
        try:
            self.playlists.session.commit()
        except IntegrityError as exc:
            self.playlists.session.rollback()
            raise ConflictError("A playlist with that name already exists.") from exc
        return self.get_playlist(playlist_id)

    def duplicate_playlist(
        self,
        playlist_id: int,
        request: PlaylistDuplicateRequest | None = None,
    ) -> PlaylistDetailResponse:
        source = self.playlists.get(playlist_id)
        if not source:
            raise ResourceNotFoundError("Playlist not found", details={"playlist_id": playlist_id})

        requested_name = request.name if request else None
        name = requested_name or self._next_playlist_copy_name(source.name)
        duplicate = Playlist(
            name=name,
            description=source.description,
            artwork_path=source.artwork_path,
        )
        ordered_links = self._ordered_playlist_links(playlist_id)
        try:
            self.playlists.add(duplicate)
            for position, (item_type, link) in enumerate(ordered_links):
                if item_type == "song":
                    self.playlists.session.add(
                        PlaylistSong(
                            playlist_id=duplicate.id,
                            song_id=link.song_id,
                            position=position,
                        )
                    )
                else:
                    self.playlists.session.add(
                        PlaylistLibraryTrack(
                            playlist_id=duplicate.id,
                            track_id=link.track_id,
                            position=position,
                        )
                    )
            self.playlists.session.commit()
        except IntegrityError as exc:
            self.playlists.session.rollback()
            raise ConflictError("A playlist with that name already exists.") from exc
        return self.get_playlist(duplicate.id)

    def clear_playlist(self, playlist_id: int) -> PlaylistDetailResponse:
        if not self.playlists.get(playlist_id):
            raise ResourceNotFoundError("Playlist not found", details={"playlist_id": playlist_id})
        for _, link in self._ordered_playlist_links(playlist_id):
            self.playlists.session.delete(link)
        self.playlists.session.commit()
        return self.get_playlist(playlist_id)

    def reorder_playlist(
        self,
        playlist_id: int,
        request: PlaylistReorderRequest,
    ) -> PlaylistDetailResponse:
        if not self.playlists.get(playlist_id):
            raise ResourceNotFoundError("Playlist not found", details={"playlist_id": playlist_id})

        current = self._playlist_link_map(playlist_id)
        requested_keys = [(item.item_type, item.item_id) for item in request.items]
        requested_set = set(requested_keys)
        current_set = set(current)
        if len(requested_keys) != len(requested_set) or requested_set != current_set:
            raise ConflictError(
                "Playlist items changed. Refresh the playlist and submit its complete item order.",
                details={
                    "missing_items": self._playlist_keys_payload(current_set - requested_set),
                    "unexpected_items": self._playlist_keys_payload(requested_set - current_set),
                },
            )

        try:
            self._assign_playlist_positions([current[key] for key in requested_keys])
            self.playlists.session.commit()
        except IntegrityError as exc:
            self.playlists.session.rollback()
            raise ConflictError("The playlist changed while it was being reordered. Refresh it and try again.") from exc
        return self.get_playlist(playlist_id)

    def bulk_remove_playlist_items(
        self,
        playlist_id: int,
        request: PlaylistBulkRemoveRequest,
    ) -> PlaylistDetailResponse:
        if not self.playlists.get(playlist_id):
            raise ResourceNotFoundError("Playlist not found", details={"playlist_id": playlist_id})

        current = self._playlist_link_map(playlist_id)
        requested_keys = [(item.item_type, item.item_id) for item in request.items]
        missing = set(requested_keys) - set(current)
        if missing:
            raise ResourceNotFoundError(
                "One or more items are not in this playlist.",
                details={"items": self._playlist_keys_payload(missing)},
            )

        removed = set(requested_keys)
        for key in requested_keys:
            self.playlists.session.delete(current[key])
        remaining = [
            link
            for item_type, link in self._ordered_playlist_links(playlist_id)
            if (item_type, self._playlist_link_id(item_type, link)) not in removed
        ]
        try:
            self._assign_playlist_positions(remaining)
            self.playlists.session.commit()
        except IntegrityError as exc:
            self.playlists.session.rollback()
            raise ConflictError(
                "The playlist changed while items were being removed. Refresh it and try again."
            ) from exc
        return self.get_playlist(playlist_id)

    def export_playlist_m3u8(self, playlist_id: int) -> tuple[str, str]:
        playlist = self.playlists.get(playlist_id)
        if not playlist:
            raise ResourceNotFoundError("Playlist not found", details={"playlist_id": playlist_id})

        lines = ["#EXTM3U", f"#PLAYLIST:{self._m3u_text(playlist.name)}"]
        for item_type, link in self._ordered_playlist_links(playlist_id):
            if item_type == "song":
                song = link.song
                if not song:
                    continue
                duration = song.duration_seconds if song.duration_seconds is not None else -1
                label = self._m3u_label(song.artist.name if song.artist else None, song.title)
                location = f"/api/v1/media/songs/{song.id}/stream"
            else:
                track = link.track
                if not track:
                    continue
                duration = track.duration_seconds if track.duration_seconds is not None else -1
                label = self._m3u_label(track.artist_name, track.title)
                if track.is_downloaded and track.relative_path:
                    location = f"/api/v1/media/library-tracks/{track.id}/stream"
                elif track.source == "youtube" and track.external_id:
                    location = f"/api/v1/ytmusic/stream/{quote(track.external_id, safe='')}"
                else:
                    location = self._safe_remote_playlist_location(track.source_url)
                    if location is None:
                        continue
            lines.extend((f"#EXTINF:{duration},{label}", location))

        filename = self._safe_playlist_export_filename(playlist.id, playlist.name)
        return filename, "\n".join(lines) + "\n"

    def delete_playlist(self, playlist_id: int) -> None:
        playlist = self.playlists.get(playlist_id)
        if not playlist:
            raise ResourceNotFoundError("Playlist not found", details={"playlist_id": playlist_id})
        self.playlists.delete(playlist)
        self.playlists.session.commit()

    def _ordered_playlist_links(
        self,
        playlist_id: int,
    ) -> list[tuple[str, PlaylistSong | PlaylistLibraryTrack]]:
        song_links = self.playlists.session.scalars(
            select(PlaylistSong)
            .options(
                joinedload(PlaylistSong.song).joinedload(Song.artist),
                joinedload(PlaylistSong.song).joinedload(Song.album),
            )
            .where(PlaylistSong.playlist_id == playlist_id)
        ).unique().all()
        library_links = self.playlists.session.scalars(
            select(PlaylistLibraryTrack)
            .options(
                joinedload(PlaylistLibraryTrack.track).joinedload(LibraryTrack.album),
                joinedload(PlaylistLibraryTrack.track).joinedload(LibraryTrack.song),
            )
            .where(PlaylistLibraryTrack.playlist_id == playlist_id)
        ).unique().all()
        links: list[tuple[str, PlaylistSong | PlaylistLibraryTrack]] = [
            *(("song", link) for link in song_links),
            *(("library_track", link) for link in library_links),
        ]
        return sorted(links, key=lambda item: (item[1].position, 0 if item[0] == "song" else 1, item[1].id))

    def _playlist_link_map(
        self,
        playlist_id: int,
    ) -> dict[tuple[str, int], PlaylistSong | PlaylistLibraryTrack]:
        return {
            (item_type, self._playlist_link_id(item_type, link)): link
            for item_type, link in self._ordered_playlist_links(playlist_id)
        }

    @staticmethod
    def _playlist_link_id(item_type: str, link: PlaylistSong | PlaylistLibraryTrack) -> int:
        return link.song_id if item_type == "song" else link.track_id

    def _assign_playlist_positions(self, links: list[PlaylistSong | PlaylistLibraryTrack]) -> None:
        if not links:
            self.playlists.session.flush()
            return
        highest_position = max(link.position for link in links)
        temporary_start = max(highest_position, len(links)) + len(links) + 1
        for offset, link in enumerate(links):
            link.position = temporary_start + offset
        self.playlists.session.flush()
        for position, link in enumerate(links):
            link.position = position
        self.playlists.session.flush()

    def _next_playlist_copy_name(self, source_name: str) -> str:
        suffix = " copy"
        candidate = f"{source_name[:255 - len(suffix)]}{suffix}"
        suffix_number = 2
        while self.playlists.session.scalars(select(Playlist.id).where(Playlist.name == candidate)).first():
            suffix = f" copy {suffix_number}"
            candidate = f"{source_name[:255 - len(suffix)]}{suffix}"
            suffix_number += 1
        return candidate

    @staticmethod
    def _playlist_keys_payload(keys: set[tuple[str, int]]) -> list[dict[str, str | int]]:
        return [
            {"item_type": item_type, "item_id": item_id}
            for item_type, item_id in sorted(keys)
        ]

    @classmethod
    def _m3u_label(cls, artist: str | None, title: str) -> str:
        title_text = cls._m3u_text(title) or "Unknown title"
        artist_text = cls._m3u_text(artist)
        return f"{artist_text} - {title_text}" if artist_text else title_text

    @staticmethod
    def _m3u_text(value: str | None) -> str:
        if not value:
            return ""
        cleaned = "".join(
            " " if unicodedata.category(character).startswith("C") else character
            for character in str(value)
        )
        return " ".join(cleaned.split())

    @staticmethod
    def _safe_remote_playlist_location(value: str | None) -> str | None:
        if not value or any(ord(character) < 32 or ord(character) == 127 for character in value):
            return None
        try:
            parsed = urlsplit(value)
            if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
                return None
        except ValueError:
            return None
        return value

    @staticmethod
    def _safe_playlist_export_filename(playlist_id: int, name: str) -> str:
        normalized = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
        slug = re.sub(r"[^A-Za-z0-9._-]+", "-", normalized).strip("._-")[:120]
        stem = f"playlist-{playlist_id}"
        if slug:
            stem = f"{stem}-{slug}"
        return f"{stem}.m3u8"

    def add_songs_to_playlist(self, playlist_id: int, request: PlaylistAddSongsRequest) -> PlaylistDetailResponse:
        if not self.playlists.get(playlist_id):
            raise ResourceNotFoundError("Playlist not found", details={"playlist_id": playlist_id})
        song_ids = list(dict.fromkeys(request.song_ids))
        found_ids = set(self.playlists.session.scalars(select(self.songs.model.id).where(self.songs.model.id.in_(song_ids))))
        missing_ids = [song_id for song_id in song_ids if song_id not in found_ids]
        if missing_ids:
            raise ResourceNotFoundError("One or more songs were not found", details={"song_ids": missing_ids})
        existing_ids = set(self.playlists.session.scalars(
            select(PlaylistSong.song_id).where(
                PlaylistSong.playlist_id == playlist_id,
                PlaylistSong.song_id.in_(song_ids),
            )
        ))
        if existing_ids:
            raise ConflictError("One or more songs are already in the playlist.", details={"song_ids": sorted(existing_ids)})
        # Sessions do not autoflush, so positions are assigned up front instead
        # of re-querying the maximum for every song in the request.
        next_position = self.playlists.next_position(playlist_id)
        for offset, song_id in enumerate(song_ids):
            self.playlists.add_song(playlist_id, song_id, position=next_position + offset)
        try:
            self.playlists.session.commit()
        except IntegrityError as exc:
            self.playlists.session.rollback()
            raise ConflictError("The playlist changed while songs were being added. Refresh it and try again.") from exc
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
            self.playlists.session.add(
                PlaylistLibraryTrack(
                    playlist_id=playlist_id,
                    track_id=track.id,
                    position=self.playlists.next_position(playlist_id),
                )
            )
        try:
            self.playlists.session.commit()
        except IntegrityError as exc:
            self.playlists.session.rollback()
            raise ConflictError("The playlist changed while the track was being added. Refresh it and try again.") from exc
        return self.get_playlist(playlist_id)

    def remove_song_from_playlist(self, playlist_id: int, song_id: int) -> PlaylistDetailResponse:
        if not self.playlists.get(playlist_id):
            raise ResourceNotFoundError("Playlist not found", details={"playlist_id": playlist_id})
        song = self.songs.get(song_id)
        if not song:
            raise ResourceNotFoundError("Song not found", details={"song_id": song_id})
        if not self.playlists.remove_song(playlist_id, song_id):
            raise ResourceNotFoundError(
                "Song is not in this playlist.",
                details={"playlist_id": playlist_id, "song_id": song_id},
            )
        self.playlists.session.commit()
        return self.get_playlist(playlist_id)

    def remove_library_track_from_playlist(
        self,
        playlist_id: int,
        track_id: int,
    ) -> PlaylistDetailResponse:
        if not self.playlists.get(playlist_id):
            raise ResourceNotFoundError(
                "Playlist not found",
                details={"playlist_id": playlist_id},
            )
        if not self.playlists.session.get(LibraryTrack, track_id):
            raise ResourceNotFoundError(
                "Library track not found",
                details={"track_id": track_id},
            )
        link = self.playlists.session.scalars(
            select(PlaylistLibraryTrack).where(
                PlaylistLibraryTrack.playlist_id == playlist_id,
                PlaylistLibraryTrack.track_id == track_id,
            )
        ).first()
        if link is None:
            raise ResourceNotFoundError(
                "Track is not in this playlist.",
                details={"playlist_id": playlist_id, "track_id": track_id},
            )
        self.playlists.session.delete(link)
        self.playlists.session.commit()
        return self.get_playlist(playlist_id)

    def _downloaded_song_file_exists(self, song) -> bool:
        if not song.is_downloaded or not song.relative_path:
            return False
        try:
            return resolve_library_path(song.relative_path).is_file()
        except (OSError, ValueError):
            return False

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

    def list_favorites(self) -> FavoritesResponse:
        from app.services.library_albums import LibraryAlbumService

        response = FavoritesResponse()
        library_service = LibraryAlbumService(self.favorites.session)
        favorites = self.favorites.list_all()
        song_ids = {favorite.song_id for favorite in favorites if favorite.song_id}
        artist_ids = {favorite.artist_id for favorite in favorites if favorite.artist_id}
        album_ids = {favorite.album_id for favorite in favorites if favorite.album_id}
        playlist_ids = {favorite.playlist_id for favorite in favorites if favorite.playlist_id}
        library_album_ids = {favorite.library_album_id for favorite in favorites if favorite.library_album_id}
        library_track_ids = {favorite.library_track_id for favorite in favorites if favorite.library_track_id}

        songs = list(
            self.favorites.session.scalars(
                select(Song)
                .options(joinedload(Song.artist), joinedload(Song.album))
                .where(Song.id.in_(song_ids))
            )
        ) if song_ids else []
        artists = list(
            self.favorites.session.scalars(
                select(Artist)
                .options(
                    selectinload(Artist.songs),
                    selectinload(Artist.albums).selectinload(Album.songs),
                )
                .where(Artist.id.in_(artist_ids))
            )
        ) if artist_ids else []
        albums = list(
            self.favorites.session.scalars(
                select(Album)
                .options(joinedload(Album.artist), selectinload(Album.songs))
                .where(Album.id.in_(album_ids))
            )
        ) if album_ids else []
        playlists = list(
            self.favorites.session.scalars(
                select(Playlist)
                .options(selectinload(Playlist.songs).joinedload(PlaylistSong.song))
                .where(Playlist.id.in_(playlist_ids))
            )
        ) if playlist_ids else []
        library_albums = list(
            self.favorites.session.scalars(
                select(LibraryAlbum)
                .options(selectinload(LibraryAlbum.tracks).joinedload(LibraryTrack.song))
                .where(LibraryAlbum.id.in_(library_album_ids))
            )
        ) if library_album_ids else []
        library_tracks = list(
            self.favorites.session.scalars(
                select(LibraryTrack)
                .options(joinedload(LibraryTrack.album), joinedload(LibraryTrack.song))
                .where(LibraryTrack.id.in_(library_track_ids))
            )
        ) if library_track_ids else []

        song_responses = {
            song.id: song
            for song in self._songs_to_response(songs, favorite_ids=song_ids)
        }
        artists_by_id = {artist.id: artist for artist in artists}
        albums_by_id = {album.id: album for album in albums}
        playlists_by_id = {playlist.id: playlist for playlist in playlists}
        library_albums_by_id = {album.id: album for album in library_albums}
        library_tracks_by_id = {track.id: track for track in library_tracks}
        public_ids = self._album_public_ids([album.id for album in albums])
        online_by_playlist = self._online_playlist_links([playlist.id for playlist in playlists])
        for favorite in favorites:
            if favorite.song_id and (song := song_responses.get(favorite.song_id)):
                response.songs.append(song)
            elif favorite.artist_id and (artist := artists_by_id.get(favorite.artist_id)):
                response.artists.append(
                    self._artist_to_response(
                        artist,
                        len([song for song in artist.songs if song.is_downloaded]),
                        len(artist.albums),
                        favorite_ids=artist_ids,
                    )
                )
            elif favorite.album_id and (album := albums_by_id.get(favorite.album_id)):
                response.albums.append(
                    self._album_to_response_simple(
                        album,
                        favorite_ids=album_ids,
                        public_ids=public_ids,
                    )
                )
            elif favorite.playlist_id and (playlist := playlists_by_id.get(favorite.playlist_id)):
                response.playlists.append(
                    self._playlist_to_response(
                        playlist,
                        online_links=online_by_playlist.get(playlist.id, []),
                    )
                )
            elif favorite.library_album_id and (
                album := library_albums_by_id.get(favorite.library_album_id)
            ):
                response.library_albums.append(
                    library_service._album_to_response(album, is_favorited=True)
                )
            elif favorite.library_track_id and (
                track := library_tracks_by_id.get(favorite.library_track_id)
            ):
                response.library_tracks.append(
                    library_service._track_to_response(track, is_favorited=True)
                )
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
            artwork_url=request.artwork_url or (song.artwork_path or song.artwork_url if song else None),
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
        return self._history_entries_to_response(entries)

    def get_recent_history(self, *, limit: int = 50) -> list[HistoryResponse]:
        entries = self.history.get_recent_history(limit=limit)
        return self._history_entries_to_response(entries)

    def get_most_played_history(self, *, limit: int = 50) -> list[HistoryResponse]:
        entries = self.history.get_most_played_history(limit=limit)
        return self._history_entries_to_response(entries)

    def _favorite_ids(self, field, entity_ids: list[int]) -> set[int]:
        ids = set(entity_ids)
        if not ids:
            return set()
        return {
            entity_id
            for entity_id in self.favorites.session.scalars(select(field).where(field.in_(ids)))
            if entity_id is not None
        }

    def _album_public_ids(self, album_ids: list[int]) -> dict[int, str]:
        ids = set(album_ids)
        if not ids:
            return {}
        rows = self.favorites.session.execute(
            select(LibraryAlbum.local_album_id, LibraryAlbum.public_id).where(
                LibraryAlbum.local_album_id.in_(ids)
            )
        ).tuples()
        return {local_id: public_id for local_id, public_id in rows}

    def songs_to_response(self, songs) -> list[SongResponse]:
        """Build song responses with batched favorite and album-ID lookups."""
        return self._songs_to_response(songs)

    def song_to_response(self, song) -> SongResponse:
        return self._songs_to_response([song])[0]

    def _songs_to_response(
        self,
        songs,
        *,
        favorite_ids: set[int] | None = None,
    ) -> list[SongResponse]:
        song_list = list(songs)
        if favorite_ids is None:
            favorite_ids = self._favorite_ids(Favorite.song_id, [song.id for song in song_list])
        public_ids = self._album_public_ids([song.album_id for song in song_list if song.album_id])
        return [
            self._song_to_response(song, favorite_ids=favorite_ids, public_ids=public_ids)
            for song in song_list
        ]

    def _simple_albums_to_response(self, albums) -> list[AlbumResponse]:
        album_list = list(albums)
        favorite_ids = self._favorite_ids(Favorite.album_id, [album.id for album in album_list])
        public_ids = self._album_public_ids([album.id for album in album_list])
        return [
            self._album_to_response_simple(album, favorite_ids=favorite_ids, public_ids=public_ids)
            for album in album_list
        ]

    def _online_playlist_links(self, playlist_ids: list[int]) -> dict[int, list[PlaylistLibraryTrack]]:
        ids = set(playlist_ids)
        if not ids:
            return {}
        links = self.playlists.session.scalars(
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

    def _history_entries_to_response(self, entries) -> list[HistoryResponse]:
        entry_list = list(entries)
        song_responses = self._songs_to_response([entry.song for entry in entry_list if entry.song])
        songs_by_id = {song.id: song for song in song_responses}
        return [self._history_to_response(entry, songs_by_id=songs_by_id) for entry in entry_list]

    def _song_to_response(
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
            self._album_public_id(song.album_id)
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
            artwork_path=song.artwork_path or (song.album.artwork_path if song.album else None),
            artwork_url=song.artwork_url or (song.album.artwork_url if song.album else None),
            source_url=song.source_url,
            is_downloaded=self._downloaded_song_file_exists(song),
            is_favorited=is_favorited,
            created_at=song.created_at,
            updated_at=song.updated_at,
        )

    def _artist_to_response(
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
        artwork_path, artwork_url = self._artist_artwork(artist)
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

    def _album_to_response_simple(
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
        available_songs = [song for song in album.songs if self._downloaded_song_file_exists(song)]
        song_count = len(available_songs)
        duration_seconds = sum(song.duration_seconds or 0 for song in available_songs)
        artwork_path, artwork_url = self._album_artwork(album)
        return AlbumResponse(
            id=album.id,
            public_id=self._album_public_id(album.id) if public_ids is None else public_ids.get(album.id),
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

    def _album_public_id(self, local_album_id: int) -> str | None:
        return self.favorites.session.scalars(
            select(LibraryAlbum.public_id).where(LibraryAlbum.local_album_id == local_album_id)
        ).first()

    def _playlist_to_response(
        self,
        playlist: Playlist,
        *,
        online_links: list[PlaylistLibraryTrack] | None = None,
    ) -> PlaylistResponse:
        song_count = len(playlist.songs) if hasattr(playlist, "songs") else 0
        duration_seconds = sum(ps.song.duration_seconds or 0 for ps in playlist.songs if ps.song and ps.song.duration_seconds) if hasattr(playlist, "songs") else 0
        if online_links is None:
            online_links = self._online_playlist_links([playlist.id]).get(playlist.id, [])
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

        artwork_path = track.artwork_path or (track.song.artwork_path if track.song else None)
        artwork_url = track.artwork_url or (track.song.artwork_url if track.song else None)
        if track.album:
            artwork_path = artwork_path or track.album.artwork_path
            artwork_url = artwork_url or track.album.artwork_url
        return LibraryTrackResponse(
            id=track.id,
            song_id=track.song_id,
            artist_id=track.song.artist_id if track.song else None,
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
            artwork_url=artwork_url,
            artwork_path=artwork_path,
            explicit=track.explicit,
            is_downloaded=self._downloaded_library_track_file_exists(track),
            created_at=track.created_at,
            updated_at=track.updated_at,
        )

    @staticmethod
    def _downloaded_library_track_file_exists(track) -> bool:
        if not track.is_downloaded or not track.relative_path:
            return False
        try:
            return resolve_library_path(track.relative_path).is_file()
        except (OSError, ValueError):
            return False

    def _history_to_response(
        self,
        entry,
        *,
        songs_by_id: dict[int, SongResponse] | None = None,
    ) -> HistoryResponse:
        song_response = None
        if entry.song:
            song_response = (
                self._song_to_response(entry.song)
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
            artist_name=entry.artist_name or (song_response.artist_name if song_response else None),
            album_title=entry.album_title or (song_response.album_title if song_response else None),
            artwork_url=(
                song_response.artwork_path or song_response.artwork_url or entry.artwork_url
                if song_response
                else entry.artwork_url
            ),
            duration_seconds=entry.duration_seconds or (song_response.duration_seconds if song_response else None),
            source_url=entry.source_url or (song_response.source_url if song_response else None),
            event_type=entry.event_type,
            played_at=entry.played_at,
            position_seconds=entry.position_seconds,
        )

    @staticmethod
    def _album_artwork(album) -> tuple[str | None, str | None]:
        if album.artwork_path or album.artwork_url:
            return album.artwork_path, album.artwork_url
        for song in getattr(album, "songs", ()):
            if song.artwork_path or song.artwork_url:
                return song.artwork_path, song.artwork_url
        return None, None

    @classmethod
    def _artist_artwork(cls, artist) -> tuple[str | None, str | None]:
        if artist.artwork_path or artist.artwork_url:
            return artist.artwork_path, artist.artwork_url
        for album in getattr(artist, "albums", ()):
            artwork = cls._album_artwork(album)
            if any(artwork):
                return artwork
        for song in getattr(artist, "songs", ()):
            if song.artwork_path or song.artwork_url:
                return song.artwork_path, song.artwork_url
        return None, None
