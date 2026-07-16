from pathlib import Path

from app.services.naming import NamingService


def test_naming_service_uses_fallbacks_and_sanitizes() -> None:
    target = NamingService().build_target_path(
        music_directory=Path("/music"),
        artist=None,
        album="Bad:/Album",
        title="Track*Name?",
    )

    assert str(target).replace("\\", "/") == "/music/Unknown Artist/BadAlbum/TrackName.mp3"


def test_naming_service_preserves_configured_audio_format() -> None:
    target = NamingService().build_target_path(
        music_directory=Path("/music"),
        artist="Artist",
        album="Album",
        title="Track",
        extension="flac",
    )

    assert target.suffix == ".flac"
