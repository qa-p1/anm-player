import re
from pathlib import Path


class NamingService:
    invalid_chars = re.compile(r'[<>:"/\\|?*\x00-\x1F]')
    windows_reserved_names = {
        "CON",
        "PRN",
        "AUX",
        "NUL",
        *(f"COM{index}" for index in range(1, 10)),
        *(f"LPT{index}" for index in range(1, 10)),
    }

    def build_target_path(self, *, music_directory: Path, artist: str | None, album: str | None, title: str | None, extension: str = "mp3") -> Path:
        artist_name = self.sanitize(artist or "Unknown Artist")
        album_name = self.sanitize(album or "Unknown Album")
        track_name = self.sanitize(title or "Song")
        safe_extension = extension.lower().lstrip(".")
        if safe_extension not in {"mp3", "m4a", "flac", "opus", "ogg"}:
            raise ValueError(f"Unsupported audio extension: {extension}")
        return music_directory / artist_name / album_name / f"{track_name}.{safe_extension}"

    def sanitize(self, value: str) -> str:
        cleaned = self.invalid_chars.sub("", value).strip().rstrip(" .")
        cleaned = cleaned[:160].rstrip(" .")
        if not cleaned:
            return "Unknown"
        if cleaned.split(".", 1)[0].upper() in self.windows_reserved_names:
            cleaned = f"_{cleaned}"
        return cleaned
