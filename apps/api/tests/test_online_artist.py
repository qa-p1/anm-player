import asyncio

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import app.services.library_albums as library_albums
from app.models import Base, LibraryAlbum, LibraryArtist
from app.schemas.ytmusic import OnlineMusicItem
from app.services.library_albums import LibraryAlbumService
from app.services.ytmusic_service.presentation import artist_name_from_raw, artist_release_shelves


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)()


def shelf(title: str, ids: list[str]) -> dict:
    return {"musicCarouselShelfRenderer": {
        "header": {"musicCarouselShelfBasicHeaderRenderer": {"title": {"runs": [{"text": title}]}}},
        "contents": [{"musicTwoRowItemRenderer": {"title": {"runs": [{"text": i}]}}} for i in ids],
    }}


def test_artist_name_comes_from_the_immersive_header_and_releases_skip_featured_rows() -> None:
    raw = {
        "header": {"musicImmersiveHeaderRenderer": {"title": {"runs": [{"text": "Daft Punk"}]}}},
        "contents": [shelf("Albums", ["a"]), shelf("Singles & EPs", ["s"]), shelf("Featured on", ["f"]), shelf("Playlists by Daft Punk", ["p"])],
    }
    assert artist_name_from_raw(raw) == "Daft Punk"
    titles = [s["header"]["musicCarouselShelfBasicHeaderRenderer"]["title"]["runs"][0]["text"] for s in artist_release_shelves(raw)]
    assert titles == ["Albums", "Singles & EPs"]


def album(browse_id: str, title: str, year: str) -> OnlineMusicItem:
    return OnlineMusicItem(kind="album", id=browse_id, browse_id=browse_id, title=title, subtitle=year, url=f"https://music.youtube.com/browse/{browse_id}")


def test_placeholder_name_is_repaired_and_unsaved_releases_are_listed(monkeypatch) -> None:
    with make_session() as session:
        session.add(LibraryArtist(source="youtube", external_id="UCx", name="Artist"))
        session.add(LibraryAlbum(public_id="MPREsaved", external_id="MPREsaved", title="Discovery", artist_external_id="UCx", artist_name="Daft Punk"))
        session.commit()

        async def online(_id):
            return {"name": "Daft Punk", "thumbnail_url": None, "tracks": [], "albums": [album("MPREsaved", "Discovery", "2001"), album("MPREnew", "Homework", "Album • 1997")]}

        monkeypatch.setattr(library_albums.ytmusic_service, "artist", online)
        result = asyncio.run(LibraryAlbumService(session).get_online_artist("UCx"))
        assert result.name == "Daft Punk"
        assert session.query(LibraryArtist).one().name == "Daft Punk"
        assert [a.title for a in result.albums] == ["Discovery", "Homework"]
        homework = result.albums[1]
        assert (homework.canonical_url, homework.year, homework.is_in_library) == ("/albums/MPREnew", 1997, False)


def test_artist_page_opens_from_saved_data_when_offline(monkeypatch) -> None:
    with make_session() as session:
        session.add(LibraryArtist(source="youtube", external_id="UCy", name="Artist"))
        session.commit()

        async def offline(_id):
            raise OSError("no network")

        monkeypatch.setattr(library_albums.ytmusic_service, "artist", offline)
        result = asyncio.run(LibraryAlbumService(session).get_online_artist("UCy"))
        assert result.name == "Unknown artist"
        assert result.albums == [] and result.top_tracks == []


def test_artist_releases_come_from_the_full_discography_page(monkeypatch) -> None:
    from app.services.ytmusic_service import YouTubeMusicService
    import app.services.ytmusic_service.service as service_module
    from types import SimpleNamespace

    first_row = shelf("Albums", ["first"])
    first_row["musicCarouselShelfRenderer"]["header"]["musicCarouselShelfBasicHeaderRenderer"]["title"]["runs"][0]["navigationEndpoint"] = {"browseEndpoint": {"browseId": "MPADUCx", "params": "abc%3D"}}
    no_link = shelf("Singles & EPs", ["single"])
    artist_page = {"header": {"musicImmersiveHeaderRenderer": {"title": {"runs": [{"text": "Band"}]}}}, "contents": [first_row, no_link]}
    full_page = {"contents": [{"musicTwoRowItemRenderer": {"title": {"runs": [{"text": name}]}}} for name in ("first", "second", "third")]}
    calls = []

    class Session:
        def web_remix_client(self):
            return None

        def browse(self, *, client, browse_id, params=None):
            calls.append((browse_id, params))
            return full_page if browse_id == "MPADUCx" else artist_page

    service = YouTubeMusicService()
    service.client = SimpleNamespace(session=Session())
    monkeypatch.setattr(service_module, "item_from_renderer", lambda value: SimpleNamespace(kind="album", id=value["musicTwoRowItemRenderer"]["title"]["runs"][0]["text"], title=value["musicTwoRowItemRenderer"]["title"]["runs"][0]["text"]))
    monkeypatch.setattr(service_module, "item_to_schema", lambda item: album(item.id, item.title, "2020"))
    data = service._artist_sync("UCx")
    assert [release.id for release in data["albums"]] == ["first", "second", "third", "single"]
    assert ("MPADUCx", "abc%3D") in calls
