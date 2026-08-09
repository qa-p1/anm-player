from typing import Annotated

from fastapi import APIRouter, Query

from app.api.deps import DbSession
from app.schemas.insights import ListeningInsightsResponse
from app.services.listening_insights import ListeningInsightsService


router = APIRouter()
InsightDays = Annotated[int, Query(ge=0, le=3650, description="0 returns all-time insights.")]


@router.get("", response_model=ListeningInsightsResponse, summary="Get listening insights")
def listening_insights(session: DbSession, days: InsightDays = 30) -> ListeningInsightsResponse:
    return ListeningInsightsService(session).get(days=days)
