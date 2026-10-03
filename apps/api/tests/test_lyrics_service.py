from __future__ import annotations

import asyncio
import json
import shutil
from pathlib import Path

import pytest
from mutagen import File as MutagenFile

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import app.services.lyrics_service as lyrics_module
from app.models import Album, Artist, Base, Song
from app.services.lyrics_service import LyricsService


def make_session_factory():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def create_song(session, *, external_id: str = "abcdefghijk", lyrics: str | None = None) -> Song:
    artist = Artist(name=f"Artist {external_id}")
    session.add(artist)
    session.flush()
    album = Album(title=f"Album {external_id}", artist_id=artist.id)
    session.add(album)
    session.flush()
    song = Song(
        title=f"Song {external_id}",
        artist_id=artist.id,
        album_id=album.id,
        duration_seconds=180,
        source_url=f"https://music.youtube.com/watch?v={external_id}",
        lyrics=lyrics,
    )
    session.add(song)
    session.commit()
    return song


def test_get_save_and_cache_local_lyrics(music_directory) -> None:
    Session = make_session_factory()
    with Session() as session:
        service = LyricsService(session)
        assert service.get_song_lyrics(999).status == "missing"
        assert service.save_lyrics(999, "missing") is False

        song = create_song(session, lyrics="Manual lyrics")
        first = service.get_song_lyrics(song.id)
        second = service.get_song_lyrics(song.id)
        saved = service.save_song_lyrics(song.id, "Updated lyrics")

        assert first.lyrics == "Manual lyrics"
        assert first.source == "manual"
        assert second.status == "cached"
        assert saved is not None and saved.lyrics == "Updated lyrics"
        assert session.get(Song, song.id).lyrics == "Updated lyrics"


AUDIO_FIXTURES = Path(__file__).parent / "fixtures" / "audio"


@pytest.mark.parametrize("extension", ["mp3", "m4a", "flac", "opus"])
def test_saved_lyrics_round_trip_without_corrupting_the_container(music_directory, extension) -> None:
    Session = make_session_factory()
    audio_file = music_directory / f"tagged.{extension}"
    shutil.copyfile(AUDIO_FIXTURES / f"silence.{extension}", audio_file)
    container = type(MutagenFile(audio_file)).__name__
    with Session() as session:
        song = create_song(session)
        song.relative_path = f"music/tagged.{extension}"
        session.commit()
        service = LyricsService(session)

        assert service.save_lyrics(song.id, "[00:01.00]Embedded line")
        # Reading back from the file proves both the write and the
        # per-container read path, independent of the database copy.
        song.lyrics = None
        session.commit()

        assert type(MutagenFile(audio_file)).__name__ == container
        assert service.extract_lyrics(song.id) == "[00:01.00]Embedded line"


def test_extract_lyrics_handles_missing_files(music_directory) -> None:
    Session = make_session_factory()
    with Session() as session:
        song = create_song(session)
        song.relative_path = "music/missing.mp3"
        session.commit()
        service = LyricsService(session)
        assert service.extract_lyrics(song.id) is None
        song.relative_path = None
        session.commit()
        assert service.extract_lyrics(song.id) is None


def test_fetch_local_lyrics_prefers_timestamped_provider_then_lrclib(music_directory, monkeypatch) -> None:
    Session = make_session_factory()
    with Session() as session:
        service = LyricsService(session)
        timestamped = create_song(session, external_id="abcdefghijk")

        async def provider_lyrics(_video_id: str):
            return "[00:01.00]Provider line"

        monkeypatch.setattr(lyrics_module.ytmusic_service, "lyrics", provider_lyrics)
        monkeypatch.setattr(service, "extract_lyrics", lambda _song_id: None)
        result = asyncio.run(service.fetch_and_save_lyrics(timestamped.id, force=True, embed=False))
        cached = asyncio.run(service.fetch_and_save_lyrics(timestamped.id, embed=False))
        assert result.source == "ytmusic" and result.format == "lrc"
        assert cached.lyrics == result.lyrics

        plain = create_song(session, external_id="lmnopqrstuv")

        async def no_provider_lyrics(_video_id: str):
            return None

        monkeypatch.setattr(lyrics_module.ytmusic_service, "lyrics", no_provider_lyrics)
        monkeypatch.setattr(service, "_fetch_lrclib", lambda **_kwargs: "Plain LRCLIB lyrics")
        fallback = asyncio.run(service.fetch_and_save_lyrics(plain.id, force=True, embed=False))
        assert fallback.source == "lrclib"
        assert fallback.lyrics == "Plain LRCLIB lyrics"


