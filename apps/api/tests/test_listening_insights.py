from datetime import UTC, datetime, time, timedelta

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

from app.api.v1.routes.history import clear_history, delete_history_entry
from app.core.exceptions import ResourceNotFoundError
from app.models import Base, History
from app.services.listening_insights import ListeningInsightsService
from app.repositories.music import HistoryRepository


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)()


def history_event(
    *,
    title: str,
    artist: str,
    event_type: str,
    when: datetime,
    external_id: str,
    duration: int = 180,
    position: int | None = None,
) -> History:
    return History(
        source="youtube",
        external_id=external_id,
        title=title,
        artist_name=artist,
        album_title=f"{artist} Album",
        duration_seconds=duration,
        event_type=event_type,
        position_seconds=position,
        played_at=when,
    )


def test_insights_aggregate_plays_completion_skips_and_rankings() -> None:
    now = datetime.now(UTC)
    with make_session() as session:
        session.add_all(
            [
                history_event(title="Repeat", artist="Alpha", event_type="played", when=now, external_id="repeat"),
                history_event(title="Repeat", artist="Alpha", event_type="completed", when=now, external_id="repeat"),
                history_event(title="Repeat", artist="Alpha", event_type="played", when=now, external_id="repeat"),
                history_event(
                    title="Repeat",
                    artist="Alpha",
                    event_type="skipped",
                    when=now,
                    external_id="repeat",
                    position=40,
                ),
                history_event(title="Other", artist="Beta", event_type="played", when=now, external_id="other", duration=90),
                history_event(title="Other", artist="Beta", event_type="completed", when=now, external_id="other", duration=90),
            ]
        )
        session.commit()

        result = ListeningInsightsService(session).get(days=30)

    assert result.summary.total_plays == 3
    assert result.summary.completed_plays == 2
    assert result.summary.skipped_plays == 1
    assert result.summary.listening_seconds == 310
    assert result.summary.unique_tracks == 2
    assert result.summary.unique_artists == 2
    assert result.summary.completion_rate == pytest.approx(66.7)
    assert result.summary.current_streak_days == 1
    assert result.top_tracks[0].title == "Repeat"
    assert result.top_tracks[0].play_count == 2
    assert result.top_tracks[0].skipped_count == 1
    assert result.top_artists[0].name == "Alpha"
    assert sum(bucket.play_count for bucket in result.hourly) == 3
    assert result.daily[-1].play_count == 3


def test_insights_honor_range_and_all_time_mode() -> None:
    now = datetime.now(UTC)
    with make_session() as session:
        session.add_all(
            [
                history_event(title="Recent", artist="Artist", event_type="played", when=now, external_id="recent"),
                history_event(
                    title="Old",
                    artist="Artist",
                    event_type="played",
                    when=now - timedelta(days=45),
                    external_id="old",
                ),
            ]
        )
        session.commit()

        recent = ListeningInsightsService(session).get(days=30)
        all_time = ListeningInsightsService(session).get(days=0)

    assert recent.summary.total_plays == 1
    assert recent.summary.period_days == 30
    assert len(recent.daily) == 30
    assert all_time.summary.total_plays == 2
    assert all_time.summary.period_days is None
    assert len(all_time.daily) == 2


def test_history_entries_can_be_deleted_individually_or_cleared() -> None:
    now = datetime.now(UTC)
    with make_session() as session:
        first = history_event(title="First", artist="Artist", event_type="played", when=now, external_id="first")
        second = history_event(title="Second", artist="Artist", event_type="played", when=now, external_id="second")
        session.add_all([first, second])
        session.commit()
        first_id = first.id

        delete_history_entry(session, first_id)
        assert session.scalar(select(func.count(History.id))) == 1
        with pytest.raises(ResourceNotFoundError) as missing:
            delete_history_entry(session, first_id)
        assert missing.value.details == {"history_id": first_id}

        result = clear_history(session)
        assert result == {"deleted": 1}
        assert session.scalar(select(func.count(History.id))) == 0


def test_most_played_history_counts_the_complete_lifetime_log() -> None:
    now = datetime.now(UTC)
    with make_session() as session:
        session.add_all(
            history_event(
                title="Lifetime favorite",
                artist="Artist",
                event_type="played",
                when=now - timedelta(days=60, seconds=index),
                external_id="lifetime",
            )
            for index in range(321)
        )
        session.add_all(
            history_event(
                title="Recent runner-up",
                artist="Artist",
                event_type="played",
                when=now - timedelta(seconds=index),
                external_id="recent",
            )
            for index in range(300)
        )
        session.commit()

        result = HistoryRepository(session).get_most_played_history(limit=1)

    assert len(result) == 1
    assert result[0].title == "Lifetime favorite"


def test_insight_summary_and_daily_series_cover_the_same_calendar_days() -> None:
    now = datetime.now(UTC)
    excluded_boundary = datetime.combine(
        now.date() - timedelta(days=30),
        time.max,
        tzinfo=UTC,
    )
    with make_session() as session:
        session.add_all(
            [
                history_event(
                    title="Partial extra day",
                    artist="Artist",
                    event_type="played",
                    when=excluded_boundary,
                    external_id="boundary",
                ),
                history_event(
                    title="Today",
                    artist="Artist",
                    event_type="played",
                    when=now,
                    external_id="today",
                ),
            ]
        )
        session.commit()

        result = ListeningInsightsService(session).get(days=30)

    assert len(result.daily) == 30
    assert result.summary.total_plays == 1
    assert sum(day.play_count for day in result.daily) == result.summary.total_plays


def test_daily_series_honors_the_full_valid_requested_period() -> None:
    with make_session() as session:
        result = ListeningInsightsService(session).get(days=365)

    assert len(result.daily) == 365


def test_current_streak_remains_active_until_the_day_after_the_last_play() -> None:
    today = datetime.now(UTC).date()

    streak = ListeningInsightsService._current_streak(
        {today - timedelta(days=1), today - timedelta(days=2)},
        today,
    )

    assert streak == 2


def test_insights_do_not_expose_physical_artwork_paths() -> None:
    now = datetime.now(UTC)
    with make_session() as session:
        event = history_event(
            title="Private artwork",
            artist="Artist",
            event_type="played",
            when=now,
            external_id="private-artwork",
        )
        event.artwork_url = r"C:\private\cover.jpg"
        session.add(event)
        session.commit()

        result = ListeningInsightsService(session).get(days=30)

    assert result.top_tracks[0].artwork_url is None


def test_most_played_history_preserves_orphaned_local_track_identity() -> None:
    now = datetime.now(UTC)
    with make_session() as session:
        session.add_all(
            History(
                source="local",
                external_id="42",
                title="Deleted lifetime favorite",
                event_type="played",
                played_at=now - timedelta(days=30, seconds=index),
            )
            for index in range(5)
        )
        session.add_all(
            History(
                source="local",
                external_id="43",
                title="Recent runner-up",
                event_type="played",
                played_at=now - timedelta(seconds=index),
            )
            for index in range(3)
        )
        session.commit()

        result = HistoryRepository(session).get_most_played_history(limit=1)

    assert result[0].title == "Deleted lifetime favorite"
