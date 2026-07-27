from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.v1.routes.media import stream_library_track
from app.models import Base, LibraryTrack
from app.storage.paths import StoragePaths


def test_stream_library_track_resolves_downloaded_file(tmp_path, monkeypatch) -> None:
    paths = StoragePaths(tmp_path)
    paths.ensure()
    monkeypatch.setattr("app.services.file_paths.storage_manager", SimpleNamespace(paths=paths))
    audio_file = paths.music / "Artist" / "song.mp3"
    audio_file.parent.mkdir(parents=True)
    audio_file.write_bytes(b"audio")
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    with Session() as session:
        track = LibraryTrack(
            external_id="video-id",
            title="Song",
            position=0,
            is_downloaded=True,
            file_path="Artist/song.mp3",
        )
        session.add(track)
        session.commit()

        response = stream_library_track(session, track.id)

    assert response.path == str(audio_file)
