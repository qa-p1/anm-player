from sqlalchemy import String, and_, case, cast, func, literal, select, text
from sqlalchemy import update
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models import Album, AlbumDownloadItem, Artist, DownloadJob, Playlist, PlaylistLibraryTrack, QueueItem, Song
from app.models.history import Favorite, History
from app.models.playlist import PlaylistSong
from app.repositories.base import Repository
from app.core.enums import DownloadStage, DownloadStatus
from app.core.youtube import youtube_video_id


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
            .where(Song.is_downloaded.is_(True))
            .order_by(Song.created_at.desc(), Song.id.desc())
            .offset(offset)
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
            .options(
                selectinload(Artist.albums).selectinload(Album.songs).joinedload(Song.artist),
                selectinload(Artist.songs).joinedload(Song.album),
            )
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
            .options(
                selectinload(Artist.albums).selectinload(Album.songs),
                selectinload(Artist.songs),
            )
            .join(Song, Artist.id == Song.artist_id, isouter=True)
            .join(Album, Artist.id == Album.artist_id, isouter=True)
            .where(Song.is_downloaded.is_(True))
            .group_by(Artist.id)
            .order_by(Artist.name, Artist.id)
            .offset(offset)
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
            .options(
                joinedload(Album.artist),
                selectinload(Album.songs).joinedload(Song.artist),
            )
            .where(Album.id == album_id)
        )
        return self.session.scalars(statement).unique().first()


class PlaylistRepository(Repository[Playlist]):
    def __init__(self, session: Session) -> None:
        super().__init__(session, Playlist)

    def get_with_songs(self, playlist_id: int) -> Playlist | None:
        statement = (
            select(Playlist)
            .options(
                joinedload(Playlist.songs).joinedload(PlaylistSong.song).joinedload(Song.artist),
                joinedload(Playlist.songs).joinedload(PlaylistSong.song).joinedload(Song.album),
            )
            .where(Playlist.id == playlist_id)
        )
        return self.session.scalars(statement).unique().first()

    def next_position(self, playlist_id: int) -> int:
        """Return the first free position across both song and library-track links."""
        highest = self.session.execute(
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
        return (highest if highest is not None else -1) + 1

    def add_song(self, playlist_id: int, song_id: int, *, position: int | None = None) -> PlaylistSong:
        if position is None:
            if not self.get(playlist_id):
                raise ValueError(f"Playlist {playlist_id} not found")
            position = self.next_position(playlist_id)
        playlist_song = PlaylistSong(playlist_id=playlist_id, song_id=song_id, position=position)
        self.session.add(playlist_song)
        return playlist_song

    def remove_song(self, playlist_id: int, song_id: int) -> bool:
        statement = select(PlaylistSong).where(
            PlaylistSong.playlist_id == playlist_id,
            PlaylistSong.song_id == song_id,
        )
        playlist_song = self.session.scalars(statement).first()
        if not playlist_song:
            return False
        self.session.delete(playlist_song)
        return True


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

    def list_in_queue_order(self, *, limit: int = 50, offset: int = 0) -> list[DownloadJob]:
        """Oldest first, matching the worker's claim order; the ID keeps offset paging stable."""
        statement = (
            select(DownloadJob)
            .order_by(DownloadJob.created_at.asc(), DownloadJob.id.asc())
            .offset(offset)
            .limit(limit)
        )
        return list(self.session.scalars(statement))

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


FAVORITE_ENTITY_COLUMNS = {
    "song": Favorite.song_id,
    "artist": Favorite.artist_id,
    "album": Favorite.album_id,
    "playlist": Favorite.playlist_id,
    "library_album": Favorite.library_album_id,
    "library_track": Favorite.library_track_id,
}


class FavoriteRepository(Repository[Favorite]):
    def __init__(self, session: Session) -> None:
        super().__init__(session, Favorite)

    def _find(self, entity_type: str, entity_id: int) -> Favorite | None:
        column = FAVORITE_ENTITY_COLUMNS[entity_type]
        return self.session.scalars(select(Favorite).where(column == entity_id)).first()

    def is_favorited(self, entity_type: str, entity_id: int) -> bool:
        if entity_type not in FAVORITE_ENTITY_COLUMNS:
            return False
        return self._find(entity_type, entity_id) is not None

    def list_all(self) -> list[Favorite]:
        return list(self.session.scalars(select(Favorite).order_by(Favorite.created_at.desc())))

    def toggle(self, entity_type: str, entity_id: int) -> bool:
        if entity_type not in FAVORITE_ENTITY_COLUMNS:
            raise ValueError(f"Invalid entity type: {entity_type}")
        existing = self._find(entity_type, entity_id)
        if existing:
            self.session.delete(existing)
            return False
        self.session.add(Favorite(**{f"{entity_type}_id": entity_id}))
        return True


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
        track_key = case(
            (
                and_(History.source == "youtube", History.external_id.is_not(None)),
                literal("youtube:") + History.external_id,
            ),
            (History.song_id.is_not(None), literal("local:") + cast(History.song_id, String)),
            (
                and_(History.source == "local", History.external_id.is_not(None)),
                literal("local:") + History.external_id,
            ),
            else_=literal("history:") + cast(History.id, String),
        )
        ranked = (
            select(
                History.id.label("history_id"),
                func.count(History.id).over(partition_by=track_key).label("play_count"),
                func.row_number().over(
                    partition_by=track_key,
                    order_by=[History.played_at.desc(), History.id.desc()],
                ).label("recency_rank"),
            )
            .where(History.event_type == "played")
            .subquery()
        )
        statement = (
            select(History)
            .options(joinedload(History.song).joinedload(Song.artist), joinedload(History.song).joinedload(Song.album))
            .join(ranked, History.id == ranked.c.history_id)
            .where(ranked.c.recency_rank == 1)
            .order_by(ranked.c.play_count.desc(), History.played_at.desc(), History.id.desc())
            .limit(limit)
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
        if entry.source == "local" and entry.external_id:
            return f"local:{entry.external_id}"
        return f"history:{entry.id}"


def _download_source_key(source_url: str) -> str:
    video_id = youtube_video_id(source_url)
    return f"youtube:{video_id}" if video_id else source_url.strip().casefold()
