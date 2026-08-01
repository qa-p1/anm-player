from pathlib import Path

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.models import Album, Artist, Base, Song
from app.services.library_scanner import LibraryScannerService


class MetadataScanner(LibraryScannerService):
    def __init__(self, session, metadata: dict) -> None:
        super().__init__(session)
        self.metadata = metadata

    def _extract_metadata(self, file_path: Path) -> dict:
        return self.metadata


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)()


def test_scan_resolves_downloaded_relative_paths_against_music_directory(music_directory) -> None:
    audio_file = music_directory / "Artist" / "Album" / "song.mp3"
    audio_file.parent.mkdir(parents=True)
    audio_file.write_bytes(b"audio")

    with make_session() as session:
        song = Song(title="Song", file_path=str(audio_file.relative_to(music_directory)), is_downloaded=True)
        session.add(song)
        session.commit()

        result = MetadataScanner(session, {"title": "Song"}).scan_directory(music_directory)
        songs = session.scalars(select(Song)).all()

    assert result.added == 0
    assert result.removed == 0
    assert result.updated == 0
    assert len(songs) == 1
    assert songs[0].is_downloaded is True


def test_scan_checks_all_existing_records_for_missing_files(music_directory) -> None:

    with make_session() as session:
        session.add_all(
            [Song(title=f"Song {index}", file_path=f"missing-{index}.mp3", is_downloaded=True) for index in range(51)]
        )
        session.commit()

        result = LibraryScannerService(session).scan_directory(music_directory)
        downloaded = session.scalars(select(Song).where(Song.is_downloaded.is_(True))).all()

    assert result.removed == 51
    assert downloaded == []


def test_scan_applies_changed_artist_and_album_tags(music_directory) -> None:
    audio_file = music_directory / "song.mp3"
    audio_file.write_bytes(b"audio")

    with make_session() as session:
        old_artist = Artist(name="Old Artist")
        session.add(old_artist)
        session.flush()
        old_album = Album(title="Old Album", artist_id=old_artist.id)
        session.add(old_album)
        session.flush()
        song = Song(
            title="Old Title",
            artist_id=old_artist.id,
            album_id=old_album.id,
            file_path="song.mp3",
            is_downloaded=True,
        )
        session.add(song)
        session.commit()

        result = MetadataScanner(
            session,
            {"title": "New Title", "artist": "New Artist", "album": "New Album", "year": 2026},
        ).scan_directory(music_directory)
        session.refresh(song)

        assert song.artist is not None and song.artist.name == "New Artist"
        assert song.album is not None and song.album.title == "New Album"
        assert song.album.year == 2026
        assert result.updated == 1


def test_scan_missing_directory_raises_instead_of_reporting_success(tmp_path) -> None:
    with make_session() as session:
        scanner = LibraryScannerService(session)

        try:
            scanner.scan_directory(tmp_path / "missing")
        except FileNotFoundError:
            pass
        else:
            raise AssertionError("missing scan directory should fail")
