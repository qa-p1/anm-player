from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from app.models import Favorite, LibraryTrack, Song


def saved_streaming_tracks() -> Select[tuple[LibraryTrack]]:
    """Songs kept in the library (saved with an album or liked) that aren't downloaded."""
    liked = select(Favorite.library_track_id).where(Favorite.library_track_id.is_not(None))
    return select(LibraryTrack).where(
        LibraryTrack.source == "youtube",
        LibraryTrack.song_id.is_(None),
        (LibraryTrack.is_in_library.is_(True)) | LibraryTrack.id.in_(liked),
    )


def library_song_count(session: Session) -> int:
    """Every song in the library: downloaded files plus saved songs that stream."""
    downloaded = int(session.scalar(select(func.count(Song.id)).where(Song.is_downloaded.is_(True))) or 0)
    streaming = int(session.scalar(select(func.count()).select_from(saved_streaming_tracks().subquery())) or 0)
    return downloaded + streaming
