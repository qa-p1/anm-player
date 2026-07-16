import logging
import time
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.api.deps import get_search_service
from app.schemas.music import SearchResponse
from app.services import SearchService

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("", response_model=SearchResponse, summary="Search YouTube music")
async def search(
    service: Annotated[SearchService, Depends(get_search_service)],
    q: Annotated[str, Query(min_length=1, max_length=200, description="Search query.")],
) -> SearchResponse:
    request_start = time.time()
    logger.info(f"[SEARCH-ROUTE] Received search request for: '{q}'")
    
    try:
        result = await service.search(q)
        request_duration = time.time() - request_start
        logger.info(f"[SEARCH-ROUTE] Request completed in {request_duration:.2f}s")
        return result
    except Exception as exc:
        request_duration = time.time() - request_start
        logger.error(f"[SEARCH-ROUTE] Request failed after {request_duration:.2f}s: {exc}")
        raise
