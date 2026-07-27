import asyncio

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models import Album, Artist, Base, Song
from app.schemas.ytmusic import OnlineAlbum, OnlineArtist, OnlineMusicItem, OnlineSearchResponse
from app.services.metadata.base import MetadataResult
from app.services.metadata.service import MetadataEnrichmentService
from app.services.metadata.youtube_provider import YouTubeMusicMetadataProvider
import app.services.metadata.youtube_provider as youtube_provider_module


def test_metadata_service_registers_youtube_music_provider() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)

    with Session() as session:
        service = MetadataEnrichmentService(session)

    assert [provider.name for provider in service.providers] == ["youtube_music"]


class FakeProvider:
    def __init__(self, name: str, results=None, *, artwork: str | None = None, error: Exception | None = None) -> None:
        self.name = name
        self.results = results or []
        self.artwork = artwork
        self.error = error
        self.closed = False

    async def search(self, **_kwargs):
        if self.error:
            raise self.error
        return self.results

    async def get_artwork(self, _identifier: str):
        if self.error:
            raise self.error
        return self.artwork

    async def close(self):
        self.closed = True


class FakeArtworkCache:
    def __init__(self, path) -> None:
        self.path = path

    async def download_and_cache(self, _url):
        cached = self.path / "medium" / "art.jpg"
        cached.parent.mkdir(parents=True, exist_ok=True)
        cached.write_bytes(b"image")
        return cached

    def public_path(self, cached_path):
        return f"/media/artwork/cache/{cached_path.name}"


def make_session_factory():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def test_enrich_song_applies_best_metadata_artwork_and_tags(music_directory, monkeypatch) -> None:
    Session = make_session_factory()
    file_path = music_directory / "song.mp3"
    file_path.write_bytes(b"audio")
    with Session() as session:
        original_artist = Artist(name="Original Artist")
        session.add(original_artist)
        session.flush()
        song = Song(
            title="Original",
            artist_id=original_artist.id,
            duration_seconds=200,
            relative_path="music/song.mp3",
            is_downloaded=True,
        )
        session.add(song)
        session.commit()
        service = MetadataEnrichmentService(session)
        low = MetadataResult(title="Low", confidence=0.2)
        best = MetadataResult(
            title="Enriched",
            artist="New Artist",
            album="New Album",
            album_artist="New Artist",
            track_number=2,
            disc_number=1,
            year=2026,
            genre=["Alternative"],
            isrc="TEST123",
            provider_release_id="release-id",
            confidence=0.95,
        )
        service.providers = [FakeProvider("fake", [low, best], artwork="https://i.ytimg.com/art.jpg")]
        service.artwork_cache = FakeArtworkCache(music_directory.parent / "cache" / "artwork")
        tags = []
        monkeypatch.setattr(service.tagging, "write_tags", lambda path, data: tags.append((path, data)) or True)

        enriched = asyncio.run(service.enrich_song(song.id))

        assert enriched.title == "Enriched"
        assert enriched.artist.name == "New Artist"
        assert enriched.album.title == "New Album"
        assert enriched.album.year == 2026
        assert enriched.album.artwork_url == "https://i.ytimg.com/art.jpg"
        assert enriched.album.artwork_path == "/media/artwork/cache/art.jpg"
        assert enriched.track_number == 2 and enriched.disc_number == 1
        assert tags[0][0] == file_path
        assert tags[0][1].isrc == "TEST123"


def test_enrich_song_missing_provider_failures_and_search_sorting(music_directory) -> None:
    Session = make_session_factory()
    with Session() as session:
        service = MetadataEnrichmentService(session)
        assert asyncio.run(service.enrich_song(999)) is None
        artist = Artist(name="Artist")
        session.add(artist)
        session.flush()
        song = Song(title="Song", artist_id=artist.id)
        session.add(song)
        session.commit()

        service.providers = [FakeProvider("broken", error=RuntimeError("offline"))]
        assert asyncio.run(service.enrich_song(song.id)) is song
        assert asyncio.run(service.enrich_song(song.id, provider_name="missing")) is song

        service.providers = [
            FakeProvider("broken", error=RuntimeError("offline")),
            FakeProvider(
                "working",
                [MetadataResult(title="Lower", confidence=0.3), MetadataResult(title="Higher", confidence=0.9)],
            ),
        ]
        results = asyncio.run(service.search_metadata(title="Song", limit=1))
        assert [result.title for result in results] == ["Higher"]
        assert asyncio.run(service.search_metadata(title="Song", provider_name="missing")) == []


