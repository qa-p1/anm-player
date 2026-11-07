import re
import unicodedata
from urllib.parse import quote, urlsplit

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.exceptions import ConflictError, ResourceNotFoundError
from app.models import (
    LibraryTrack,
    Playlist,
    PlaylistLibraryTrack,
    PlaylistSong,
    Song,
)
from app.repositories.music import (
    PlaylistRepository,
    SongRepository,
)
from app.schemas.library import MixedPlaylistTrackResponse
from app.schemas.music import (
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
)
from app.services import playlist_artwork
from app.services.catalog_presenter import CatalogPresenter


class PlaylistService:
    def __init__(self, session: Session) -> None:
        self.playlists = PlaylistRepository(session)
        self.songs = SongRepository(session)
        self.responses = CatalogPresenter(session)

    def list_playlists(
        self, *, limit: int = 50, offset: int = 0
    ) -> list[PlaylistResponse]:
        playlists = list(
            self.playlists.session.scalars(
                select(Playlist)
                .options(
                    selectinload(Playlist.songs)
                    .joinedload(PlaylistSong.song)
                    .joinedload(Song.artist),
                    selectinload(Playlist.songs)
                    .joinedload(PlaylistSong.song)
                    .joinedload(Song.album),
                )
                .order_by(Playlist.created_at.desc(), Playlist.id.desc())
                .offset(offset)
                .limit(limit)
            )
        )
        online_by_playlist = self.responses.online_playlist_links(
            [playlist.id for playlist in playlists]
        )
        return [
            self.responses.playlist_to_response(
                playlist, online_links=online_by_playlist.get(playlist.id, [])
            )
            for playlist in playlists
        ]

    def get_playlist(self, playlist_id: int) -> PlaylistDetailResponse:
        playlist = self.playlists.get_with_songs(playlist_id)
        if not playlist:
            raise ResourceNotFoundError(
                "Playlist not found", details={"playlist_id": playlist_id}
            )

        song_links = [link for link in playlist.songs if link.song]
        songs = self.responses.songs_to_response([link.song for link in song_links])
        songs_by_id = {song.id: song for song in songs}
        online_links = self.responses.online_playlist_links([playlist_id]).get(
            playlist_id, []
        )
        library_by_id = {
            track.id: track
            for track in self.responses.library.tracks_to_response(
                [link.track for link in online_links if link.track]
            )
        }
        library_tracks = [
            MixedPlaylistTrackResponse(
                item_type="library_track",
                position=link.position,
                track=library_by_id[link.track.id],
            )
            for link in online_links
            if link.track
        ]
        items = [
            PlaylistItemResponse(
                item_type="song", position=link.position, song=songs_by_id[link.song.id]
            )
            for link in song_links
        ]
        items.extend(
            PlaylistItemResponse(
                item_type="library_track",
                position=link.position,
                track=library_by_id[link.track.id],
            )
            for link in online_links
            if link.track
        )
        items.sort(
            key=lambda item: (item.position, 0 if item.item_type == "song" else 1)
        )
        duration_seconds = sum(
            song.duration_seconds or 0 for song in songs if song.duration_seconds
        )
        duration_seconds += sum(
            link.track.duration_seconds or 0
            for link in online_links
            if link.track and link.track.duration_seconds
        )

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
        return self.responses.playlist_to_response(playlist)

    def update_playlist(
        self, playlist_id: int, request: PlaylistUpdateRequest
    ) -> PlaylistDetailResponse:
        playlist = self.playlists.get(playlist_id)
        if not playlist:
            raise ResourceNotFoundError(
                "Playlist not found", details={"playlist_id": playlist_id}
            )

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
            raise ResourceNotFoundError(
                "Playlist not found", details={"playlist_id": playlist_id}
            )

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
            raise ResourceNotFoundError(
                "Playlist not found", details={"playlist_id": playlist_id}
            )
        for _, link in self._ordered_playlist_links(playlist_id):
            self.playlists.session.delete(link)
        self.playlists.touch(playlist_id)
        self.playlists.session.commit()
        return self.get_playlist(playlist_id)

    def reorder_playlist(
        self,
        playlist_id: int,
        request: PlaylistReorderRequest,
    ) -> PlaylistDetailResponse:
        if not self.playlists.get(playlist_id):
            raise ResourceNotFoundError(
                "Playlist not found", details={"playlist_id": playlist_id}
            )

        current = self._playlist_link_map(playlist_id)
        requested_keys = [(item.item_type, item.item_id) for item in request.items]
        requested_set = set(requested_keys)
        current_set = set(current)
        if len(requested_keys) != len(requested_set) or requested_set != current_set:
            raise ConflictError(
                "Playlist items changed. Refresh the playlist and submit its complete item order.",
                details={
                    "missing_items": self._playlist_keys_payload(
                        current_set - requested_set
                    ),
                    "unexpected_items": self._playlist_keys_payload(
                        requested_set - current_set
                    ),
                },
            )

        try:
            self._assign_playlist_positions([current[key] for key in requested_keys])
            self.playlists.touch(playlist_id)
            self.playlists.session.commit()
        except IntegrityError as exc:
            self.playlists.session.rollback()
            raise ConflictError(
                "The playlist changed while it was being reordered. Refresh it and try again."
            ) from exc
        return self.get_playlist(playlist_id)

    def bulk_remove_playlist_items(
        self,
        playlist_id: int,
        request: PlaylistBulkRemoveRequest,
    ) -> PlaylistDetailResponse:
        if not self.playlists.get(playlist_id):
            raise ResourceNotFoundError(
                "Playlist not found", details={"playlist_id": playlist_id}
            )

        current = self._playlist_link_map(playlist_id)
        requested_keys = [(item.item_type, item.item_id) for item in request.items]
        missing = set(requested_keys) - set(current)
        if missing:
            raise ResourceNotFoundError(
                "One or more items are not in this playlist.",
                details={"items": self._playlist_keys_payload(missing)},
            )

        for key in requested_keys:
            self.playlists.session.delete(current[key])
        self._compact_after_removal(playlist_id, set(requested_keys))
        return self.get_playlist(playlist_id)

    def export_playlist_m3u8(self, playlist_id: int) -> tuple[str, str]:
        playlist = self.playlists.get(playlist_id)
        if not playlist:
            raise ResourceNotFoundError(
                "Playlist not found", details={"playlist_id": playlist_id}
            )

        lines = ["#EXTM3U", f"#PLAYLIST:{self._m3u_text(playlist.name)}"]
        for item_type, link in self._ordered_playlist_links(playlist_id):
            if item_type == "song":
                song = link.song
                if not song:
                    continue
                duration = (
                    song.duration_seconds if song.duration_seconds is not None else -1
                )
                label = self._m3u_label(
                    song.artist.name if song.artist else None, song.title
                )
                location = f"/api/v1/media/songs/{song.id}/stream"
            else:
                track = link.track
                if not track:
                    continue
                duration = (
                    track.duration_seconds if track.duration_seconds is not None else -1
                )
                label = self._m3u_label(track.artist_name, track.title)
                if track.is_downloaded and track.relative_path:
                    location = f"/api/v1/media/library-tracks/{track.id}/stream"
                elif track.source == "youtube" and track.external_id:
                    location = (
                        f"/api/v1/ytmusic/stream/{quote(track.external_id, safe='')}"
                    )
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
            raise ResourceNotFoundError(
                "Playlist not found", details={"playlist_id": playlist_id}
            )
        previous_cover = playlist_artwork.cover_filename(playlist.artwork_path)
        self.playlists.delete(playlist)
        self.playlists.session.commit()
        self._discard_unused_cover(previous_cover)

    def set_playlist_artwork(
        self, playlist_id: int, content: bytes, content_type: str | None
    ) -> PlaylistDetailResponse:
        playlist = self.playlists.get(playlist_id)
        if not playlist:
            raise ResourceNotFoundError(
                "Playlist not found", details={"playlist_id": playlist_id}
            )
        previous_cover = playlist_artwork.cover_filename(playlist.artwork_path)
        playlist.artwork_path = playlist_artwork.save_cover(content, content_type)
        self.playlists.session.commit()
        if previous_cover != playlist_artwork.cover_filename(playlist.artwork_path):
            self._discard_unused_cover(previous_cover)
        return self.get_playlist(playlist_id)

    def remove_playlist_artwork(self, playlist_id: int) -> PlaylistDetailResponse:
        playlist = self.playlists.get(playlist_id)
        if not playlist:
            raise ResourceNotFoundError(
                "Playlist not found", details={"playlist_id": playlist_id}
            )
        previous_cover = playlist_artwork.cover_filename(playlist.artwork_path)
        playlist.artwork_path = None
        self.playlists.session.commit()
        self._discard_unused_cover(previous_cover)
        return self.get_playlist(playlist_id)

    def _discard_unused_cover(self, filename: str | None) -> None:
        """Delete an uploaded cover once no playlist (e.g. a duplicate) uses it."""
        if filename is None:
            return
        still_used = self.playlists.session.scalar(
            select(Playlist.id).where(Playlist.artwork_path.like(f"%{filename}")).limit(1)
        )
        if still_used is None:
            playlist_artwork.delete_cover_file(filename)

    def _ordered_playlist_links(
        self,
        playlist_id: int,
    ) -> list[tuple[str, PlaylistSong | PlaylistLibraryTrack]]:
        song_links = (
            self.playlists.session.scalars(
                select(PlaylistSong)
                .options(
                    joinedload(PlaylistSong.song).joinedload(Song.artist),
                    joinedload(PlaylistSong.song).joinedload(Song.album),
                )
                .where(PlaylistSong.playlist_id == playlist_id)
            )
            .unique()
            .all()
        )
        library_links = (
            self.playlists.session.scalars(
                select(PlaylistLibraryTrack)
                .options(
                    joinedload(PlaylistLibraryTrack.track).joinedload(
                        LibraryTrack.album
                    ),
                    joinedload(PlaylistLibraryTrack.track).joinedload(
                        LibraryTrack.song
                    ),
                )
                .where(PlaylistLibraryTrack.playlist_id == playlist_id)
            )
            .unique()
            .all()
        )
        links: list[tuple[str, PlaylistSong | PlaylistLibraryTrack]] = [
            *(("song", link) for link in song_links),
            *(("library_track", link) for link in library_links),
        ]
        return sorted(
            links,
            key=lambda item: (
                item[1].position,
                0 if item[0] == "song" else 1,
                item[1].id,
            ),
        )

    def _playlist_link_map(
        self,
        playlist_id: int,
    ) -> dict[tuple[str, int], PlaylistSong | PlaylistLibraryTrack]:
        return {
            (item_type, self._playlist_link_id(item_type, link)): link
            for item_type, link in self._ordered_playlist_links(playlist_id)
        }

    @staticmethod
    def _playlist_link_id(
        item_type: str, link: PlaylistSong | PlaylistLibraryTrack
    ) -> int:
        return link.song_id if item_type == "song" else link.track_id

    def _assign_playlist_positions(
        self, links: list[PlaylistSong | PlaylistLibraryTrack]
    ) -> None:
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
        candidate = f"{source_name[: 255 - len(suffix)]}{suffix}"
        suffix_number = 2
        while self.playlists.session.scalars(
            select(Playlist.id).where(Playlist.name == candidate)
        ).first():
            suffix = f" copy {suffix_number}"
            candidate = f"{source_name[: 255 - len(suffix)]}{suffix}"
            suffix_number += 1
        return candidate

    @staticmethod
    def _playlist_keys_payload(
        keys: set[tuple[str, int]],
    ) -> list[dict[str, str | int]]:
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
        if not value or any(
            ord(character) < 32 or ord(character) == 127 for character in value
        ):
            return None
        try:
            parsed = urlsplit(value)
            if (
                parsed.scheme != "https"
                or not parsed.hostname
                or parsed.username
                or parsed.password
            ):
                return None
        except ValueError:
            return None
        return value

    @staticmethod
    def _safe_playlist_export_filename(playlist_id: int, name: str) -> str:
        normalized = (
            unicodedata.normalize("NFKD", name)
            .encode("ascii", "ignore")
            .decode("ascii")
        )
        slug = re.sub(r"[^A-Za-z0-9._-]+", "-", normalized).strip("._-")[:120]
        stem = f"playlist-{playlist_id}"
        if slug:
            stem = f"{stem}-{slug}"
        return f"{stem}.m3u8"

    def add_songs_to_playlist(
        self, playlist_id: int, request: PlaylistAddSongsRequest
    ) -> PlaylistDetailResponse:
        if not self.playlists.get(playlist_id):
            raise ResourceNotFoundError(
                "Playlist not found", details={"playlist_id": playlist_id}
            )
        song_ids = list(dict.fromkeys(request.song_ids))
        found_ids = set(
            self.playlists.session.scalars(
                select(self.songs.model.id).where(self.songs.model.id.in_(song_ids))
            )
        )
        missing_ids = [song_id for song_id in song_ids if song_id not in found_ids]
        if missing_ids:
            raise ResourceNotFoundError(
                "One or more songs were not found", details={"song_ids": missing_ids}
            )
        existing_ids = set(
            self.playlists.session.scalars(
                select(PlaylistSong.song_id).where(
                    PlaylistSong.playlist_id == playlist_id,
                    PlaylistSong.song_id.in_(song_ids),
                )
            )
        )
        if existing_ids:
            raise ConflictError(
                "One or more songs are already in the playlist.",
                details={"song_ids": sorted(existing_ids)},
            )
        # Sessions do not autoflush, so positions are assigned up front instead
        # of re-querying the maximum for every song in the request.
        next_position = self.playlists.next_position(playlist_id)
        for offset, song_id in enumerate(song_ids):
            self.playlists.add_song(
                playlist_id, song_id, position=next_position + offset
            )
        self.playlists.touch(playlist_id)
        try:
            self.playlists.session.commit()
        except IntegrityError as exc:
            self.playlists.session.rollback()
            raise ConflictError(
                "The playlist changed while songs were being added. Refresh it and try again."
            ) from exc
        return self.get_playlist(playlist_id)

    def add_online_track_to_playlist(
        self, playlist_id: int, request: PlaylistAddOnlineTrackRequest
    ) -> PlaylistDetailResponse:
        playlist = self.playlists.get(playlist_id)
        if not playlist:
            raise ResourceNotFoundError(
                "Playlist not found", details={"playlist_id": playlist_id}
            )

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
        if not existing_link:
            self.playlists.touch(playlist_id)
        try:
            self.playlists.session.commit()
        except IntegrityError as exc:
            self.playlists.session.rollback()
            raise ConflictError(
                "The playlist changed while the track was being added. Refresh it and try again."
            ) from exc
        return self.get_playlist(playlist_id)

    def remove_song_from_playlist(
        self, playlist_id: int, song_id: int
    ) -> PlaylistDetailResponse:
        if not self.playlists.get(playlist_id):
            raise ResourceNotFoundError(
                "Playlist not found", details={"playlist_id": playlist_id}
            )
        song = self.songs.get(song_id)
        if not song:
            raise ResourceNotFoundError("Song not found", details={"song_id": song_id})
        if not self.playlists.remove_song(playlist_id, song_id):
            raise ResourceNotFoundError(
                "Song is not in this playlist.",
                details={"playlist_id": playlist_id, "song_id": song_id},
            )
        self._compact_after_removal(playlist_id, {("song", song_id)})
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
        self._compact_after_removal(playlist_id, {("library_track", track_id)})
        return self.get_playlist(playlist_id)

    def _compact_after_removal(
        self, playlist_id: int, removed: set[tuple[str, int]]
    ) -> None:
        """Close the gap a removal leaves, as bulk removal and reordering do."""
        remaining = [
            link
            for item_type, link in self._ordered_playlist_links(playlist_id)
            if (item_type, self._playlist_link_id(item_type, link)) not in removed
        ]
        try:
            self._assign_playlist_positions(remaining)
            self.playlists.touch(playlist_id)
            self.playlists.session.commit()
        except IntegrityError as exc:
            self.playlists.session.rollback()
            raise ConflictError(
                "The playlist changed while the item was being removed. Refresh it and try again."
            ) from exc
