"""YouTube Music-backed discovery service."""

from app.schemas.ytmusic import OnlineMusicItem
from app.services.ytmusic_service import ytmusic_service


class DiscoveryService:
    """Service for discovering albums from YouTube Music searches."""

    async def get_trending(self, limit: int = 20) -> list[dict]:
        return await self._album_search("trending albums", limit=limit)

    async def get_new_releases(self, limit: int = 20) -> list[dict]:
        return await self._album_search("new album releases", limit=limit)

    async def get_featured_albums(self, limit: int = 10) -> list[dict]:
        return await self._album_search("featured albums", limit=limit)

    async def get_popular_by_genre(self, genre: str, limit: int = 20) -> list[dict]:
        return await self._album_search(f"{genre} albums", limit=limit)

    async def get_genres(self) -> list[str]:
        return ["pop", "rock", "hip-hop", "electronic", "r&b", "indie", "jazz", "classical"]

    async def _album_search(self, query: str, *, limit: int) -> list[dict]:
        response = await ytmusic_service.search(query, filter_name="albums")
        return [self._item_to_dict(item) for item in response.items if item.kind == "album"][:limit]

    def _item_to_dict(self, item: OnlineMusicItem) -> dict:
        return {
            "id": item.browse_id or item.id,
            "title": item.title,
            "artist": item.artists[0].name if item.artists else item.subtitle or "Unknown Artist",
            "year": None,
            "artwork_url": item.thumbnail,
            "genres": [],
            "type": "Album",
        }
