from collections.abc import Generator

import threading
from pathlib import Path

from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings
from app.storage import storage_manager

SessionLocal = sessionmaker(
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,
)


class DatabaseEngineManager:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._engine: Engine | None = None

    @property
    def engine(self) -> Engine:
        with self._lock:
            if self._engine is None:
                self.bind()
            assert self._engine is not None
            return self._engine

    @property
    def managed(self) -> bool:
        return settings.database_url is None or settings.database_url.startswith("sqlite")

    def url_for(self, database: str | Path | None = None) -> str:
        if settings.database_url and not settings.database_url.startswith("sqlite"):
            return settings.database_url
        path = Path(database or storage_manager.paths.database).resolve()
        path.parent.mkdir(parents=True, exist_ok=True)
        return f"sqlite:///{path.as_posix()}"

    def bind(self, database: str | Path | None = None) -> Engine:
        with self._lock:
            connect_args = {"check_same_thread": False} if self.managed else {}
            new_engine = create_engine(
                self.url_for(database),
                connect_args=connect_args,
                pool_pre_ping=True,
            )

            if self.managed:
                @event.listens_for(new_engine, "connect")
                def _enable_sqlite_foreign_keys(dbapi_connection, _connection_record) -> None:
                    cursor = dbapi_connection.cursor()
                    cursor.execute("PRAGMA foreign_keys=ON")
                    cursor.close()

            old_engine = self._engine
            self._engine = new_engine
            SessionLocal.configure(bind=new_engine)
            if old_engine is not None:
                old_engine.dispose(close=True)
            return new_engine

    def dispose(self) -> None:
        with self._lock:
            if self._engine is not None:
                self._engine.dispose(close=True)
                self._engine = None
            SessionLocal.configure(bind=None)

    def checkpoint(self) -> None:
        if not self.managed:
            raise RuntimeError("SQLite checkpoint is unavailable for an external database")
        with self.engine.begin() as connection:
            connection.exec_driver_sql("PRAGMA wal_checkpoint(TRUNCATE)")

    def quick_check(self) -> None:
        if not self.managed:
            raise RuntimeError("SQLite quick_check is unavailable for an external database")
        with self.engine.connect() as connection:
            result = connection.execute(text("PRAGMA quick_check")).scalar_one()
            if str(result).casefold() != "ok":
                raise RuntimeError(f"SQLite quick_check failed: {result}")


engine_manager = DatabaseEngineManager()
engine = engine_manager.bind()


def get_session() -> Generator[Session, None, None]:
    with SessionLocal() as session:
        yield session