def test_enrich_album_only_downloaded_songs_and_close_providers(music_directory, monkeypatch) -> None:
    Session = make_session_factory()
    with Session() as session:
        artist = Artist(name="Artist")
        session.add(artist)
        session.flush()
        album = Album(title="Album", artist_id=artist.id)
        session.add(album)
        session.flush()
        downloaded = Song(title="Downloaded", artist_id=artist.id, album_id=album.id, is_downloaded=True)
        online = Song(title="Online", artist_id=artist.id, album_id=album.id, is_downloaded=False)
        session.add_all([downloaded, online])
        session.commit()
        service = MetadataEnrichmentService(session)
        calls = []

        async def enrich(song_id: int):
            calls.append(song_id)
            return session.get(Song, song_id)

        monkeypatch.setattr(service, "enrich_song", enrich)
        assert asyncio.run(service.enrich_album(999)) is None
        assert asyncio.run(service.enrich_album(album.id)) is album
        assert calls == [downloaded.id]

        providers = [FakeProvider("one"), FakeProvider("two")]
        service.providers = providers
        asyncio.run(service.close())
        assert all(provider.closed for provider in providers)


def test_artist_album_reuse_and_artwork_provider_fallback(music_directory) -> None:
    Session = make_session_factory()
    with Session() as session:
        service = MetadataEnrichmentService(session)
        artist = service._get_or_create_artist("Artist")
        assert service._get_or_create_artist("Artist") is artist
        album = service._get_or_create_album("Album", artist.id)
        assert service._get_or_create_album("Album", artist.id) is album

        service.providers = [
            FakeProvider("broken", error=RuntimeError("offline")),
            FakeProvider("working", artwork="https://i.ytimg.com/art.jpg"),
        ]
        service.artwork_cache = FakeArtworkCache(music_directory.parent / "cache" / "artwork")
        asyncio.run(service._fetch_artwork(album, "release"))
        assert album.artwork_url == "https://i.ytimg.com/art.jpg"


def test_youtube_metadata_provider_maps_search_and_artwork(monkeypatch) -> None:
    provider = YouTubeMusicMetadataProvider()
    calls = []

    async def search(query: str, *, filter_name: str):
        calls.append((query, filter_name))
        return OnlineSearchResponse(
            query=query,
            filter="songs",
            items=[
                OnlineMusicItem(
                    kind="song",
                    id="video-id",
                    title="Song",
                    artists=[OnlineArtist(id="artist-id", name="Artist")],
                    album=OnlineAlbum(id="album-id", name="Album"),
                    thumbnail="https://i.ytimg.com/art.jpg",
                    duration_seconds=123,
                    playable=True,
                    url="https://music.youtube.com/watch?v=video-id",
                )
            ],
        )

    class AlbumResponse:
        artwork_url = "https://i.ytimg.com/album.jpg"

    async def album(_identifier: str):
        return AlbumResponse()

    monkeypatch.setattr(youtube_provider_module.ytmusic_service, "search", search)
    monkeypatch.setattr(youtube_provider_module.ytmusic_service, "album", album)
    results = asyncio.run(provider.search(title="Song", artist="Artist", album="Album", limit=1))

    assert calls == [("Song Artist Album", "songs")]
    assert results[0].provider_track_id == "video-id"
    assert results[0].provider_release_id == "album-id"
    assert results[0].duration_ms == 123000
    assert results[0].confidence == 1.0
    assert asyncio.run(provider.search()) == []
    assert asyncio.run(provider.get_by_id("video-id")) is None
    assert asyncio.run(provider.get_artwork("album-id")) == "https://i.ytimg.com/album.jpg"

    async def failed_album(_identifier: str):
        raise RuntimeError("offline")

    monkeypatch.setattr(youtube_provider_module.ytmusic_service, "album", failed_album)
    assert asyncio.run(provider.get_artwork("album-id")) is None
