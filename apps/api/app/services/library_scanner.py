"""
Library scanner service.

Scans music directories for new/changed/removed files.
"""

import logging
import os
import re
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Generator, Iterator
from uuid import uuid4

from mutagen import File as MutagenFile
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.models import Album, History, LibraryAlbum, LibraryTrack, Song
from app.repositories.music import AlbumRepository, ArtistRepository, SongRepository
from app.services.file_paths import library_storage_path, resolve_library_path

logger = logging.getLogger(__name__)
_library_sync_lock = threading.RLock()


@contextmanager
def library_sync_guard() -> Iterator[None]:
    """Serialize filesystem discovery with download publication."""
    with _library_sync_lock:
        yield


class LibraryScanResult:
    """Result of library scan operation."""
    
    def __init__(self):
        self.added = 0
        self.updated = 0
        self.removed = 0
        self.errors = 0
        self.total_processed = 0
        self.reconciled = 0


class LibraryScannerService:
    """Service for scanning and importing music files."""
    
    SUPPORTED_EXTENSIONS = {".mp3", ".m4a", ".flac", ".ogg", ".opus", ".wav"}
    PENDING_DELETE_FILENAME = re.compile(r"^\..+\.aura-delete-[0-9a-f]{32}$")
    DOWNLOAD_STAGE_FILENAME = re.compile(r"^\.(?P<original>.+)\.aura-stage-[0-9a-f]{32}$")
    DOWNLOAD_BACKUP_FILENAME = re.compile(r"^\.(?P<original>.+)\.aura-backup-[0-9a-f]{32}$")
    
    def __init__(self, session: Session, *, cancel_event: threading.Event | None = None) -> None:
        self.session = session
        self.songs = SongRepository(session)
        self.artists = ArtistRepository(session)
        self.albums = AlbumRepository(session)
        self.cancel_event = cancel_event
    
    def scan_directory(
        self,
        directory: str | Path,
        *,
        refresh_existing_metadata: bool = True,
    ) -> LibraryScanResult:
        with _library_sync_lock:
            return self._scan_directory(
                directory,
                refresh_existing_metadata=refresh_existing_metadata,
            )

    def _scan_directory(
        self,
        directory: str | Path,
        *,
        refresh_existing_metadata: bool,
    ) -> LibraryScanResult:
        """
        Scan a directory for music files and import them.
        
        - Adds new files
        - Updates changed files
        - Marks missing files as not downloaded
        """
        directory = Path(directory)
        result = LibraryScanResult()
        
        if not directory.exists():
            logger.error("Directory does not exist: %s", directory)
            raise FileNotFoundError(f"Library scan directory does not exist: {directory}")
        if not directory.is_dir():
            raise NotADirectoryError(f"Library scan path is not a directory: {directory}")
        
        logger.debug("Starting library scan: %s", directory)
        self._recover_download_publications(directory, result)
        self._cleanup_pending_deletions(directory, result)
        
        def walk_error(exc: OSError) -> None:
            result.errors += 1
            logger.warning("Skipping inaccessible library directory: %s", exc)

        for file_path in self._find_music_files(directory, onerror=walk_error):
            if self.cancel_event is not None and self.cancel_event.is_set():
                logger.info("Library scan cancelled at storage checkpoint")
                break
            result.total_processed += 1
            try:
                with self.session.begin_nested():
                    outcome = self._import_file(
                        file_path,
                        refresh_existing_metadata=refresh_existing_metadata,
                    )
                if outcome == "added":
                    result.added += 1
                elif outcome == "updated":
                    result.updated += 1
            except Exception as exc:
                logger.warning("Skipping unreadable or malformed media file %s: %s", file_path, exc)
                result.errors += 1
        
        # Find removed files
        all_songs = self.session.scalars(select(Song)).all()
        for song in all_songs:
            if self.cancel_event is not None and self.cancel_event.is_set():
                break
            if song.relative_path:
                try:
                    exists = resolve_library_path(song.relative_path).is_file()
                except (OSError, ValueError) as exc:
                    logger.warning("Could not stat managed track %s: %s", song.relative_path, exc)
                    result.errors += 1
                    continue
                if not exists:
                    if song.is_downloaded:
                        song.is_downloaded = False
                        result.removed += 1

        if self.cancel_event is not None and self.cancel_event.is_set():
            self.session.commit()
            logger.info(
                "Scan stopped for storage migration: %s processed, %s errors",
                result.total_processed,
                result.errors,
            )
            return result

        result.reconciled = self._reconcile_download_state()
        self._sync_canonical_albums()
        result.reconciled += self._repair_local_history()
        
        self.session.commit()
        
        # The background reconcile runs every 30 seconds; only report scans
        # that actually changed something.
        changed = result.added or result.updated or result.removed or result.reconciled or result.errors
        logger.log(
            logging.INFO if changed else logging.DEBUG,
            "Scan complete: %s added, %s updated, %s removed, %s reconciled, %s errors",
            result.added,
            result.updated,
            result.removed,
            result.reconciled,
            result.errors,
        )
        
        return result

    def _recover_download_publications(self, directory: Path, result: LibraryScanResult) -> None:
        """Resolve crash leftovers before the normal media discovery pass."""
        for pattern, matcher in (
            (".*.aura-backup-*", self.DOWNLOAD_BACKUP_FILENAME),
            (".*.aura-stage-*", self.DOWNLOAD_STAGE_FILENAME),
        ):
            for artifact in directory.rglob(pattern):
                match = matcher.fullmatch(artifact.name)
                if not match:
                    continue
                target = artifact.with_name(match.group("original"))
                try:
                    if target.exists():
                        if not target.is_file():
                            raise OSError("The download publication target is not a regular file")
                        artifact.unlink(missing_ok=True)
                    elif artifact.is_file():
                        os.replace(artifact, target)
                    else:
                        raise OSError("The download publication artifact is not a regular file")
                except OSError:
                    result.errors += 1
                    logger.warning("Could not recover an interrupted download publication", exc_info=True)

    def _cleanup_pending_deletions(self, directory: Path, result: LibraryScanResult) -> None:
        """Finish deletion tombstones left after a successful DB commit."""
        for path in directory.rglob(".*.aura-delete-*"):
            if not self.PENDING_DELETE_FILENAME.fullmatch(path.name):
                continue
            try:
                path.unlink(missing_ok=True)
            except OSError:
                result.errors += 1
                logger.warning("Could not remove a pending download tombstone", exc_info=True)

    def reconcile_download_state(self) -> int:
        """Make downloaded flags and linked paths reflect the managed filesystem."""
        with _library_sync_lock:
            changed = self._reconcile_download_state()
            self._sync_canonical_albums()
            changed += self._repair_local_history()
            self.session.commit()
            return changed

    def _reconcile_download_state(self) -> int:
        songs = {song.id: song for song in self.session.scalars(select(Song)).all()}
        tracks = self.session.scalars(select(LibraryTrack)).all()
        changed = 0

        linked_song_ids: set[int] = set()
        for track in tracks:
            song = songs.get(track.song_id) if track.song_id is not None else None
            if song is None:
                desired = self._managed_file_exists(track.relative_path)
                if track.is_downloaded != desired:
                    track.is_downloaded = desired
                    changed += 1
                continue

            linked_song_ids.add(song.id)
            canonical_path = self._first_existing_path(song.relative_path, track.relative_path)
            desired = canonical_path is not None
            if canonical_path is not None:
                if song.relative_path != canonical_path:
                    song.relative_path = canonical_path
                    changed += 1
                if track.relative_path != canonical_path:
                    track.relative_path = canonical_path
                    changed += 1
            if song.is_downloaded != desired:
                song.is_downloaded = desired
                changed += 1
            if track.is_downloaded != desired:
                track.is_downloaded = desired
                changed += 1

        for song in songs.values():
            if song.id in linked_song_ids:
                continue
            desired = self._managed_file_exists(song.relative_path)
            if song.is_downloaded != desired:
                song.is_downloaded = desired
                changed += 1
        return changed

    @staticmethod
    def _managed_file_exists(relative_path: str | None) -> bool:
        if not relative_path:
            return False
        try:
            return resolve_library_path(relative_path).is_file()
        except (OSError, ValueError):
            return False

    @classmethod
    def _first_existing_path(cls, *values: str | None) -> str | None:
        for value in values:
            if value and cls._managed_file_exists(value):
                return library_storage_path(resolve_library_path(value))
        return None

    def _sync_canonical_albums(self) -> None:
        """Keep scanned albums addressable through the permanent album registry."""
        # Sessions disable autoflush globally; persist tag-driven album moves
        # before relationship queries or this pass can rebuild the old album
        # and leave a duplicate track visible until the next background scan.
        self.session.flush()
        albums = self.session.scalars(select(Album).order_by(Album.id)).all()
        local_tracks = self.session.scalars(
            select(LibraryTrack).where(
                LibraryTrack.source == "local",
                LibraryTrack.song_id.is_not(None),
            )
        ).all()
        local_track_by_song_id: dict[int, LibraryTrack] = {}
        for track in sorted(local_tracks, key=lambda item: item.id):
            if track.song_id is not None:
                local_track_by_song_id.setdefault(track.song_id, track)
        assigned_track_ids: set[int] = set()
        for album in albums:
            canonical = self.session.scalars(
                select(LibraryAlbum).where(LibraryAlbum.local_album_id == album.id)
            ).first()
            if canonical is None:
                canonical = LibraryAlbum(
                    public_id=f"local_{uuid4().hex}",
                    local_album_id=album.id,
                    source="local",
                    external_id=str(album.id),
                    title=album.title,
                    artist_name=album.artist.name if album.artist else None,
                    year=album.year,
                    artwork_path=album.artwork_path,
                    artwork_url=album.artwork_url,
                )
                self.session.add(canonical)
                self.session.flush()
            else:
                canonical.title = album.title
                canonical.artist_name = album.artist.name if album.artist else None
                canonical.year = album.year
                canonical.artwork_path = album.artwork_path or canonical.artwork_path
                canonical.artwork_url = album.artwork_url or canonical.artwork_url

            if canonical.source == "local":
                canonical.is_in_library = any(song.is_downloaded for song in album.songs)
                canonical.removed_at = None if canonical.is_in_library else canonical.removed_at

            existing = {track.song_id: track for track in canonical.tracks if track.song_id is not None}
            songs = sorted(
                (song for song in album.songs if song.is_downloaded),
                key=lambda song: (song.disc_number or 1, song.track_number or song.id, song.id),
            )
            planned = [
                existing.get(song.id)
                or (local_track_by_song_id.get(song.id) if canonical.source == "local" else None)
                for song in songs
            ]
            # Moving positions through negative values avoids transient unique
            # (album_id, position) collisions, but it rewrites every row. The
            # background reconcile runs every 30 seconds, so skip it when the
            # album is already in its settled order.
            planned_ids = {id(track) for track in planned if track is not None}
            already_ordered = all(
                track is not None and track.album_id == canonical.id and track.position == position
                for position, track in enumerate(planned)
            ) and all(track.position < 0 for track in canonical.tracks if id(track) not in planned_ids)
            if not already_ordered:
                for temporary_position, track in enumerate(canonical.tracks, start=1):
                    track.position = -temporary_position
                self.session.flush()
            for position, (song, track) in enumerate(zip(songs, planned)):
                if track is None:
                    track = LibraryTrack(
                        album_id=canonical.id,
                        song_id=song.id,
                        source="local",
                        external_id=f"local_song_{song.id}",
                        title=song.title,
                        position=position,
                    )
                    self.session.add(track)
                track.album_id = canonical.id
                track.title = song.title
                track.artist_name = song.artist.name if song.artist else canonical.artist_name
                track.album_title = album.title
                track.duration_seconds = song.duration_seconds
                track.track_number = song.track_number
                track.disc_number = song.disc_number
                track.position = position
                track.source_url = song.source_url
                track.artwork_path = song.artwork_path
                track.artwork_url = song.artwork_url
                track.relative_path = song.relative_path
                track.is_downloaded = song.is_downloaded
                track.is_in_library = canonical.is_in_library
                if track.id is not None:
                    assigned_track_ids.add(track.id)

        for track in local_tracks:
            if track.id in assigned_track_ids:
                continue
            track.album_id = None
            track.is_in_library = track.is_downloaded

    def _repair_local_history(self) -> int:
        """Repair local tracks that older clients recorded as YouTube items."""
        local_tracks = self.session.scalars(
            select(LibraryTrack)
            .options(joinedload(LibraryTrack.song))
            .where(
                LibraryTrack.source == "local",
                LibraryTrack.song_id.is_not(None),
                LibraryTrack.external_id.like("local_song_%"),
            )
        ).all()
        by_external_id = {track.external_id: track for track in local_tracks}
        if not by_external_id:
            return 0

        entries = self.session.scalars(
            select(History).where(
                History.source == "youtube",
                History.external_id.in_(by_external_id),
            )
        ).all()
        for entry in entries:
            track = by_external_id[entry.external_id]
            song = track.song
            entry.source = "local"
            entry.song_id = track.song_id
            entry.external_id = str(track.song_id)
            entry.source_url = (song.source_url if song else None) or entry.source_url
            entry.artwork_url = (
                track.artwork_path
                or track.artwork_url
                or (song.artwork_path if song else None)
                or (song.artwork_url if song else None)
                or entry.artwork_url
            )
        return len(entries)
    
    def _find_music_files(self, directory: Path, *, onerror=None) -> Generator[Path, None, None]:
        """Recursively find all music files."""
        for root, _directories, files in os.walk(directory, onerror=onerror):
            for filename in files:
                path = Path(root) / filename
                if path.suffix.lower() not in self.SUPPORTED_EXTENSIONS:
                    continue
                try:
                    if path.is_file():
                        yield path
                except OSError as exc:
                    if onerror:
                        onerror(exc)
    
    def _import_file(
        self,
        file_path: Path,
        *,
        refresh_existing_metadata: bool = True,
    ) -> str:
        """
        Import a single music file.
        
        Returns True if new file, False if existing file updated.
        """
        file_str = library_storage_path(file_path)
        
        # Check if file already exists
        existing_song = self.songs.find_by_file_path(file_str)
        if existing_song and not refresh_existing_metadata:
            if existing_song.is_downloaded:
                return "unchanged"
            existing_song.is_downloaded = True
            return "updated"

        # Extract metadata
        metadata = self._extract_metadata(file_path)
        
        if existing_song:
            # Update existing
            return "updated" if self._update_song_metadata(existing_song, metadata) else "unchanged"
        else:
            # Create new
            self._create_song_from_metadata(file_str, metadata)
            return "added"
    
    def _extract_metadata(self, file_path: Path) -> dict:
        """Extract metadata from audio file."""
        try:
            audio = MutagenFile(file_path)
            if not audio:
                raise ValueError("Unsupported or malformed media file")
            
            metadata = {
                "title": None,
                "artist": None,
                "album": None,
                "album_artist": None,
                "track_number": None,
                "disc_number": None,
                "year": None,
                "duration": None,
            }
            
            # Get tags based on file type
            tags = audio.tags if hasattr(audio, "tags") else audio
            
            if tags:
                # Common tag mappings
                metadata["title"] = self._get_tag(tags, ["TIT2", "title", "©nam"])
                metadata["artist"] = self._get_tag(tags, ["TPE1", "artist", "©ART"])
                metadata["album"] = self._get_tag(tags, ["TALB", "album", "©alb"])
                metadata["album_artist"] = self._get_tag(tags, ["TPE2", "albumartist", "aART"])

                # Track number
                track = self._get_tag(tags, ["TRCK", "tracknumber", "trkn"])
                metadata["track_number"] = self._parse_tag_number(track)

                # Disc number
                disc = self._get_tag(tags, ["TPOS", "discnumber", "disk"])
                metadata["disc_number"] = self._parse_tag_number(disc)

                # Year
                year = self._get_tag(tags, ["TDRC", "date", "©day"])
                if year:
                    year_str = str(year)[:4]
                    try:
                        metadata["year"] = int(year_str)
                    except ValueError:
                        pass
            
            # Duration
            if hasattr(audio.info, "length"):
                metadata["duration"] = int(audio.info.length)
            
            # Fallback to filename if no title
            if not metadata["title"]:
                metadata["title"] = file_path.stem
            
            return metadata
            
        except Exception as exc:
            logger.error("Failed to extract metadata from %s: %s", file_path, exc)
            raise
    
    def _get_tag(self, tags, keys: list[str]) -> str | None:
        """Get first matching tag from a list of possible keys."""
        for key in keys:
            if hasattr(tags, "get"):
                value = tags.get(key)
                if value:
                    return str(value[0]) if isinstance(value, list) else str(value)
            elif hasattr(tags, key):
                value = getattr(tags, key)
                if value:
                    return str(value.text[0]) if hasattr(value, "text") else str(value)
        return None

    @staticmethod
    def _parse_tag_number(value: str | None) -> int | None:
        if not value:
            return None
        match = re.search(r"\d+", str(value))
        if not match:
            return None
        number = int(match.group())
        return number if number > 0 else None
    
    def _create_song_from_metadata(self, file_path: str, metadata: dict) -> Song:
        """Create new song from metadata."""
        # Get or create artist
        artist = None
        if metadata.get("artist"):
            artist = self.artists.get_or_create(metadata["artist"])
        
        # Get or create album
        album = None
        if metadata.get("album"):
            album = self.albums.get_or_create(
                metadata["album"],
                artist.id if artist else None
            )
            
            # Set album year if available
            if metadata.get("year") and album and not album.year:
                album.year = metadata["year"]
        
        # Create song
        song = Song(
            title=metadata.get("title", "Unknown"),
            artist_id=artist.id if artist else None,
            album_id=album.id if album else None,
            track_number=metadata.get("track_number"),
            disc_number=metadata.get("disc_number"),
            duration_seconds=metadata.get("duration"),
            relative_path=file_path,
            is_downloaded=True,
        )
        
        self.songs.add(song)
        logger.info("Created song: %s", song.title)
        return song
    
    def _update_song_metadata(self, song: Song, metadata: dict) -> bool:
        """Update existing song with new metadata."""
        before = (
            song.is_downloaded,
            song.title,
            song.duration_seconds,
            song.track_number,
            song.disc_number,
            song.artist_id,
            song.album_id,
            song.album.year if song.album else None,
        )
        song.is_downloaded = True
        
        # Update basic fields
        if metadata.get("title"):
            song.title = metadata["title"]
        if metadata.get("duration"):
            song.duration_seconds = metadata["duration"]
        if metadata.get("track_number"):
            song.track_number = metadata["track_number"]
        if metadata.get("disc_number"):
            song.disc_number = metadata["disc_number"]

        artist = song.artist
        if metadata.get("artist"):
            artist = self.artists.get_or_create(metadata["artist"])
            song.artist_id = artist.id

        if metadata.get("album"):
            album = self.albums.get_or_create(
                metadata["album"],
                artist.id if artist else None,
            )
            if metadata.get("year"):
                album.year = metadata["year"]
            song.album_id = album.id
        
        after = (
            song.is_downloaded,
            song.title,
            song.duration_seconds,
            song.track_number,
            song.disc_number,
            song.artist_id,
            song.album_id,
            self.session.get(Album, song.album_id).year if song.album_id else None,
        )
        changed = before != after
        if changed:
            logger.info("Updated song: %s", song.title)
        return changed
