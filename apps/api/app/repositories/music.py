from sqlalchemy import func, or_, select, text
from sqlalchemy import update
from sqlalchemy.orm import Session, joinedload
from sqlalchemy.sql import expression

from app.models import Album, AlbumDownloadItem, Artist, DownloadJob, Playlist, PlaylistLibraryTrack, QueueItem, Song
from app.models.history import Favorite, History
from app.models.playlist import PlaylistSong
from app.repositories.base import Repository
from app.core.enums import DownloadStage, DownloadStatus
from urllib.parse import parse_qs, urlparse


class SongRepository(Repository[Song]):
    def __init__(self, session: Session) -> None:
        super().__init__(session, Song)

    def find_by_source_url(self, source_url: str) -> Song | None:
        statement = select(Song).where(Song.source_url == source_url)
        return self.session.scalars(statement).first()

    def find_by_file_path(self, file_path: str) -> Song | None:
        legacy = file_path.removeprefix("music/")
        statement = select(Song).where(
            Song.relative_path.in_({file_path, legacy, file_path.replace("/", "\\"), legacy.replace("/", "\\")})
        )
        return self.session.scalars(statement).first()

    def list_with_details(self, *, limit: int = 50, offset: int = 0) -> list[Song]:
        statement = (
            select(Song)
            .options(joinedload(Song.artist), joinedload(Song.album))
            .where(Song.is_downloaded == True)
            .order_by(Song.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
        return list(self.session.scalars(statement).unique())

    def search_local(self, query: str, *, limit: int = 50) -> list[Song]:
        search_pattern = f"%{query}%"
        statement = (
            select(Song)
            .options(joinedload(Song.artist), joinedload(Song.album))
            .join(Artist, Song.artist_id == Artist.id, isouter=True)
            .join(Album, Song.album_id == Album.id, isouter=True)
            .where(
                Song.is_downloaded == True,
                or_(
                    Song.title.ilike(search_pattern),
                    Artist.name.ilike(search_pattern),
                    Album.title.ilike(search_pattern),
                ),
            )
            .order_by(Song.title)
            .limit(limit)
        )
        return list(self.session.scalars(statement).unique())

    def get_recently_added(self, *, limit: int = 50) -> list[Song]:
        statement = (
            select(Song)
            .options(joinedload(Song.artist), joinedload(Song.album))
            .where(Song.is_downloaded == True)
            .order_by(Song.created_at.desc())
            .limit(limit)
        )
        return list(self.session.scalars(statement).unique())

    def get_random(self, *, limit: int = 10) -> list[Song]:
        statement = (
            select(Song)
            .options(joinedload(Song.artist), joinedload(Song.album))
            .where(Song.is_downloaded == True)
            .order_by(func.random())
            .limit(limit)
        )
        return list(self.session.scalars(statement).unique())


class ArtistRepository(Repository[Artist]):
    def __init__(self, session: Session) -> None:
        super().__init__(session, Artist)

    def get_or_create(self, name: str) -> Artist:
        statement = select(Artist).where(Artist.name == name)
        artist = self.session.scalars(statement).first()
        if artist:
            return artist
        return self.add(Artist(name=name))

    def get_with_details(self, artist_id: int) -> Artist | None:
        statement = (
            select(Artist)
            .options(joinedload(Artist.albums), joinedload(Artist.songs))
            .where(Artist.id == artist_id)
        )
        return self.session.scalars(statement).unique().first()

    def list_with_counts(self, *, limit: int = 50, offset: int = 0) -> list[tuple[Artist, int, int]]:
        statement = (
            select(
                Artist,
                func.count(func.distinct(Song.id)).label("song_count"),
                func.count(func.distinct(Album.id)).label("album_count"),
            )
            .join(Song, Artist.id == Song.artist_id, isouter=True)
            .join(Album, Artist.id == Album.artist_id, isouter=True)
            .where(Song.is_downloaded == True)
            .group_by(Artist.id)
            .order_by(Artist.name)
            .offset(offset)
            .limit(limit)
        )
        return list(self.session.execute(statement))

    def get_random_with_counts(self, *, limit: int = 5) -> list[tuple[Artist, int, int]]:
        statement = (
            select(
                Artist,
                func.count(func.distinct(Song.id)).label("song_count"),
                func.count(func.distinct(Album.id)).label("album_count"),
            )
            .join(Song, Artist.id == Song.artist_id, isouter=True)
            .join(Album, Artist.id == Album.artist_id, isouter=True)
            .where(Song.is_downloaded == True)
            .group_by(Artist.id)
            .order_by(func.random())
            .limit(limit)
        )
        return list(self.session.execute(statement))


class AlbumRepository(Repository[Album]):
    def __init__(self, session: Session) -> None:
        super().__init__(session, Album)

    def get_or_create(self, title: str, artist_id: int | None) -> Album:
        statement = select(Album).where(Album.title == title, Album.artist_id == artist_id)
        album = self.session.scalars(statement).first()
        if album:
            return album
        return self.add(Album(title=title, artist_id=artist_id))

    def get_with_details(self, album_id: int) -> Album | None:
        statement = (
            select(Album)
            .options(joinedload(Album.artist), joinedload(Album.songs))
            .where(Album.id == album_id)
        )
        return self.session.scalars(statement).unique().first()

    def list_with_counts(self, *, limit: int = 50, offset: int = 0) -> list[tuple[Album, int, int]]:
        statement = (
            select(
                Album,
                func.count(Song.id).label("song_count"),
                func.sum(Song.duration_seconds).label("duration_seconds"),
            )
            .options(joinedload(Album.artist))
            .join(Song, Album.id == Song.album_id, isouter=True)
            .where(Song.is_downloaded == True)
            .group_by(Album.id)
            .order_by(Album.title)
            .offset(offset)
            .limit(limit)
        )
        return list(self.session.execute(statement))

    def get_recently_added_with_counts(self, *, limit: int = 10) -> list[tuple[Album, int, int]]:
        statement = (
            select(
                Album,
                func.count(Song.id).label("song_count"),
                func.sum(Song.duration_seconds).label("duration_seconds"),
            )
            .options(joinedload(Album.artist))
            .join(Song, Album.id == Song.album_id, isouter=True)
            .where(Song.is_downloaded == True)
            .group_by(Album.id)
            .order_by(Album.created_at.desc())
            .limit(limit)
        )
        return list(self.session.execute(statement))

    def get_random_with_counts(self, *, limit: int = 5) -> list[tuple[Album, int, int]]:
        statement = (
            select(
                Album,
                func.count(Song.id).label("song_count"),
                func.sum(Song.duration_seconds).label("duration_seconds"),
            )
            .options(joinedload(Album.artist))
            .join(Song, Album.id == Song.album_id, isouter=True)
            .where(Song.is_downloaded == True)
            .group_by(Album.id)
            .order_by(func.random())
            .limit(limit)
        )
        return list(self.session.execute(statement))


class PlaylistRepository(Repository[Playlist]):
    def __init__(self, session: Session) -> None:
        super().__init__(session, Playlist)

    def get_with_songs(self, playlist_id: int) -> Playlist | None:
        statement = (
            select(Playlist)
            .options(joinedload(Playlist.songs).joinedload(PlaylistSong.song))
            .where(Playlist.id == playlist_id)
        )
        return self.session.scalars(statement).unique().first()

    def add_song(self, playlist_id: int, song_id: int) -> PlaylistSong:
        playlist = self.get(playlist_id)
        if not playlist:
            raise ValueError(f"Playlist {playlist_id} not found")

        max_position_result = self.session.execute(
            select(
                func.max(
                    func.coalesce(
                        select(func.max(PlaylistSong.position)).where(PlaylistSong.playlist_id == playlist_id).scalar_subquery(),
                        -1,
                    ),
                    func.coalesce(
                        select(func.max(PlaylistLibraryTrack.position)).where(PlaylistLibraryTrack.playlist_id == playlist_id).scalar_subquery(),
                        -1,
                    ),
                )
            )
        ).scalar()
        next_position = max_position_result + 1

        playlist_song = PlaylistSong(playlist_id=playlist_id, song_id=song_id, position=next_position)
        self.session.add(playlist_song)
        return playlist_song

    def remove_song(self, playlist_id: int, song_id: int) -> None:
        statement = select(PlaylistSong).where(
            PlaylistSong.playlist_id == playlist_id,
            PlaylistSong.song_id == song_id,
        )
        playlist_song = self.session.scalars(statement).first()
        if playlist_song:
            self.session.delete(playlist_song)

    def reorder_song(self, playlist_id: int, song_id: int, new_position: int) -> None:
        statement = select(PlaylistSong).where(
            PlaylistSong.playlist_id == playlist_id,
            PlaylistSong.song_id == song_id,
        )
        playlist_song = self.session.scalars(statement).first()
        if not playlist_song:
            return

        old_position = playlist_song.position

        if new_position < old_position:
            shift_statement = (
                select(PlaylistSong)
                .where(
                    PlaylistSong.playlist_id == playlist_id,
                    PlaylistSong.position >= new_position,
                    PlaylistSong.position < old_position,
                )
            )
            for song_to_shift in self.session.scalars(shift_statement):
                song_to_shift.position += 1
        elif new_position > old_position:
            shift_statement = (
                select(PlaylistSong)
                .where(
                    PlaylistSong.playlist_id == playlist_id,
                    PlaylistSong.position > old_position,
                    PlaylistSong.position <= new_position,
                )
            )
            for song_to_shift in self.session.scalars(shift_statement):
                song_to_shift.position -= 1

        playlist_song.position = new_position


class DownloadJobRepository(Repository[DownloadJob]):
    def __init__(self, session: Session) -> None:
        super().__init__(session, DownloadJob)

    def find_duplicate(self, source_url: str) -> DownloadJob | None:
        source_key = _download_source_key(source_url)
        statement = select(DownloadJob).where(
            DownloadJob.status.in_(
                [
                    DownloadStatus.QUEUED,
                    DownloadStatus.PREPARING,
                    DownloadStatus.DOWNLOADING,
                    DownloadStatus.PROCESSING,
                    DownloadStatus.PAUSED,
                    DownloadStatus.COMPLETED,
                ]
            )
        )
        return next(
            (job for job in self.session.scalars(statement) if job.source_url and _download_source_key(job.source_url) == source_key),
            None,
        )

    def claim_next_queued(self) -> int | None:
        if self.session.get_bind().dialect.name == "sqlite":
            self.session.execute(text("BEGIN IMMEDIATE"))
        candidate_ids = self.session.scalars(
            select(DownloadJob.id)
            .where(DownloadJob.status == DownloadStatus.QUEUED)
            .order_by(DownloadJob.created_at.asc())
            .limit(50)
        ).all()
        active_statuses = [DownloadStatus.PREPARING, DownloadStatus.DOWNLOADING, DownloadStatus.PROCESSING, DownloadStatus.PAUSED]
        for candidate_id in candidate_ids:
            album_item = self.session.scalars(
                select(AlbumDownloadItem).where(AlbumDownloadItem.download_job_id == candidate_id)
            ).first()
            if album_item:
                active_count = self.session.scalar(
                    select(func.count(AlbumDownloadItem.id))
                    .join(DownloadJob, DownloadJob.id == AlbumDownloadItem.download_job_id)
                    .where(
                        AlbumDownloadItem.album_job_id == album_item.album_job_id,
                        DownloadJob.status.in_(active_statuses),
                    )
                ) or 0
                if active_count >= album_item.album_job.max_parallel:
                    continue
            result = self.session.execute(
                update(DownloadJob)
                .where(DownloadJob.id == candidate_id, DownloadJob.status == DownloadStatus.QUEUED)
                .values(status=DownloadStatus.PREPARING, stage=DownloadStage.PREPARING, progress=0)
            )
            if result.rowcount == 1:
                self.session.commit()
                return candidate_id
        self.session.rollback()
        return None

    def next_queued(self) -> DownloadJob | None:
        statement = (
            select(DownloadJob)
            .where(DownloadJob.status == "queued")
            .order_by(DownloadJob.created_at.asc())
            .limit(1)
        )
        return self.session.scalars(statement).first()

    def list_by_statuses(self, statuses: list[str], *, limit: int = 50, offset: int = 0) -> list[DownloadJob]:
        statement = (
            select(DownloadJob)
            .where(DownloadJob.status.in_(statuses))
            .order_by(DownloadJob.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
        return list(self.session.scalars(statement))


class QueueItemRepository(Repository[QueueItem]):
    def __init__(self, session: Session) -> None:
        super().__init__(session, QueueItem)


class FavoriteRepository(Repository[Favorite]):
    def __init__(self, session: Session) -> None:
        super().__init__(session, Favorite)

    def is_favorited(self, entity_type: str, entity_id: int) -> bool:
        filters = {
            "song": Favorite.song_id == entity_id,
            "artist": Favorite.artist_id == entity_id,
            "album": Favorite.album_id == entity_id,
            "playlist": Favorite.playlist_id == entity_id,
            "library_album": Favorite.library_album_id == entity_id,
            "library_track": Favorite.library_track_id == entity_id,
        }
        if entity_type not in filters:
            return False

        statement = select(Favorite).where(filters[entity_type])
        return self.session.scalars(statement).first() is not None

    def list_all(self) -> list[Favorite]:
        return list(self.session.scalars(select(Favorite).order_by(Favorite.created_at.desc())))

    def toggle(self, entity_type: str, entity_id: int) -> bool:
        filters = {
            "song": Favorite.song_id == entity_id,
            "artist": Favorite.artist_id == entity_id,
            "album": Favorite.album_id == entity_id,
            "playlist": Favorite.playlist_id == entity_id,
            "library_album": Favorite.library_album_id == entity_id,
            "library_track": Favorite.library_track_id == entity_id,
        }
        if entity_type not in filters:
            raise ValueError(f"Invalid entity type: {entity_type}")

        statement = select(Favorite).where(filters[entity_type])
        existing = self.session.scalars(statement).first()

        if existing:
            self.session.delete(existing)
            return False
        else:
            fields = {f"{entity_type}_id": entity_id}
            favorite = Favorite(**fields)
            self.session.add(favorite)
            return True

    def list_songs(self, *, limit: int = 50, offset: int = 0) -> list[Song]:
        statement = (
            select(Song)
            .options(joinedload(Song.artist), joinedload(Song.album))
            .join(Favorite, Favorite.song_id == Song.id)
            .where(Song.is_downloaded == True)
            .order_by(Favorite.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
        return list(self.session.scalars(statement).unique())

    def list_artists_with_counts(self, *, limit: int = 50, offset: int = 0) -> list[tuple[Artist, int, int]]:
        statement = (
            select(
                Artist,
                func.count(func.distinct(Song.id)).label("song_count"),
                func.count(func.distinct(Album.id)).label("album_count"),
            )
            .join(Favorite, Favorite.artist_id == Artist.id)
            .join(Song, Artist.id == Song.artist_id, isouter=True)
            .join(Album, Artist.id == Album.artist_id, isouter=True)
            .where(Song.is_downloaded == True)
            .group_by(Artist.id)
            .order_by(Favorite.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
        return list(self.session.execute(statement))

    def list_albums_with_counts(self, *, limit: int = 50, offset: int = 0) -> list[tuple[Album, int, int]]:
        statement = (
            select(
                Album,
                func.count(Song.id).label("song_count"),
                func.sum(Song.duration_seconds).label("duration_seconds"),
            )
            .options(joinedload(Album.artist))
            .join(Favorite, Favorite.album_id == Album.id)
            .join(Song, Album.id == Song.album_id, isouter=True)
            .where(Song.is_downloaded == True)
            .group_by(Album.id)
            .order_by(Favorite.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
        return list(self.session.execute(statement))


class HistoryRepository(Repository[History]):
    def __init__(self, session: Session) -> None:
        super().__init__(session, History)

    def list_with_songs(self, *, limit: int = 50, offset: int = 0) -> list[History]:
        statement = (
            select(History)
            .options(joinedload(History.song).joinedload(Song.artist), joinedload(History.song).joinedload(Song.album))
            .order_by(History.played_at.desc())
            .offset(offset)
            .limit(limit)
        )
        return list(self.session.scalars(statement).unique())

    def get_recent_history(self, *, limit: int = 50) -> list[History]:
        statement = (
            select(History)
            .options(joinedload(History.song).joinedload(Song.artist), joinedload(History.song).joinedload(Song.album))
            .where(History.event_type.in_(["played", "completed"]))
            .order_by(History.played_at.desc())
            .limit(max(limit * 8, 100))
        )
        entries = list(self.session.scalars(statement).unique())
        return self._dedupe_history(entries, limit=limit)

    def get_most_played_history(self, *, limit: int = 50) -> list[History]:
        statement = (
            select(History)
            .options(joinedload(History.song).joinedload(Song.artist), joinedload(History.song).joinedload(Song.album))
            .where(History.event_type == "played")
            .order_by(History.played_at.desc())
            .limit(max(limit * 20, 300))
        )
        entries = list(self.session.scalars(statement).unique())
        counts: dict[str, int] = {}
        latest: dict[str, History] = {}
        for entry in entries:
            key = self._history_key(entry)
            counts[key] = counts.get(key, 0) + 1
            if key not in latest or entry.played_at > latest[key].played_at:
                latest[key] = entry
        return sorted(latest.values(), key=lambda entry: (counts[self._history_key(entry)], entry.played_at), reverse=True)[:limit]

    def get_recently_played_songs(self, *, limit: int = 50) -> list[Song]:
        subquery = (
            select(History.song_id, func.max(History.played_at).label("last_played"))
            .where(History.song_id.isnot(None))
            .group_by(History.song_id)
            .order_by(func.max(History.played_at).desc())
            .limit(limit)
            .subquery()
        )

        statement = (
            select(Song)
            .options(joinedload(Song.artist), joinedload(Song.album))
            .join(subquery, Song.id == subquery.c.song_id)
            .order_by(subquery.c.last_played.desc())
        )
        return list(self.session.scalars(statement).unique())

    def get_most_played_songs(self, *, limit: int = 50) -> list[Song]:
        subquery = (
            select(History.song_id, func.count(History.id).label("play_count"))
            .where(History.song_id.isnot(None), History.event_type == "played")
            .group_by(History.song_id)
            .order_by(func.count(History.id).desc())
            .limit(limit)
            .subquery()
        )

        statement = (
            select(Song)
            .options(joinedload(Song.artist), joinedload(Song.album))
            .join(subquery, Song.id == subquery.c.song_id)
            .order_by(subquery.c.play_count.desc())
        )
        return list(self.session.scalars(statement).unique())

    def _dedupe_history(self, entries: list[History], *, limit: int) -> list[History]:
        seen: set[str] = set()
        result: list[History] = []
        for entry in entries:
            key = self._history_key(entry)
            if key in seen:
                continue
            seen.add(key)
            result.append(entry)
            if len(result) >= limit:
                break
        return result

    def _history_key(self, entry: History) -> str:
        if entry.source == "youtube" and entry.external_id:
            return f"youtube:{entry.external_id}"
        if entry.song_id:
            return f"local:{entry.song_id}"
        return f"history:{entry.id}"


def _download_source_key(source_url: str) -> str:
    parsed = urlparse(source_url.strip())
    host = (parsed.hostname or "").lower()
    video_id = None
    if host in {"youtu.be", "www.youtu.be"}:
        video_id = parsed.path.strip("/").split("/")[0]
    elif host.endswith("youtube.com"):
        if parsed.path == "/watch":
            video_id = (parse_qs(parsed.query).get("v") or [None])[0]
        elif parsed.path.startswith(("/shorts/", "/embed/")):
            video_id = parsed.path.strip("/").split("/")[1]
    return f"youtube:{video_id}" if video_id else source_url.strip().casefold()
