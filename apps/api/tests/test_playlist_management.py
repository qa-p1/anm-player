from collections.abc import Iterator
from dataclasses import dataclass

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_catalog_service
from app.main import app
from app.models import (
    Artist,
    Base,
    LibraryTrack,
    Playlist,
    PlaylistLibraryTrack,
    PlaylistSong,
    Song,
)
from app.repositories.music import (
    AlbumRepository,
    ArtistRepository,
    FavoriteRepository,
    HistoryRepository,
    PlaylistRepository,
    SongRepository,
)
from app.schemas.music import PlaylistDuplicateRequest
from app.services.catalog import CatalogService


@dataclass
class PlaylistApi:
    client: TestClient
    session: Session
    playlist_id: int
    other_playlist_id: int
    first_song_id: int
    second_song_id: int
    library_track_id: int


def catalog_service(session: Session) -> CatalogService:
    return CatalogService(
        SongRepository(session),
        ArtistRepository(session),
        AlbumRepository(session),
        PlaylistRepository(session),
        FavoriteRepository(session),
        HistoryRepository(session),
    )


@pytest.fixture
def playlist_api() -> Iterator[PlaylistApi]:
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = SessionLocal()

    artist = Artist(name="Test Artist")
    artwork_path = f"/api/v1/media/artwork/downloads/{'a' * 64}.jpg"
    playlist = Playlist(name="Road trip", description="Original description", artwork_path=artwork_path)
    other_playlist = Playlist(name="Already used")
    first_song = Song(title="First song", artist=artist, duration_seconds=101)
    second_song = Song(title="Second song", artist=artist, duration_seconds=202)
    library_track = LibraryTrack(
        source="youtube",
        external_id="video-id",
        title="Online song",
        artist_name="Online Artist",
        duration_seconds=303,
        position=0,
    )
    session.add_all([playlist, other_playlist, first_song, second_song, library_track])
    session.flush()
    session.add_all(
        [
            PlaylistSong(playlist_id=playlist.id, song_id=first_song.id, position=0),
            PlaylistSong(playlist_id=playlist.id, song_id=second_song.id, position=1),
            PlaylistLibraryTrack(playlist_id=playlist.id, track_id=library_track.id, position=2),
        ]
    )
    session.commit()

    app.dependency_overrides[get_catalog_service] = lambda: catalog_service(session)
    client = TestClient(app, base_url="http://localhost")
    yield PlaylistApi(
        client=client,
        session=session,
        playlist_id=playlist.id,
        other_playlist_id=other_playlist.id,
        first_song_id=first_song.id,
        second_song_id=second_song.id,
        library_track_id=library_track.id,
    )
    client.close()
    app.dependency_overrides.pop(get_catalog_service, None)
    session.close()
    engine.dispose()


def item_keys(payload: dict) -> list[tuple[str, int]]:
    return [
        (
            item["item_type"],
            item["song"]["id"] if item["item_type"] == "song" else item["track"]["id"],
        )
        for item in payload["items"]
    ]


def persisted_item_order(api: PlaylistApi, playlist_id: int | None = None) -> list[tuple[str, int, int]]:
    target_id = playlist_id or api.playlist_id
    api.session.expire_all()
    song_links = api.session.scalars(
        select(PlaylistSong).where(PlaylistSong.playlist_id == target_id)
    ).all()
    track_links = api.session.scalars(
        select(PlaylistLibraryTrack).where(PlaylistLibraryTrack.playlist_id == target_id)
    ).all()
    items = [
        *(("song", link.song_id, link.position) for link in song_links),
        *(("library_track", link.track_id, link.position) for link in track_links),
    ]
    return sorted(items, key=lambda item: item[2])


def test_patch_playlist_updates_only_supplied_fields_and_can_clear_description(playlist_api: PlaylistApi) -> None:
    response = playlist_api.client.patch(
        f"/api/v1/playlists/{playlist_api.playlist_id}",
        json={"name": "  Renamed mix  "},
    )

    assert response.status_code == 200
    assert response.json()["name"] == "Renamed mix"
    assert response.json()["description"] == "Original description"

    response = playlist_api.client.patch(
        f"/api/v1/playlists/{playlist_api.playlist_id}",
        json={"description": None},
    )

    assert response.status_code == 200
    assert response.json()["description"] is None
    playlist_api.session.expire_all()
    assert playlist_api.session.get(Playlist, playlist_api.playlist_id).description is None


