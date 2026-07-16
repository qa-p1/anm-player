from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models import Album, Artist, Base, Song
from app.services.advanced_search import AdvancedSearchService, SearchFilters


def test_song_text_search_with_year_and_artist_sort_joins_each_table_once() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    with Session() as session:
        artist = Artist(name="Matched Artist")
        session.add(artist)
        session.flush()
        album = Album(title="Matched Album", artist_id=artist.id, year=2025)
        session.add(album)
        session.flush()
        session.add(Song(title="Matched Song", artist_id=artist.id, album_id=album.id, is_downloaded=True))
        session.commit()

        results = AdvancedSearchService(session).search_songs(
            SearchFilters(query="matched", year_min=2020, sort_by="artist")
        )

    assert [song.title for song in results] == ["Matched Song"]


def test_album_text_search_with_artist_sort_joins_artist_once() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    with Session() as session:
        artist = Artist(name="Matched Artist")
        session.add(artist)
        session.flush()
        session.add(Album(title="Matched Album", artist_id=artist.id))
        session.commit()

        results = AdvancedSearchService(session).search_albums(
            SearchFilters(query="matched", sort_by="artist")
        )

    assert [album.title for album in results] == ["Matched Album"]
