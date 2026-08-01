from app.main import app


REMOVED_PATHS = {
    "/api/v1/search",
    "/api/v1/library",
    "/api/v1/library/summary",
    "/api/v1/library/albums/online/{external_id}",
    "/api/v1/library/albums/save-online",
    "/api/v1/downloads/placeholder",
    "/api/v1/queue",
    "/api/v1/queue/placeholder",
    "/api/v1/recommendations",
    "/api/v1/discovery/home",
    "/api/v1/advanced-search/albums",
    "/api/v1/advanced-search/artists",
    "/api/v1/advanced-search/filter-options",
    "/api/v1/metadata/search",
    "/api/v1/metadata/providers",
    "/api/v1/metadata/albums/{album_id}/enrich",
    "/api/v1/playlists/{playlist_id}/reorder",
    "/api/v1/songs/favorites",
    "/api/v1/songs/recently-played",
    "/api/v1/songs/most-played",
    "/api/v1/songs/recently-added",
    "/api/v1/songs/random",
    "/api/v1/artists/favorites",
    "/api/v1/artists/random",
    "/api/v1/albums/favorites",
    "/api/v1/albums/recently-added",
    "/api/v1/albums/random",
}


def test_removed_legacy_surfaces_are_absent_from_openapi() -> None:
    paths = set(app.openapi()["paths"])

    assert not (REMOVED_PATHS & paths)
