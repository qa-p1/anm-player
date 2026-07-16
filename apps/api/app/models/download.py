from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship, synonym

from app.database.base import Base, TimestampMixin


class DownloadJob(TimestampMixin, Base):
    __tablename__ = "download_jobs"
    __table_args__ = (
        Index("ix_download_jobs_status", "status"),
        Index("ix_download_jobs_created_at", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    status: Mapped[str] = mapped_column(String(40), default="pending", nullable=False)
    source_url: Mapped[str | None] = mapped_column(String(2048))
    video_id: Mapped[str | None] = mapped_column(String(255))
    title: Mapped[str | None] = mapped_column(String(255))
    artist: Mapped[str | None] = mapped_column(String(255))
    album: Mapped[str | None] = mapped_column(String(255))
    thumbnail_url: Mapped[str | None] = mapped_column(String(2048))
    search_query: Mapped[str | None] = mapped_column(String(512))
    progress: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    stage: Mapped[str] = mapped_column(String(80), default="Queued", nullable=False)
    speed: Mapped[str | None] = mapped_column(String(80))
    eta: Mapped[str | None] = mapped_column(String(80))
    output_relative_path: Mapped[str | None] = mapped_column(String(2048))
    target_path = synonym("output_relative_path")
    audio_format: Mapped[str] = mapped_column(String(20), default="mp3", nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text)
    overwrite_existing: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    cancelled_at: Mapped[datetime | None] = mapped_column()
    completed_at: Mapped[datetime | None] = mapped_column()

    queue_item: Mapped["QueueItem | None"] = relationship(back_populates="download_job", uselist=False)


class QueueItem(TimestampMixin, Base):
    __tablename__ = "queue_items"
    __table_args__ = (
        Index("ix_queue_items_status_priority", "status", "priority"),
        Index("ix_queue_items_scheduled_at", "scheduled_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    download_job_id: Mapped[int | None] = mapped_column(ForeignKey("download_jobs.id", ondelete="CASCADE"))
    item_type: Mapped[str] = mapped_column(String(40), default="download", nullable=False)
    status: Mapped[str] = mapped_column(String(40), default="queued", nullable=False)
    priority: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    scheduled_at: Mapped[datetime | None] = mapped_column()

    download_job: Mapped[DownloadJob | None] = relationship(back_populates="queue_item")
