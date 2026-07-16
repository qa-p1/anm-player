"""Audio metadata tag reading and writing."""

import logging
from dataclasses import dataclass
from pathlib import Path

from mutagen.easyid3 import EasyID3
from mutagen.id3 import ID3, ID3NoHeaderError
from mutagen import File as MutagenFile

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class AudioTagData:
    title: str | None = None
    artist: str | None = None
    album: str | None = None
    album_artist: str | None = None
    track_number: int | None = None
    disc_number: int | None = None
    year: int | None = None
    genre: list[str] | None = None
    isrc: str | None = None
    clear_album: bool = False


class AudioTaggingService:
    """Writes common metadata fields to audio files through Mutagen."""

    def write_tags(self, file_path: str | Path, data: AudioTagData) -> bool:
        path = Path(file_path)
        if not path.exists():
            logger.warning("cannot write tags; file does not exist", extra={"file_path": str(path)})
            return False

        if path.suffix.lower() != ".mp3":
            return self._write_generic_tags(path, data)

        try:
            try:
                tags = EasyID3(path)
            except ID3NoHeaderError:
                ID3().save(path)
                tags = EasyID3(path)

            self._set(tags, "title", data.title)
            self._set(tags, "artist", data.artist)
            self._set(tags, "album", data.album)
            if data.clear_album:
                tags.pop("album", None)
            self._set(tags, "albumartist", data.album_artist or data.artist)
            self._set(tags, "tracknumber", str(data.track_number) if data.track_number else None)
            self._set(tags, "discnumber", str(data.disc_number) if data.disc_number else None)
            self._set(tags, "date", str(data.year) if data.year else None)
            self._set(tags, "genre", data.genre)
            self._set(tags, "isrc", data.isrc)

            tags.save(path)
            return True
        except Exception:
            logger.exception("failed to write audio tags", extra={"file_path": str(path)})
            return False

    def _write_generic_tags(self, path: Path, data: AudioTagData) -> bool:
        try:
            audio = MutagenFile(path, easy=True)
            if audio is None:
                return False
            if audio.tags is None:
                audio.add_tags()
            values: dict[str, str | list[str] | None] = {
                "title": data.title,
                "artist": data.artist,
                "album": data.album,
                "albumartist": data.album_artist or data.artist,
                "tracknumber": str(data.track_number) if data.track_number else None,
                "discnumber": str(data.disc_number) if data.disc_number else None,
                "date": str(data.year) if data.year else None,
                "genre": data.genre,
            }
            if data.clear_album and "album" in audio:
                del audio["album"]
            for key, value in values.items():
                if value in (None, ""):
                    continue
                try:
                    audio[key] = value if isinstance(value, list) else [value]
                except (KeyError, ValueError):
                    logger.debug("audio container does not support tag", extra={"file_path": str(path), "tag": key})
            audio.save()
            return True
        except Exception:
            logger.exception("failed to write audio tags", extra={"file_path": str(path)})
            return False

    def _set(self, tags: EasyID3, key: str, value: str | list[str] | None) -> None:
        if value is None or value == "":
            return
        tags[key] = value if isinstance(value, list) else [value]
