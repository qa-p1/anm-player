from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models import Base
from app.services.metadata.service import MetadataEnrichmentService


def test_metadata_service_registers_youtube_music_provider() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)

    with Session() as session:
        service = MetadataEnrichmentService(session)

    assert [provider.name for provider in service.providers] == ["youtube_music"]