@pytest.mark.parametrize("payload", [{}, {"name": None}, {"name": "   "}])
def test_patch_playlist_rejects_empty_or_invalid_updates(playlist_api: PlaylistApi, payload: dict) -> None:
    response = playlist_api.client.patch(
        f"/api/v1/playlists/{playlist_api.playlist_id}",
        json=payload,
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_patch_playlist_reports_name_conflicts_without_changing_the_playlist(playlist_api: PlaylistApi) -> None:
    response = playlist_api.client.patch(
        f"/api/v1/playlists/{playlist_api.playlist_id}",
        json={"name": "Already used"},
    )

    assert response.status_code == 409
    playlist_api.session.expire_all()
    assert playlist_api.session.get(Playlist, playlist_api.playlist_id).name == "Road trip"


def test_reorder_accepts_the_complete_mixed_item_set_and_swaps_same_table_positions(playlist_api: PlaylistApi) -> None:
    requested = [
        {"item_type": "song", "item_id": playlist_api.second_song_id},
        {"item_type": "library_track", "item_id": playlist_api.library_track_id},
        {"item_type": "song", "item_id": playlist_api.first_song_id},
    ]

    response = playlist_api.client.put(
        f"/api/v1/playlists/{playlist_api.playlist_id}/reorder",
        json={"items": requested},
    )

    assert response.status_code == 200
    assert item_keys(response.json()) == [
        ("song", playlist_api.second_song_id),
        ("library_track", playlist_api.library_track_id),
        ("song", playlist_api.first_song_id),
    ]
    assert persisted_item_order(playlist_api) == [
        ("song", playlist_api.second_song_id, 0),
        ("library_track", playlist_api.library_track_id, 1),
        ("song", playlist_api.first_song_id, 2),
    ]


def test_reorder_rejects_stale_incomplete_or_duplicate_snapshots_atomically(playlist_api: PlaylistApi) -> None:
    original = persisted_item_order(playlist_api)
    incomplete = [
        {"item_type": "song", "item_id": playlist_api.second_song_id},
        {"item_type": "library_track", "item_id": playlist_api.library_track_id},
    ]

    response = playlist_api.client.put(
        f"/api/v1/playlists/{playlist_api.playlist_id}/reorder",
        json={"items": incomplete},
    )

    assert response.status_code == 409
    assert response.json()["error"]["details"]["missing_items"] == [
        {"item_type": "song", "item_id": playlist_api.first_song_id}
    ]
    assert persisted_item_order(playlist_api) == original

    response = playlist_api.client.put(
        f"/api/v1/playlists/{playlist_api.playlist_id}/reorder",
        json={"items": [incomplete[0], incomplete[0], *incomplete[1:]]},
    )

    assert response.status_code == 422
    assert persisted_item_order(playlist_api) == original


def test_empty_playlist_accepts_an_empty_complete_order(playlist_api: PlaylistApi) -> None:
    response = playlist_api.client.put(
        f"/api/v1/playlists/{playlist_api.other_playlist_id}/reorder",
        json={"items": []},
    )

    assert response.status_code == 200
    assert response.json()["items"] == []


def test_duplicate_copies_metadata_and_normalizes_mixed_item_positions(playlist_api: PlaylistApi) -> None:
    response = playlist_api.client.post(f"/api/v1/playlists/{playlist_api.playlist_id}/duplicate")

    assert response.status_code == 201
    duplicate = response.json()
    assert duplicate["name"] == "Road trip copy"
    assert duplicate["description"] == "Original description"
    assert duplicate["artwork_path"] == f"/api/v1/media/artwork/downloads/{'a' * 64}.jpg"
    assert item_keys(duplicate) == [
        ("song", playlist_api.first_song_id),
        ("song", playlist_api.second_song_id),
        ("library_track", playlist_api.library_track_id),
    ]
    assert [position for _, _, position in persisted_item_order(playlist_api, duplicate["id"])] == [0, 1, 2]

    second_response = playlist_api.client.post(f"/api/v1/playlists/{playlist_api.playlist_id}/duplicate")
    assert second_response.status_code == 201
    assert second_response.json()["name"] == "Road trip copy 2"


def test_duplicate_with_an_explicit_existing_name_is_atomic(playlist_api: PlaylistApi) -> None:
    before = playlist_api.session.scalar(select(Playlist).where(Playlist.name == "Already used"))

    response = playlist_api.client.post(
        f"/api/v1/playlists/{playlist_api.playlist_id}/duplicate",
        json={"name": "Already used"},
    )

    assert response.status_code == 409
    playlist_api.session.expire_all()
    matches = playlist_api.session.scalars(select(Playlist).where(Playlist.name == "Already used")).all()
    assert matches == [before]


def test_catalog_service_generates_bounded_unique_copy_names(playlist_api: PlaylistApi) -> None:
    playlist = playlist_api.session.get(Playlist, playlist_api.playlist_id)
    playlist.name = "x" * 255
    playlist_api.session.commit()
    service = catalog_service(playlist_api.session)

    first = service.duplicate_playlist(playlist_api.playlist_id, PlaylistDuplicateRequest())
    second = service.duplicate_playlist(playlist_api.playlist_id, PlaylistDuplicateRequest())

    assert len(first.name) == 255
    assert first.name.endswith(" copy")
    assert len(second.name) <= 255
    assert second.name.endswith(" copy 2")
    assert first.name != second.name


def test_bulk_remove_validates_every_item_then_compacts_remaining_positions(playlist_api: PlaylistApi) -> None:
    original = persisted_item_order(playlist_api)
    response = playlist_api.client.post(
        f"/api/v1/playlists/{playlist_api.playlist_id}/items/bulk-remove",
        json={
            "items": [
                {"item_type": "song", "item_id": playlist_api.first_song_id},
                {"item_type": "library_track", "item_id": 2_147_483_647},
            ]
        },
    )

    assert response.status_code == 404
    assert persisted_item_order(playlist_api) == original

    response = playlist_api.client.post(
        f"/api/v1/playlists/{playlist_api.playlist_id}/items/bulk-remove",
        json={
            "items": [
                {"item_type": "song", "item_id": playlist_api.first_song_id},
                {"item_type": "library_track", "item_id": playlist_api.library_track_id},
            ]
        },
    )

    assert response.status_code == 200
    assert item_keys(response.json()) == [("song", playlist_api.second_song_id)]
    assert persisted_item_order(playlist_api) == [("song", playlist_api.second_song_id, 0)]


def test_both_clear_endpoints_remove_local_and_library_items(playlist_api: PlaylistApi) -> None:
    duplicate = playlist_api.client.post(f"/api/v1/playlists/{playlist_api.playlist_id}/duplicate").json()

    response = playlist_api.client.delete(f"/api/v1/playlists/{playlist_api.playlist_id}/items")
    assert response.status_code == 200
    assert response.json()["items"] == []
    assert persisted_item_order(playlist_api) == []

    response = playlist_api.client.post(f"/api/v1/playlists/{duplicate['id']}/clear")
    assert response.status_code == 200
    assert response.json()["items"] == []
    assert persisted_item_order(playlist_api, duplicate["id"]) == []


def test_m3u8_export_is_ordered_utf8_and_safe_for_headers_and_directives(playlist_api: PlaylistApi) -> None:
    playlist = playlist_api.session.get(Playlist, playlist_api.playlist_id)
    artist = playlist_api.session.scalar(select(Artist).where(Artist.name == "Test Artist"))
    song = playlist_api.session.get(Song, playlist_api.first_song_id)
    track = playlist_api.session.get(LibraryTrack, playlist_api.library_track_id)
    playlist.name = 'Mix "name"\r\nX-Injected: true / ..'
    artist.name = "Artist\r\n#EXT-X-INJECTED"
    song.title = "First\n#EXT-X-TRACK"
    track.external_id = "video\n#EXT-X-URL"
    playlist_api.session.commit()

    response = playlist_api.client.get(f"/api/v1/playlists/{playlist_api.playlist_id}/export.m3u8")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/vnd.apple.mpegurl")
    assert response.headers["content-disposition"].startswith(
        f'attachment; filename="playlist-{playlist_api.playlist_id}-'
    )
    assert "\r" not in response.headers["content-disposition"]
    assert "\n" not in response.headers["content-disposition"]
    assert response.text.startswith("#EXTM3U\n#PLAYLIST:")
    assert "\n#EXT-X-INJECTED" not in response.text
    assert "\n#EXT-X-TRACK" not in response.text
    assert "\n#EXT-X-URL" not in response.text
    assert f"/api/v1/media/songs/{playlist_api.first_song_id}/stream" in response.text
    assert "/api/v1/ytmusic/stream/video%0A%23EXT-X-URL" in response.text
    assert response.text.index(f"/api/v1/media/songs/{playlist_api.first_song_id}/stream") < response.text.index(
        "/api/v1/ytmusic/stream/video%0A%23EXT-X-URL"
    )


def test_adding_several_songs_in_one_request_appends_them_after_mixed_items(playlist_api: PlaylistApi) -> None:
    response = playlist_api.client.post(
        f"/api/v1/playlists/{playlist_api.other_playlist_id}/songs",
        json={"song_ids": [playlist_api.second_song_id, playlist_api.first_song_id]},
    )
    assert response.status_code == 200, response.text
    assert item_keys(response.json()) == [
        ("song", playlist_api.second_song_id),
        ("song", playlist_api.first_song_id),
    ]
    assert [item["position"] for item in response.json()["items"]] == [0, 1]

    # A mixed playlist already uses positions 0-2 across both link tables.
    playlist_api.client.delete(f"/api/v1/playlists/{playlist_api.playlist_id}/songs/{playlist_api.second_song_id}")
    extra = Song(title="Third song")
    playlist_api.session.add(extra)
    playlist_api.session.commit()
    # The fixture shares one session across requests; production uses one per request.
    playlist_api.session.expire_all()
    response = playlist_api.client.post(
        f"/api/v1/playlists/{playlist_api.playlist_id}/songs",
        json={"song_ids": [playlist_api.second_song_id, extra.id]},
    )
    assert response.status_code == 200, response.text
    positions = [item["position"] for item in response.json()["items"]]
    assert len(positions) == len(set(positions)) == 4