def test_fetch_lyrics_maps_timeout_offline_and_provider_failures(music_directory, monkeypatch) -> None:
    Session = make_session_factory()
    with Session() as session:
        service = LyricsService(session)
        monkeypatch.setattr(service, "extract_lyrics", lambda _song_id: None)
        errors = (
            ("timeoutvid1", TimeoutError(), "timeout"),
            ("offlinevid1", OSError("offline"), "offline"),
            ("providervid", RuntimeError("secret upstream detail"), "provider_error"),
        )
        for video_id, error, expected in errors:
            song = create_song(session, external_id=video_id)

            async def fail(_video_id: str, current=error):
                raise current

            monkeypatch.setattr(lyrics_module.ytmusic_service, "lyrics", fail)
            result = asyncio.run(service.fetch_and_save_lyrics(song.id, force=True, embed=False))
            assert result.status == expected
            assert result.error_code == expected


def test_fetch_online_lyrics_and_negative_result_are_cached(music_directory, monkeypatch) -> None:
    Session = make_session_factory()
    with Session() as session:
        service = LyricsService(session)

        async def plain_provider(_video_id: str):
            return "Provider lyrics without timestamps"

        monkeypatch.setattr(lyrics_module.ytmusic_service, "lyrics", plain_provider)
        monkeypatch.setattr(service, "_fetch_lrclib", lambda **_kwargs: None)
        provider = asyncio.run(service.fetch_online_lyrics(video_id="online-one", force=True))
        assert provider.source == "ytmusic"

        async def empty_provider(_video_id: str):
            return None

        monkeypatch.setattr(lyrics_module.ytmusic_service, "lyrics", empty_provider)
        missing = asyncio.run(service.fetch_online_lyrics(video_id="online-two", force=True))
        cached = asyncio.run(service.fetch_online_lyrics(video_id="online-two"))
        assert missing.status == cached.status == "not_found"


class JsonResponse:
    def __init__(self, payload: dict) -> None:
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self) -> bytes:
        return json.dumps(self.payload).encode("utf-8")


def test_lrclib_request_and_url_helpers(music_directory, monkeypatch) -> None:
    Session = make_session_factory()
    requests = []
    monkeypatch.setattr(
        lyrics_module,
        "urlopen",
        lambda request, timeout: requests.append((request, timeout)) or JsonResponse({"syncedLyrics": "[00:01.00]Line"}),
    )
    with Session() as session:
        service = LyricsService(session)
        result = service._fetch_lrclib(
            title="Song (Official Video)",
            artist="Artist",
            album="Album",
            duration=180,
        )
        assert result == "[00:01.00]Line"
        assert requests[0][1] == 15
        assert "track_name=Song" in requests[0][0].full_url
        assert service._fetch_lrclib(title=None, artist="Artist", album=None, duration=None) is None
        assert service._video_id_from_url("https://youtu.be/abcdefghijk") == "abcdefghijk"
        assert service._video_id_from_url("https://youtube.com/watch?v=lmnopqrstuv") == "lmnopqrstuv"
        assert service._video_id_from_url("abcdefghijk") == "abcdefghijk"
        assert service._video_id_from_url(None) is None
        assert service._clean_title("Song (Official Video)") == "Song"
        assert service._has_lrc_timestamps("[01:02.34]Line") is True
        assert service._has_lrc_timestamps("Plain line") is False
