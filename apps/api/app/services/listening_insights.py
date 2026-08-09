from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import History
from app.schemas.insights import (
    AlbumInsight,
    ArtistInsight,
    DailyListening,
    HourlyListening,
    ListeningInsightsResponse,
    ListeningSummary,
    TrackInsight,
)


@dataclass
class _TrackAccumulator:
    latest: History
    play_count: int = 0
    completed_count: int = 0
    skipped_count: int = 0
    listening_seconds: int = 0


class ListeningInsightsService:
    """Build single-user listening summaries from the durable history log."""

    def __init__(self, session: Session) -> None:
        self.session = session

    def get(self, *, days: int = 30) -> ListeningInsightsResponse:
        now = datetime.now(UTC)
        range_start = (
            now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=days - 1)
            if days > 0
            else None
        )
        statement = select(History).order_by(History.played_at.asc(), History.id.asc())
        if range_start is not None:
            # SQLite returns its stored UTC timestamps without tzinfo. Comparing
            # against a naive UTC value keeps the query portable across tests and
            # production while the API response remains explicitly UTC.
            statement = statement.where(History.played_at >= range_start.replace(tzinfo=None))
        entries = list(self.session.scalars(statement))

        tracks: dict[str, _TrackAccumulator] = {}
        artist_counts: dict[str, list[int]] = defaultdict(lambda: [0, 0])
        album_counts: dict[tuple[str, str | None], list[int]] = defaultdict(lambda: [0, 0])
        daily_counts: dict[date, list[int]] = defaultdict(lambda: [0, 0])
        hourly_counts = [0] * 24
        active_dates: set[date] = set()

        total_plays = completed_plays = skipped_plays = listening_seconds = 0
        for entry in entries:
            key = self._track_key(entry)
            accumulator = tracks.get(key)
            if accumulator is None:
                accumulator = _TrackAccumulator(latest=entry)
                tracks[key] = accumulator
            elif entry.played_at >= accumulator.latest.played_at:
                accumulator.latest = entry

            event_seconds = self._event_listening_seconds(entry)
            accumulator.listening_seconds += event_seconds
            listening_seconds += event_seconds
            event_date = self._utc_datetime(entry.played_at).date()

            if entry.event_type == "played":
                total_plays += 1
                accumulator.play_count += 1
                active_dates.add(event_date)
                daily_counts[event_date][0] += 1
                hourly_counts[self._utc_datetime(entry.played_at).hour] += 1
                if entry.artist_name:
                    artist_counts[entry.artist_name][0] += 1
                if entry.album_title:
                    album_counts[(entry.album_title, entry.artist_name)][0] += 1
            elif entry.event_type == "completed":
                completed_plays += 1
                accumulator.completed_count += 1
            elif entry.event_type == "skipped":
                skipped_plays += 1
                accumulator.skipped_count += 1

            daily_counts[event_date][1] += event_seconds
            if entry.artist_name:
                artist_counts[entry.artist_name][1] += event_seconds
            if entry.album_title:
                album_counts[(entry.album_title, entry.artist_name)][1] += event_seconds

        completion_rate = min(100.0, (completed_plays / total_plays * 100) if total_plays else 0.0)
        summary = ListeningSummary(
            period_days=days or None,
            range_start=range_start,
            generated_at=now,
            total_plays=total_plays,
            completed_plays=completed_plays,
            skipped_plays=skipped_plays,
            listening_seconds=listening_seconds,
            unique_tracks=sum(1 for item in tracks.values() if item.play_count > 0),
            unique_artists=sum(1 for counts in artist_counts.values() if counts[0] > 0),
            active_days=len(active_dates),
            current_streak_days=self._current_streak(active_dates, now.date()),
            completion_rate=round(completion_rate, 1),
        )

        top_tracks = sorted(
            (self._track_response(key, item) for key, item in tracks.items() if item.play_count > 0),
            key=lambda item: (item.play_count, item.listening_seconds, item.title.casefold()),
            reverse=True,
        )[:12]
        top_artists = [
            ArtistInsight(name=name, play_count=counts[0], listening_seconds=counts[1])
            for name, counts in sorted(
                artist_counts.items(),
                key=lambda item: (item[1][0], item[1][1], item[0].casefold()),
                reverse=True,
            )[:10]
        ]
        top_albums = [
            AlbumInsight(title=title, artist_name=artist, play_count=counts[0], listening_seconds=counts[1])
            for (title, artist), counts in sorted(
                album_counts.items(),
                key=lambda item: (item[1][0], item[1][1], item[0][0].casefold()),
                reverse=True,
            )[:10]
        ]

        daily = self._daily_series(daily_counts, now.date(), days)
        hourly = [HourlyListening(hour=hour, play_count=count) for hour, count in enumerate(hourly_counts)]
        return ListeningInsightsResponse(
            summary=summary,
            top_tracks=top_tracks,
            top_artists=top_artists,
            top_albums=top_albums,
            daily=daily,
            hourly=hourly,
        )

    @staticmethod
    def _track_key(entry: History) -> str:
        if entry.source == "youtube" and entry.external_id:
            return f"youtube:{entry.external_id}"
        if entry.song_id:
            return f"local:{entry.song_id}"
        if entry.source == "local" and entry.external_id:
            return f"local:{entry.external_id}"
        title = (entry.title or "unknown").strip().casefold()
        artist = (entry.artist_name or "unknown").strip().casefold()
        return f"metadata:{artist}:{title}"

    @staticmethod
    def _event_listening_seconds(entry: History) -> int:
        if entry.event_type == "completed":
            return max(0, entry.duration_seconds or entry.position_seconds or 0)
        if entry.event_type == "skipped":
            return max(0, entry.position_seconds or 0)
        return 0

    @staticmethod
    def _utc_datetime(value: datetime) -> datetime:
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)

    @classmethod
    def _current_streak(cls, active_dates: set[date], today: date) -> int:
        streak = 0
        cursor = today if today in active_dates else today - timedelta(days=1)
        while cursor in active_dates:
            streak += 1
            cursor -= timedelta(days=1)
        return streak

    @staticmethod
    def _daily_series(counts: dict[date, list[int]], today: date, days: int) -> list[DailyListening]:
        if days > 0:
            start = today - timedelta(days=days - 1)
            dates = [start + timedelta(days=index) for index in range(days)]
        else:
            dates = sorted(counts)
        return [
            DailyListening(
                date=day.isoformat(),
                play_count=counts[day][0],
                listening_seconds=counts[day][1],
            )
            for day in dates
        ]

    @staticmethod
    def _track_response(key: str, item: _TrackAccumulator) -> TrackInsight:
        entry = item.latest
        return TrackInsight(
            key=key,
            source=entry.source,
            external_id=entry.external_id,
            song_id=entry.song_id,
            title=entry.title or (entry.song.title if entry.song else "Unknown track"),
            artist_name=entry.artist_name,
            album_title=entry.album_title,
            artwork_url=entry.artwork_url,
            source_url=entry.source_url,
            duration_seconds=entry.duration_seconds,
            play_count=item.play_count,
            completed_count=item.completed_count,
            skipped_count=item.skipped_count,
            listening_seconds=item.listening_seconds,
        )
