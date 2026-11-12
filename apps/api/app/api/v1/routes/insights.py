from datetime import UTC
from typing import Annotated
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Query

from app.api.deps import DbSession
from app.schemas.insights import ListeningInsightsResponse
from app.services.listening_insights import ListeningInsightsService


router = APIRouter()
InsightDays = Annotated[int, Query(ge=0, le=3650, description="0 returns all-time insights.")]


TimeZoneName = Annotated[str | None, Query(max_length=64, description="IANA time zone, e.g. Asia/Kolkata. Defaults to UTC.")]


@router.get("", response_model=ListeningInsightsResponse, summary="Get listening insights")
def listening_insights(session: DbSession, days: InsightDays = 30, tz: TimeZoneName = None) -> ListeningInsightsResponse:
    try:
        zone = ZoneInfo(tz) if tz else UTC
    except (ZoneInfoNotFoundError, ValueError):
        zone = UTC  # An unknown zone falls back instead of failing the whole page.
    return ListeningInsightsService(session).get(days=days, zone=zone)
