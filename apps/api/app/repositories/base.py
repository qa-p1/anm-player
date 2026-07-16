from typing import Generic, TypeVar

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from app.database.base import Base

ModelT = TypeVar("ModelT", bound=Base)


class Repository(Generic[ModelT]):
    def __init__(self, session: Session, model: type[ModelT]) -> None:
        self.session = session
        self.model = model

    def get(self, model_id: int) -> ModelT | None:
        return self.session.get(self.model, model_id)

    def list(self, *, limit: int | None = None, offset: int = 0) -> list[ModelT]:
        statement: Select[tuple[ModelT]] = select(self.model).offset(offset)
        if limit is not None:
            statement = statement.limit(limit)
        return list(self.session.scalars(statement))

    def count(self) -> int:
        statement = select(func.count()).select_from(self.model)
        return int(self.session.scalar(statement) or 0)

    def add(self, model: ModelT) -> ModelT:
        self.session.add(model)
        self.session.flush()
        return model

    def delete(self, model: ModelT) -> None:
        self.session.delete(model)
        self.session.flush()
