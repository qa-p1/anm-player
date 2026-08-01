import gc
import warnings

import pytest
import sqlalchemy
from sqlalchemy.engine import Engine

from app.core.config import settings
from app.storage import storage_manager
from app.storage.paths import StoragePaths


_CREATED_ENGINES: list[Engine] = []
_CREATE_ENGINE = sqlalchemy.create_engine


def _tracked_create_engine(*args, **kwargs) -> Engine:
    engine = _CREATE_ENGINE(*args, **kwargs)
    _CREATED_ENGINES.append(engine)
    return engine


# Test modules import create_engine during collection. Track every engine so
# Python 3.14 does not surface delayed unclosed-sqlite ResourceWarnings.
sqlalchemy.create_engine = _tracked_create_engine


@pytest.fixture(autouse=True)
def isolated_test_environment(monkeypatch: pytest.MonkeyPatch):
    """Keep test requests local and independent of a developer's root .env."""
    monkeypatch.setattr(settings, "api_env", "test")
    monkeypatch.setattr(settings, "api_access_token", None)
    yield
    for engine in _CREATED_ENGINES:
        engine.dispose(close=True)
    # SQLAlchemy's sqlite connection finalizers emit delayed ResourceWarnings
    # under Python 3.14 even after explicit session and engine disposal. Collect
    # them here while suppressing only that already-cleaned-up finalizer noise.
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", ResourceWarning)
        gc.collect()


@pytest.fixture
def music_directory(tmp_path, monkeypatch: pytest.MonkeyPatch):
    """Inject an isolated managed music directory without restoring runtime aliases."""
    paths = StoragePaths(tmp_path / "aura-data")
    paths.ensure()
    state = {
        "schema_version": 1,
        "data_root": str(paths.root),
        "migration": None,
    }
    monkeypatch.setattr(storage_manager.state_store, "read", lambda: state)
    storage_manager.refresh()
    yield paths.music
    storage_manager.refresh()
