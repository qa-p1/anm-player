"""
Recommendation Engine Service

Provides personalized music recommendations based on:
- Listening history
- Favorite artists
- Favorite albums
- Play patterns
- Time of day
"""

from datetime import datetime
from typing import Literal

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload

from app.models import Album, Artist, Song
from app.models.history import Favorite, History


class RecommendationService:
    """Service for generating personalized music recommendations."""

    def __init__(self, session: Session) -> None:
        self.session = session

    def get_song_recommendations(
        self,
        *,
        limit: int = 20,
        strategy: Literal["mixed", "similar_artists", "popular", "discovery"] = "mixed",
    ) -> list[Song]:
        """
        Get personalized song recommendations.
        
        Args:
            limit: Number of recommendations to return
            strategy: Recommendation strategy to use
                - mixed: Combination of all strategies
                - similar_artists: Songs from artists you like
                - popular: Popular songs you haven't played much
                - discovery: Hidden gems you might like
        
        Returns:
            List of recommended songs
        """
        if strategy == "similar_artists":
            return self._recommend_from_favorite_artists(limit)
        elif strategy == "popular":
            return self._recommend_popular_unplayed(limit)
        elif strategy == "discovery":
            return self._recommend_hidden_gems(limit)
        else:
            # Mixed strategy: combine different approaches
            recommendations = []
            
            # 50% from favorite artists
            recommendations.extend(self._recommend_from_favorite_artists(limit // 2))
            
            # 30% popular unplayed
            recommendations.extend(self._recommend_popular_unplayed(limit // 3))
            
            # 20% hidden gems
            recommendations.extend(self._recommend_hidden_gems(limit // 5))
            
            # Remove duplicates and limit
            seen_ids = set()
            unique_recommendations = []
            for song in recommendations:
                if song.id not in seen_ids:
                    seen_ids.add(song.id)
                    unique_recommendations.append(song)
            
            return unique_recommendations[:limit]

    def get_album_recommendations(self, *, limit: int = 10) -> list[Album]:
        """
        Get personalized album recommendations.
        
        Recommends albums from:
        - Artists you've favorited
        - Artists whose songs you've played frequently
        - Similar artists (future enhancement)
        
        Returns:
            List of recommended albums
        """
        # Get favorite artists
        favorite_artist_ids = self._get_favorite_artist_ids()
        
        # Get frequently played artist IDs
        frequently_played_artist_ids = self._get_frequently_played_artist_ids(limit=10)
        
        # Combine and get albums from these artists
        artist_ids = list(set(favorite_artist_ids + frequently_played_artist_ids))
        
        if not artist_ids:
            # Fallback: return recently added albums
            statement = (
                select(Album)
                .options(joinedload(Album.artist))
                .order_by(Album.created_at.desc())
                .limit(limit)
            )
            return list(self.session.scalars(statement).unique())
        
        # Get albums from these artists that user hasn't listened to much
        played_album_ids = self._get_played_album_ids()
        
        statement = (
            select(Album)
            .options(joinedload(Album.artist))
            .where(
                Album.artist_id.in_(artist_ids),
                Album.id.notin_(played_album_ids) if played_album_ids else True,
            )
            .order_by(func.random())
            .limit(limit)
        )
        
        return list(self.session.scalars(statement).unique())

    def get_time_based_recommendations(self, *, limit: int = 20) -> list[Song]:
        """
        Get recommendations based on time of day.
        
        Analyzes what types of music you typically listen to at this time
        and recommends similar tracks.
        
        Returns:
            List of recommended songs
        """
        current_hour = datetime.now().hour
        
        # Get songs you've played at similar times
        # Look for songs played within +/- 2 hours of current time
        hour_range_start = (current_hour - 2) % 24
        hour_range_end = (current_hour + 2) % 24
        
        # Get artist IDs from songs played at this time
        subquery = (
            select(Song.artist_id)
            .join(History, History.song_id == Song.id)
            .where(
                func.extract("hour", History.played_at).between(hour_range_start, hour_range_end)
            )
            .group_by(Song.artist_id)
            .order_by(func.count(History.id).desc())
            .limit(5)
            .subquery()
        )
        
        # Get other songs from these artists
        played_song_ids = self._get_played_song_ids()
        
        statement = (
            select(Song)
            .options(joinedload(Song.artist), joinedload(Song.album))
            .where(
                Song.artist_id.in_(select(subquery)),
                Song.id.notin_(played_song_ids) if played_song_ids else True,
                Song.is_downloaded == True,
            )
            .order_by(func.random())
            .limit(limit)
        )
        
        recommendations = list(self.session.scalars(statement).unique())
        
        # Fallback if no time-based data
        if not recommendations:
            return self._recommend_from_favorite_artists(limit)
        
        return recommendations

    def _recommend_from_favorite_artists(self, limit: int) -> list[Song]:
        """Recommend songs from artists the user has favorited."""
        # Get favorite artist IDs
        favorite_artist_ids = self._get_favorite_artist_ids()
        
        if not favorite_artist_ids:
            # Fallback: recommend from most played artists
            return self._recommend_from_most_played_artists(limit)
        
        # Get songs from favorite artists that haven't been played much
        played_song_ids = self._get_played_song_ids()
        
        statement = (
            select(Song)
            .options(joinedload(Song.artist), joinedload(Song.album))
            .where(
                Song.artist_id.in_(favorite_artist_ids),
                Song.id.notin_(played_song_ids) if played_song_ids else True,
                Song.is_downloaded == True,
            )
            .order_by(func.random())
            .limit(limit)
        )
        
        return list(self.session.scalars(statement).unique())

    def _recommend_from_most_played_artists(self, limit: int) -> list[Song]:
        """Recommend songs from artists the user plays frequently."""
        artist_ids = self._get_frequently_played_artist_ids(limit=5)
        
        if not artist_ids:
            # Ultimate fallback: random songs
            return self._get_random_songs(limit)
        
        played_song_ids = self._get_played_song_ids()
        
        statement = (
            select(Song)
            .options(joinedload(Song.artist), joinedload(Song.album))
            .where(
                Song.artist_id.in_(artist_ids),
                Song.id.notin_(played_song_ids) if played_song_ids else True,
                Song.is_downloaded == True,
            )
            .order_by(func.random())
            .limit(limit)
        )
        
        return list(self.session.scalars(statement).unique())

    def _recommend_popular_unplayed(self, limit: int) -> list[Song]:
        """Recommend popular songs the user hasn't played much."""
        # Get songs ordered by play count
        play_count_subquery = (
            select(
                History.song_id,
                func.count(History.id).label("play_count"),
            )
            .where(History.song_id.isnot(None))
            .group_by(History.song_id)
            .subquery()
        )
        
        # Get user's played songs
        user_played_ids = self._get_played_song_ids()
        
        statement = (
            select(Song)
            .options(joinedload(Song.artist), joinedload(Song.album))
            .join(play_count_subquery, Song.id == play_count_subquery.c.song_id, isouter=True)
            .where(
                Song.id.notin_(user_played_ids) if user_played_ids else True,
                Song.is_downloaded == True,
            )
            .order_by(play_count_subquery.c.play_count.desc().nullslast())
            .limit(limit)
        )
        
        return list(self.session.scalars(statement).unique())

    def _recommend_hidden_gems(self, limit: int) -> list[Song]:
        """
        Recommend 'hidden gems' - songs that are rarely played but from
        artists or albums the user likes.
        """
        favorite_artist_ids = self._get_favorite_artist_ids()
        favorite_album_ids = self._get_favorite_album_ids()
        
        if not favorite_artist_ids and not favorite_album_ids:
            # Fallback: recommend least played songs
            return self._get_least_played_songs(limit)
        
        # Get songs from favorite artists/albums that have low play counts
        play_count_subquery = (
            select(
                History.song_id,
                func.count(History.id).label("play_count"),
            )
            .where(History.song_id.isnot(None))
            .group_by(History.song_id)
            .subquery()
        )
        
        conditions = []
        if favorite_artist_ids:
            conditions.append(Song.artist_id.in_(favorite_artist_ids))
        if favorite_album_ids:
            conditions.append(Song.album_id.in_(favorite_album_ids))
        
        statement = (
            select(Song)
            .options(joinedload(Song.artist), joinedload(Song.album))
            .join(play_count_subquery, Song.id == play_count_subquery.c.song_id, isouter=True)
            .where(
                or_(*conditions) if conditions else True,
                Song.is_downloaded == True,
            )
            .order_by(
                play_count_subquery.c.play_count.asc().nullsfirst(),
                func.random(),
            )
            .limit(limit)
        )
        
        return list(self.session.scalars(statement).unique())

    def _get_favorite_artist_ids(self) -> list[int]:
        """Get IDs of favorited artists."""
        statement = select(Favorite.artist_id).where(Favorite.artist_id.isnot(None))
        return list(self.session.scalars(statement))

    def _get_favorite_album_ids(self) -> list[int]:
        """Get IDs of favorited albums."""
        statement = select(Favorite.album_id).where(Favorite.album_id.isnot(None))
        return list(self.session.scalars(statement))

    def _get_played_song_ids(self) -> list[int]:
        """Get IDs of songs the user has played."""
        statement = (
            select(History.song_id)
            .where(History.song_id.isnot(None))
            .distinct()
        )
        return list(self.session.scalars(statement))

    def _get_played_album_ids(self) -> list[int]:
        """Get IDs of albums the user has played songs from."""
        statement = (
            select(Song.album_id)
            .join(History, History.song_id == Song.id)
            .where(Song.album_id.isnot(None))
            .distinct()
        )
        return list(self.session.scalars(statement))

    def _get_frequently_played_artist_ids(self, limit: int = 10) -> list[int]:
        """Get IDs of most frequently played artists."""
        statement = (
            select(Song.artist_id)
            .join(History, History.song_id == Song.id)
            .where(Song.artist_id.isnot(None))
            .group_by(Song.artist_id)
            .order_by(func.count(History.id).desc())
            .limit(limit)
        )
        return list(self.session.scalars(statement))

    def _get_random_songs(self, limit: int) -> list[Song]:
        """Get random songs as ultimate fallback."""
        statement = (
            select(Song)
            .options(joinedload(Song.artist), joinedload(Song.album))
            .where(Song.is_downloaded == True)
            .order_by(func.random())
            .limit(limit)
        )
        return list(self.session.scalars(statement).unique())

    def _get_least_played_songs(self, limit: int) -> list[Song]:
        """Get least played songs."""
        play_count_subquery = (
            select(
                History.song_id,
                func.count(History.id).label("play_count"),
            )
            .where(History.song_id.isnot(None))
            .group_by(History.song_id)
            .subquery()
        )
        
        statement = (
            select(Song)
            .options(joinedload(Song.artist), joinedload(Song.album))
            .join(play_count_subquery, Song.id == play_count_subquery.c.song_id, isouter=True)
            .where(Song.is_downloaded == True)
            .order_by(
                play_count_subquery.c.play_count.asc().nullsfirst(),
                func.random(),
            )
            .limit(limit)
        )
        
        return list(self.session.scalars(statement).unique())
