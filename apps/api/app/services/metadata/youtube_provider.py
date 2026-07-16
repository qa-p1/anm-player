from app.services.metadata.base import MetadataProvider, MetadataResult
from app.services.ytmusic_service import ytmusic_service


class YouTubeMusicMetadataProvider(MetadataProvider):
    @property
    def name(self) -> str:
        return "youtube_music"

    async def search(self, *, title=None, artist=None, album=None, duration_ms=None, isrc=None, limit=5) -> list[MetadataResult]:
        query = " ".join(value for value in (title, artist, album) if value).strip()
        if not query:
            return []
        response = await ytmusic_service.search(query, filter_name="songs")
        results: list[MetadataResult] = []
        for item in response.items[:limit]:
            item_artist = item.artists[0].name if item.artists else item.subtitle
            confidence = 0.65
            if title and item.title.casefold() == title.casefold():
                confidence += 0.2
            if artist and item_artist and item_artist.casefold() == artist.casefold():
                confidence += 0.15
            results.append(
                MetadataResult(
                    title=item.title,
                    artist=item_artist,
                    album=item.album.name if item.album else album,
                    duration_ms=item.duration_seconds * 1000 if item.duration_seconds else None,
                    provider="youtube_music",
                    provider_track_id=item.id,
                    provider_release_id=item.album.id if item.album else None,
                    artwork_url=item.thumbnail,
                    confidence=min(confidence, 1.0),
                )
            )
        return results

    async def get_by_id(self, identifier: str) -> MetadataResult | None:
        return None

    async def get_artwork(self, identifier: str) -> str | None:
        try:
            return (await ytmusic_service.album(identifier)).artwork_url
        except Exception:
            return None
