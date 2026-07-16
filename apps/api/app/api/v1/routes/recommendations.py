"""
Recommendations API routes.

Provides personalized music recommendations based on:
- Listening history
- Favorite artists and albums
- Play patterns
- Time of day
"""

from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.deps import get_catalog_service, get_recommendation_service
from app.schemas.music import RecommendationRequest, RecommendationResponse
from app.services.catalog import CatalogService
from app.services.recommendations import RecommendationService

router = APIRouter()


@router.post("", response_model=RecommendationResponse)
def get_recommendations(
    request: RecommendationRequest,
    catalog: Annotated[CatalogService, Depends(get_catalog_service)],
    recommendations: Annotated[RecommendationService, Depends(get_recommendation_service)],
) -> RecommendationResponse:
    """
    Get personalized recommendations.
    
    Supports multiple recommendation strategies:
    - mixed: Combination of all strategies (default)
    - similar_artists: Songs from artists you like
    - popular: Popular songs you haven't played much
    - discovery: Hidden gems you might like
    - time_based: Songs based on listening patterns at this time
    
    Supports both song and album recommendations.
    """
    return catalog.get_recommendations(request, recommendations)
