"""
Library scanner service.

Scans music directories for new/changed/removed files.
"""

import logging
import os
import threading
from pathlib import Path
from typing import Generator
from uuid import uuid4

from mutagen import File as MutagenFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Album, Artist, LibraryAlbum, LibraryTrack, Song
from app.repositories.music import AlbumRepository, ArtistRepository, SongRepository
from app.services.file_paths import library_storage_path, resolve_library_path

logger = logging.getLogger(__name__)


class LibraryScanResult:
    """Result of library scan operation."""
    
    def __init__(self):
        self.added = 0
        self.updated = 0
        self.removed = 0
        self.errors = 0
        self.total_processed = 0


class LibraryScannerService:
    """Service for scanning and importing music files."""
    
    SUPPORTED_EXTENSIONS = {".mp3", ".m4a", ".flac", ".ogg", ".opus", ".wav"}
    
    def __init__(self, session: Session, *, cancel_event: threading.Event | None = None) -> None:
        self.session = session
        self.songs = SongRepository(session)
        self.artists = ArtistRepository(session)
        self.albums = AlbumRepository(session)
        self.cancel_event = cancel_event
    
    def scan_directory(self, directory: str | Path) -> LibraryScanResult:
        """
        Scan a directory for music files and import them.
        
        - Adds new files
        - Updates changed files
        - Marks missing files as not downloaded
        """
        directory = Path(directory)
        result = LibraryScanResult()
        
        if not directory.exists():
            logger.error(f"Directory does not exist: {directory}")
            raise FileNotFoundError(f"Library scan directory does not exist: {directory}")
        if not directory.is_dir():
            raise NotADirectoryError(f"Library scan path is not a directory: {directory}")
        
        logger.info(f"Starting library scan: {directory}")
        
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
                    outcome = self._import_file(file_path)
                if outcome == "added":
                    result.added += 1
                elif outcome == "updated":
                    result.updated += 1
            except Exception as exc:
                logger.warning("Skipping unreadable or malformed media file %s: %s", file_path, exc)
                result.errors += 1
        
        # Find removed files
        all_songs = self.songs.list()
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

        self._sync_canonical_albums()
        
        self.session.commit()
        
        logger.info(
            f"Scan complete: {result.added} added, {result.updated} updated, "
            f"{result.removed} removed, {result.errors} errors"
        )
        
        return result

    def _sync_canonical_albums(self) -> None:
        """Keep scanned albums addressable through the permanent album registry."""
        albums = self.session.scalars(select(Album).order_by(Album.id)).all()
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
                )
                self.session.add(canonical)
                self.session.flush()
            else:
                canonical.title = album.title
                canonical.artist_name = album.artist.name if album.artist else None
                canonical.year = album.year
                canonical.artwork_path = album.artwork_path or canonical.artwork_path

            existing = {track.song_id: track for track in canonical.tracks if track.song_id is not None}
            for temporary_position, track in enumerate(canonical.tracks, start=1):
                track.position = -temporary_position
            self.session.flush()
            songs = sorted(
                album.songs,
                key=lambda song: (song.disc_number or 1, song.track_number or song.id, song.id),
            )
            for position, song in enumerate(songs):
                track = existing.get(song.id)
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
                track.title = song.title
                track.artist_name = song.artist.name if song.artist else canonical.artist_name
                track.album_title = album.title
                track.duration_seconds = song.duration_seconds
                track.track_number = song.track_number
                track.disc_number = song.disc_number
                track.position = position
                track.source_url = song.source_url
                track.artwork_path = song.artwork_path
                track.relative_path = song.relative_path
                track.is_downloaded = song.is_downloaded
                track.is_in_library = canonical.is_in_library
    
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
    
    def _import_file(self, file_path: Path) -> str:
        """
        Import a single music file.
        
        Returns True if new file, False if existing file updated.
        """
        file_str = library_storage_path(file_path)
        
        # Check if file already exists
        existing_song = self.songs.find_by_file_path(file_str)
        
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
                track = self._get_tag(tags, ["TRCK", "tracknumber"])
                if track:
                    metadata["track_number"] = int(str(track).split("/")[0])
                
                # Disc number
                disc = self._get_tag(tags, ["TPOS", "discnumber"])
                if disc:
                    metadata["disc_number"] = int(str(disc).split("/")[0])
                
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
            logger.error(f"Failed to extract metadata from {file_path}: {exc}")
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
        logger.info(f"Created song: {song.title}")
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
        if "artist" in metadata:
            artist = self.artists.get_or_create(metadata["artist"]) if metadata.get("artist") else None
            song.artist_id = artist.id if artist else None

        if "album" in metadata:
            album = None
            if metadata.get("album"):
                album = self.albums.get_or_create(
                    metadata["album"],
                    artist.id if artist else None,
                )
                if metadata.get("year"):
                    album.year = metadata["year"]
            song.album_id = album.id if album else None
        
        logger.info(f"Updated song: {song.title}")
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
        return before != after
