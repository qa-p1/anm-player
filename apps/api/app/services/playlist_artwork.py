"""Custom playlist covers: validated, square-cropped JPEGs in managed storage."""

import hashlib
import os
import re
import warnings
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageOps

from app.core.config import settings
from app.core.exceptions import InvalidInputError
from app.storage import storage_manager

ALLOWED_CONTENT_TYPES = frozenset({"image/jpeg", "image/png", "image/webp"})
ALLOWED_FORMATS = frozenset({"JPEG", "PNG", "WEBP"})
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
COVER_SIZE = 1200
COVER_URL_PREFIX = "/media/artwork/playlists/"
COVER_FILENAME = re.compile(r"^[0-9a-f]{64}\.jpg$")


def covers_directory() -> Path:
    return storage_manager.paths.root / "artwork" / "playlists"


def cover_file(filename: str) -> Path | None:
    """Resolve a served cover filename, rejecting anything but our own names."""
    if not COVER_FILENAME.fullmatch(filename):
        return None
    return covers_directory() / filename


def save_cover(content: bytes, content_type: str | None) -> str:
    """Store an uploaded image and return the artwork path to persist."""
    media_type = (content_type or "").split(";", 1)[0].strip().lower()
    if media_type not in ALLOWED_CONTENT_TYPES:
        raise InvalidInputError("Upload a JPEG, PNG or WebP image.")
    if not content:
        raise InvalidInputError("The uploaded image is empty.")
    if len(content) > MAX_UPLOAD_BYTES:
        raise InvalidInputError("Cover images must be 10 MB or smaller.")

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(content)) as source:
                if source.format not in ALLOWED_FORMATS:
                    raise InvalidInputError("Upload a JPEG, PNG or WebP image.")
                if source.width * source.height > settings.artwork_max_pixels:
                    raise InvalidInputError("That image is too large.")
                source.load()
                image = ImageOps.exif_transpose(source).convert("RGB")
    except InvalidInputError:
        raise
    except (OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise InvalidInputError("That file is not a readable image.") from exc

    try:
        side = min(image.width, image.height)
        square = ImageOps.fit(image, (min(side, COVER_SIZE), min(side, COVER_SIZE)), Image.Resampling.LANCZOS)
        buffer = BytesIO()
        square.save(buffer, "JPEG", quality=88, optimize=True, progressive=True)
        square.close()
    finally:
        image.close()

    encoded = buffer.getvalue()
    filename = f"{hashlib.sha256(encoded).hexdigest()}.jpg"
    directory = covers_directory()
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / filename
    if not target.is_file():
        temporary = target.with_suffix(".tmp")
        try:
            temporary.write_bytes(encoded)
            os.replace(temporary, target)
        finally:
            temporary.unlink(missing_ok=True)
    return f"{COVER_URL_PREFIX}{filename}"


def cover_filename(artwork_path: str | None) -> str | None:
    """Return the managed cover filename referenced by an artwork path, if any."""
    if not artwork_path or COVER_URL_PREFIX not in artwork_path:
        return None
    filename = artwork_path.rsplit("/", 1)[-1]
    return filename if COVER_FILENAME.fullmatch(filename) else None


def delete_cover_file(filename: str) -> None:
    path = cover_file(filename)
    if path is not None:
        path.unlink(missing_ok=True)
