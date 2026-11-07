"""Exercise HTTP wiring without substituting the services being composed."""

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database.session import get_session
from app.main import app
from app.models import Album, Artist, Base, LibraryAlbum, LibraryTrack, Song
from app.services.metadata.service import MetadataEnrichmentService


def test_catalog_playlist_and_library_routes_share_consistent_presentations(
    music_directory, monkeypatch
):
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    (music_directory / "song.mp3").write_bytes(b"audio")

    async def missing_song(_self, _song_id, _provider):
        return None

    monkeypatch.setattr(MetadataEnrichmentService, "enrich_song", missing_song)
    with Session() as session:
        artist = Artist(name="Artist")
        session.add(artist)
        session.flush()
        album = Album(title="Album", artist_id=artist.id)
        session.add(album)
        session.flush()
        song = Song(
            title="Composition song",
            artist_id=artist.id,
            album_id=album.id,
            file_path="song.mp3",
            is_downloaded=True,
        )
        saved = LibraryAlbum(
            public_id="saved-album", external_id="saved-album", title="Saved album"
        )
        session.add_all([song, saved])
        session.flush()
        session.add(
            LibraryTrack(
                album_id=saved.id,
                external_id="saved-track",
                title="Saved song",
                position=0,
                duration_seconds=60,
            )
        )
        session.commit()
        previous = app.dependency_overrides.copy()
        app.dependency_overrides[get_session] = lambda: session
        try:
            client = TestClient(app, base_url="http://localhost")
            assert client.get("/api/v1/health/version").status_code == 200
            assert client.get("/api/v1/settings").status_code == 200
            assert client.get("/api/v1/downloads").json() == []
            songs = client.get("/api/v1/songs").json()
            assert songs[0]["title"] == "Composition song"
            assert (
                client.get(
                    "/api/v1/advanced-search/songs", params={"q": "Composition"}
                ).json()[0]["id"]
                == song.id
            )
            created = client.post(
                "/api/v1/playlists", json={"name": "Integration playlist"}
            )
            assert created.status_code == 201
            playlist_id = created.json()["id"]
            detail = client.post(
                f"/api/v1/playlists/{playlist_id}/songs", json={"song_ids": [song.id]}
            ).json()
            assert detail["songs"][0] == songs[0]
            assert detail["items"][0]["song"]["id"] == song.id
            assert client.post(
                "/api/v1/favorites/toggle",
                json={"entity_type": "song", "entity_id": song.id},
            ).json()["is_favorited"]
            assert client.get("/api/v1/favorites").json()["songs"][0]["is_favorited"]
            statuses = client.post(
                "/api/v1/library/albums/status",
                json={"external_ids": [saved.external_id]},
            ).json()
            assert statuses["statuses"][0]["in_library"]
            assert (
                client.get("/api/v1/library/albums").json()[0]["title"] == "Saved album"
            )
            assert (
                client.post("/api/v1/metadata/songs/999/enrich", json={}).status_code
                == 404
            )
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(previous)
