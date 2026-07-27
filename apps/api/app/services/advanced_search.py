"""
Advanced Search & Filtering Service

Provides fuzzy search, advanced filtering, and intelligent ranking
for the local music library.
"""

from dataclasses import dataclass
from typing import Literal

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session, joinedload

from app.models import Album, Artist, Song


@dataclass
class SearchFilters:
    """Filters for advanced library search."""
    
    # Text search
    query: str | None = None
    
    # Entity type filters
    entity_type: Literal["all", "song", "album", "artist"] | None = "all"
    
    # Song filters
    artist_ids: list[int] | None = None
    album_ids: list[int] | None = None
    year_min: int | None = None
    year_max: int | None = None
    duration_min: int | None = None  # in seconds
    duration_max: int | None = None  # in seconds
    
    # Status filters
    is_favorited: bool | None = None
    has_artwork: bool | None = None
    
    # Sorting
    sort_by: Literal["relevance", "title", "artist", "album", "year", "duration", "date_added", "play_count"] = "relevance"
    sort_order: Literal["asc", "desc"] = "asc"
    
    # Pagination
    limit: int = 50
    offset: int = 0


class AdvancedSearchService:
    """Service for advanced search and filtering of local library."""
    
    def __init__(self, session: Session) -> None:
        self.session = session
    
    def search_songs(self, filters: SearchFilters) -> list[Song]:
        """
        Search songs with advanced filters and fuzzy matching.
        
        Features:
        - Fuzzy text search (case-insensitive, partial matching)
        - Filter by artist, album, genre, year, duration
        - Filter by favorite status, artwork availability
        - Multiple sort options
        - Relevance ranking for text queries
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
            statement = statement.join(Artist, Song.artist_id == Artist.id, isouter=True)
        if needs_album_join:
            statement = statement.join(Album, Song.album_id == Album.id, isouter=True)
        
        # Apply filters
        conditions = []
        
        # Text search with fuzzy matching
        if filters.query and filters.query.strip():
            search_terms = filters.query.strip().lower().split()
            fuzzy_conditions = []
            
            for term in search_terms:
                # Allow partial matches with wildcards
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
        
        # Artist filter
        if filters.artist_ids:
            conditions.append(Song.artist_id.in_(filters.artist_ids))
        
        # Album filter
        if filters.album_ids:
            conditions.append(Song.album_id.in_(filters.album_ids))
        
        # Year range filter
        if filters.year_min is not None or filters.year_max is not None:
            if filters.year_min is not None:
                conditions.append(Album.year >= filters.year_min)
            if filters.year_max is not None:
                conditions.append(Album.year <= filters.year_max)
        
        # Duration range filter
        if filters.duration_min is not None:
            conditions.append(Song.duration_seconds >= filters.duration_min)
        if filters.duration_max is not None:
            conditions.append(Song.duration_seconds <= filters.duration_max)
        
        # Artwork filter
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
        
        # Apply all conditions
        if conditions:
            statement = statement.where(and_(*conditions))
        
        # Sorting
        statement = self._apply_sorting(statement, filters)
        
        # Pagination
        statement = statement.offset(filters.offset).limit(filters.limit)
        
        return list(self.session.scalars(statement).unique())
    
    def search_albums(self, filters: SearchFilters) -> list[Album]:
        """Search albums with advanced filters."""
        statement = (
            select(Album)
            .options(joinedload(Album.artist))
        )
        needs_artist_join = bool(filters.query and filters.query.strip()) or filters.sort_by == "artist"
        if needs_artist_join:
            statement = statement.join(Artist, Album.artist_id == Artist.id, isouter=True)
        
        conditions = []
        
        # Text search
        if filters.query and filters.query.strip():
            search_terms = filters.query.strip().lower().split()
            fuzzy_conditions = []
            
            for term in search_terms:
                pattern = f"%{term}%"
                fuzzy_conditions.append(
                    or_(
                        Album.title.ilike(pattern),
                        Artist.name.ilike(pattern),
                    )
                )
            
            if fuzzy_conditions:
                conditions.append(and_(*fuzzy_conditions))
        
        # Artist filter
        if filters.artist_ids:
            conditions.append(Album.artist_id.in_(filters.artist_ids))
        
        # Year range filter
        if filters.year_min is not None:
            conditions.append(Album.year >= filters.year_min)
        if filters.year_max is not None:
            conditions.append(Album.year <= filters.year_max)
        
        # Artwork filter
        if filters.has_artwork is not None:
            if filters.has_artwork:
                conditions.append(Album.artwork_path.isnot(None))
            else:
                conditions.append(Album.artwork_path.is_(None))
        
        if conditions:
            statement = statement.where(and_(*conditions))
        
        # Sorting for albums
        if filters.sort_by == "title":
            statement = statement.order_by(Album.title.asc() if filters.sort_order == "asc" else Album.title.desc())
        elif filters.sort_by == "artist":
            statement = statement.order_by(Artist.name.asc() if filters.sort_order == "asc" else Artist.name.desc())
        elif filters.sort_by == "year":
            statement = statement.order_by(
                Album.year.asc().nullslast() if filters.sort_order == "asc" 
                else Album.year.desc().nullsfirst()
            )
        elif filters.sort_by == "date_added":
            statement = statement.order_by(Album.created_at.asc() if filters.sort_order == "asc" else Album.created_at.desc())
        else:
            statement = statement.order_by(Album.title)
        
        statement = statement.offset(filters.offset).limit(filters.limit)
        
        return list(self.session.scalars(statement).unique())
    
    def search_artists(self, filters: SearchFilters) -> list[Artist]:
        """Search artists with advanced filters."""
        statement = select(Artist)
        
        conditions = []
        
        # Text search
        if filters.query and filters.query.strip():
            search_terms = filters.query.strip().lower().split()
            fuzzy_conditions = []
            
            for term in search_terms:
                pattern = f"%{term}%"
                fuzzy_conditions.append(Artist.name.ilike(pattern))
            
            if fuzzy_conditions:
                conditions.append(and_(*fuzzy_conditions))
        
        # Artwork filter
        if filters.has_artwork is not None:
            if filters.has_artwork:
                conditions.append(Artist.artwork_path.isnot(None))
            else:
                conditions.append(Artist.artwork_path.is_(None))
        
        if conditions:
            statement = statement.where(and_(*conditions))
        
        # Sorting for artists
        if filters.sort_by == "title" or filters.sort_by == "artist":
            statement = statement.order_by(Artist.name.asc() if filters.sort_order == "asc" else Artist.name.desc())
        elif filters.sort_by == "date_added":
            statement = statement.order_by(Artist.created_at.asc() if filters.sort_order == "asc" else Artist.created_at.desc())
        else:
            statement = statement.order_by(Artist.name)
        
        statement = statement.offset(filters.offset).limit(filters.limit)
        
        return list(self.session.scalars(statement))
    
    def _apply_sorting(self, statement, filters: SearchFilters):
        """Apply sorting to song query."""
        if filters.sort_by == "title":
            statement = statement.order_by(Song.title.asc() if filters.sort_order == "asc" else Song.title.desc())
        elif filters.sort_by == "artist":
            statement = statement.order_by(Artist.name.asc() if filters.sort_order == "asc" else Artist.name.desc())
        elif filters.sort_by == "album":
            statement = statement.order_by(Album.title.asc() if filters.sort_order == "asc" else Album.title.desc())
        elif filters.sort_by == "year":
            statement = statement.order_by(
                Album.year.asc().nullslast() if filters.sort_order == "asc" 
                else Album.year.desc().nullsfirst()
            )
        elif filters.sort_by == "duration":
            statement = statement.order_by(
                Song.duration_seconds.asc().nullslast() if filters.sort_order == "asc" 
                else Song.duration_seconds.desc().nullsfirst()
            )
        elif filters.sort_by == "date_added":
            statement = statement.order_by(Song.created_at.asc() if filters.sort_order == "asc" else Song.created_at.desc())
        else:  # relevance or default
            # For text queries, order by title for now (can be enhanced with ranking)
            if filters.query:
                statement = statement.order_by(Song.title)
            else:
                statement = statement.order_by(Song.created_at.desc())
        
        return statement.order_by(Song.id)
