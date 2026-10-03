"""Audio metadata tag reading and writing."""

import logging
from dataclasses import dataclass
from pathlib import Path

from mutagen.easyid3 import EasyID3
from mutagen.id3 import ID3, ID3NoHeaderError, USLT
from mutagen.mp4 import MP4
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

    def read_lyrics(self, file_path: str | Path) -> str | None:
        """Read embedded lyrics from ID3 USLT, MP4 ``\xa9lyr``, or Vorbis comments."""
        audio = MutagenFile(Path(file_path))
        if audio is None or not audio.tags:
            return None
        tags = audio.tags
        value = None
        if isinstance(tags, ID3):
            frames = tags.getall("USLT")
            value = frames[0].text if frames else None
        elif isinstance(audio, MP4):
            value = (tags.get("\xa9lyr") or [None])[0]
        else:
            for key in ("LYRICS", "UNSYNCEDLYRICS"):
                value = (tags.get(key) or [None])[0]
                if value:
                    break
        text = str(value).strip() if value else ""
        return text or None

    def write_lyrics(self, file_path: str | Path, lyrics: str) -> bool:
        """Embed lyrics using the container's native field.

        MP3 uses an ID3 USLT frame, MP4/M4A the ``\xa9lyr`` atom, and FLAC, Ogg,
        and Opus a ``LYRICS`` Vorbis comment. Writing ID3 into anything but an
        MP3 would prepend a foreign header and corrupt the container.
        """
        path = Path(file_path)
        try:
            audio = MutagenFile(path)
            if audio is None:
                return False
            if isinstance(audio, MP4):
                if audio.tags is None:
                    audio.add_tags()
                audio.tags["\xa9lyr"] = [lyrics]
                audio.save()
                return True
            if path.suffix.lower() == ".mp3" or isinstance(audio.tags, ID3):
                try:
                    tags = ID3(path)
                except ID3NoHeaderError:
                    tags = ID3()
                tags.delall("USLT")
                tags.add(USLT(encoding=3, lang="eng", desc="", text=lyrics))
                tags.save(path)
                return True
            if audio.tags is None:
                audio.add_tags()
            audio.tags["LYRICS"] = [lyrics]
            audio.save()
            return True
        except Exception:
            logger.warning("failed to embed lyrics", extra={"file_path": str(path)}, exc_info=True)
            return False

    def _set(self, tags: EasyID3, key: str, value: str | list[str] | None) -> None:
        if value is None or value == "":
            return
        tags[key] = value if isinstance(value, list) else [value]
