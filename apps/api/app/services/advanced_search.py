"""
Advanced Search & Filtering Service

Case-insensitive token matching, filters, and deterministic sorting for local music.
"""

from dataclasses import dataclass
from typing import Literal

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session, joinedload

from app.models import Album, Artist, Song


@dataclass
class SearchFilters:
    """Filters for advanced library search."""

    query: str | None = None

    artist_ids: list[int] | None = None
    album_ids: list[int] | None = None
    year_min: int | None = None
    year_max: int | None = None
    duration_min: int | None = None  # in seconds
    duration_max: int | None = None  # in seconds

    has_artwork: bool | None = None

    sort_by: Literal[
        "relevance", "title", "artist", "album", "year", "duration", "date_added"
    ] = "relevance"
    sort_order: Literal["asc", "desc"] = "asc"

    limit: int = 50
    offset: int = 0


class AdvancedSearchService:
    """Service for advanced search and filtering of local library."""

    def __init__(self, session: Session) -> None:
        self.session = session

    def search_songs(self, filters: SearchFilters) -> list[Song]:
        """
        Search downloaded songs with token matching and optional filters.

        Features:
        - Case-insensitive partial matching for every search term
        - Filter by artist, album, year, duration
        - Filter by artwork availability
        - Multiple sort options
        """
        statement = (
            select(Song)
            .options(joinedload(Song.artist), joinedload(Song.album))
            .where(Song.is_downloaded.is_(True))
        )
        has_query = bool(filters.query and filters.query.strip())
        needs_artist_join = has_query or filters.sort_by == "artist"
        needs_album_join = (
            has_query
            or filters.year_min is not None
            or filters.year_max is not None
            or filters.has_artwork is not None
            or filters.sort_by in {"album", "year"}
        )
        if needs_artist_join:
            statement = statement.join(
                Artist, Song.artist_id == Artist.id, isouter=True
            )
        if needs_album_join:
            statement = statement.join(Album, Song.album_id == Album.id, isouter=True)

        conditions = []

        if filters.query and filters.query.strip():
            search_terms = filters.query.strip().lower().split()
            fuzzy_conditions = []

            for term in search_terms:
                pattern = f"%{term}%"
                fuzzy_conditions.append(
                    or_(
                        Song.title.ilike(pattern),
                        Artist.name.ilike(pattern),
                        Album.title.ilike(pattern),
                    )
                )

            if fuzzy_conditions:
                conditions.append(and_(*fuzzy_conditions))

        if filters.artist_ids:
            conditions.append(Song.artist_id.in_(filters.artist_ids))

        if filters.album_ids:
            conditions.append(Song.album_id.in_(filters.album_ids))

        if filters.year_min is not None or filters.year_max is not None:
            if filters.year_min is not None:
                conditions.append(Album.year >= filters.year_min)
            if filters.year_max is not None:
                conditions.append(Album.year <= filters.year_max)

        if filters.duration_min is not None:
            conditions.append(Song.duration_seconds >= filters.duration_min)
        if filters.duration_max is not None:
            conditions.append(Song.duration_seconds <= filters.duration_max)

        if filters.has_artwork is not None:
            if filters.has_artwork:
                conditions.append(
                    or_(
                        Song.artwork_path.isnot(None),
                        Album.artwork_path.isnot(None),
                    )
                )
            else:
                conditions.append(
                    and_(
                        Song.artwork_path.is_(None),
                        Album.artwork_path.is_(None),
                    )
                )

        if conditions:
            statement = statement.where(and_(*conditions))

        statement = self._apply_sorting(statement, filters)

        statement = statement.offset(filters.offset).limit(filters.limit)

        return list(self.session.scalars(statement).unique())

    def _apply_sorting(self, statement, filters: SearchFilters):
        """Apply sorting to song query."""
        if filters.sort_by == "title":
            statement = statement.order_by(
                Song.title.asc() if filters.sort_order == "asc" else Song.title.desc()
            )
        elif filters.sort_by == "artist":
            statement = statement.order_by(
                Artist.name.asc() if filters.sort_order == "asc" else Artist.name.desc()
            )
        elif filters.sort_by == "album":
            statement = statement.order_by(
                Album.title.asc() if filters.sort_order == "asc" else Album.title.desc()
            )
        elif filters.sort_by == "year":
            statement = statement.order_by(
                Album.year.asc().nullslast()
                if filters.sort_order == "asc"
                else Album.year.desc().nullsfirst()
            )
        elif filters.sort_by == "duration":
            statement = statement.order_by(
                Song.duration_seconds.asc().nullslast()
                if filters.sort_order == "asc"
                else Song.duration_seconds.desc().nullsfirst()
            )
        elif filters.sort_by == "date_added":
            statement = statement.order_by(
                Song.created_at.asc()
                if filters.sort_order == "asc"
                else Song.created_at.desc()
            )
        else:  # relevance or default
            if filters.query:
                statement = statement.order_by(Song.title)
            else:
                statement = statement.order_by(Song.created_at.desc())

        return statement.order_by(Song.id)
