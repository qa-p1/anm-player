from app.schemas.music import SearchResponse
from app.services.ytmusic_service import ytmusic_service


class SearchService:
    def __init__(self) -> None:
        pass

    async def search(self, query: str) -> SearchResponse:
        if not query.strip():
            return SearchResponse(query=query, results=[])
        return await ytmusic_service.legacy_search(query.strip())
