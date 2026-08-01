from urllib.parse import parse_qs, urlsplit

from pydantic import BaseModel, field_validator

_ARTWORK_HOSTS = ("googleusercontent.com", "ggpht.com", "ytimg.com")
_API_PREFIX = "/api/v1/media/artwork/"
_LEGACY_PREFIX = "/media/artwork/"
_REMOTE_PROXY_PATH = "/api/v1/media/remote-artwork"


class ArtworkResponseModel(BaseModel):
    """Keep artwork responses browser-safe and free of physical local paths."""

    @field_validator("artwork_path", mode="before", check_fields=False)
    @classmethod
    def validate_artwork_path(cls, value: object) -> str | None:
        return public_artwork_path(value)

    @field_validator(
        "artwork_url",
        "thumbnail_url",
        mode="before",
        check_fields=False,
    )
    @classmethod
    def validate_artwork_url(cls, value: object) -> str | None:
        return public_artwork_value(value)


def public_artwork_path(value: object) -> str | None:
    text = str(value).strip() if value is not None else ""
    if not text or "\x00" in text or "\\" in text:
        return None

    parsed = urlsplit(text)
    path = parsed.path
    if path.startswith(_LEGACY_PREFIX):
        path = f"/api/v1{path}"
    if not path.startswith(_API_PREFIX):
        return None
    if any(part in {"", ".", ".."} for part in path.removeprefix(_API_PREFIX).split("/")):
        return None
    return path


def public_artwork_value(value: object, *, depth: int = 0) -> str | None:
    if depth > 3:
        return None
    text = str(value).strip() if value is not None else ""
    if not text:
        return None

    local_path = public_artwork_path(text)
    if local_path:
        return local_path

    parsed = urlsplit(text)
    if parsed.path == _REMOTE_PROXY_PATH:
        target = (parse_qs(parsed.query).get("url") or [None])[0]
        return public_artwork_value(target, depth=depth + 1)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
    ):
        return None
    try:
        if parsed.port not in (None, 443):
            return None
    except ValueError:
        return None

    host = parsed.hostname.casefold().rstrip(".")
    if not any(host == allowed or host.endswith(f".{allowed}") for allowed in _ARTWORK_HOSTS):
        return None
    return text
