from pathlib import Path

import app.services.tagging as tagging_module
from app.services.tagging import AudioTagData, AudioTaggingService


class FakeTags(dict):
    def __init__(self) -> None:
        super().__init__({"album": ["Old Album"]})
        self.saved: Path | None = None

    def save(self, path: Path) -> None:
        self.saved = path


def test_mp3_tagging_sets_supported_fields_and_clears_album(tmp_path, monkeypatch) -> None:
    audio = tmp_path / "song.mp3"
    audio.write_bytes(b"audio")
    tags = FakeTags()
    monkeypatch.setattr(tagging_module, "EasyID3", lambda _path: tags)
    service = AudioTaggingService()

    result = service.write_tags(
        audio,
        AudioTagData(
            title="Song",
            artist="Artist",
            album=None,
            album_artist="Album Artist",
            track_number=2,
            disc_number=1,
            year=2026,
            genre=["Alternative"],
            isrc="TEST123",
            clear_album=True,
        ),
    )

    assert result is True
    assert tags.saved == audio
    assert tags["title"] == ["Song"]
    assert tags["artist"] == ["Artist"]
    assert tags["albumartist"] == ["Album Artist"]
    assert tags["tracknumber"] == ["2"]
    assert tags["genre"] == ["Alternative"]
    assert "album" not in tags
    assert service.write_tags(tmp_path / "missing.mp3", AudioTagData()) is False


def test_generic_tagging_adds_tags_and_saves(tmp_path, monkeypatch) -> None:
    audio_path = tmp_path / "song.flac"
    audio_path.write_bytes(b"audio")

    class FakeAudio(dict):
        tags = None
        saved = False

        def add_tags(self):
            self.tags = {}

        def save(self):
            self.saved = True

    audio = FakeAudio(album=["Old"])
    monkeypatch.setattr(tagging_module, "MutagenFile", lambda _path, easy: audio)

    result = AudioTaggingService().write_tags(
        audio_path,
        AudioTagData(title="Song", artist="Artist", album="Album", genre=["Rock"]),
    )

    assert result is True
    assert audio["title"] == ["Song"]
    assert audio["genre"] == ["Rock"]
    assert audio.saved is True
