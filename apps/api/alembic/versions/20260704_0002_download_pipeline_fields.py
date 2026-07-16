"""download pipeline fields

Revision ID: 20260704_0002
Revises: 20260704_0001
Create Date: 2026-07-04
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20260704_0002"
down_revision: str | None = "20260704_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("download_jobs") as batch:
        batch.add_column(sa.Column("video_id", sa.String(length=255), nullable=True))
        batch.add_column(sa.Column("artist", sa.String(length=255), nullable=True))
        batch.add_column(sa.Column("album", sa.String(length=255), nullable=True))
        batch.add_column(sa.Column("thumbnail_url", sa.String(length=2048), nullable=True))
        batch.add_column(sa.Column("search_query", sa.String(length=512), nullable=True))
        batch.add_column(sa.Column("stage", sa.String(length=80), nullable=False, server_default="Queued"))
        batch.add_column(sa.Column("speed", sa.String(length=80), nullable=True))
        batch.add_column(sa.Column("eta", sa.String(length=80), nullable=True))
        batch.add_column(sa.Column("overwrite_existing", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch.add_column(sa.Column("cancelled_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("download_jobs") as batch:
        batch.drop_column("cancelled_at")
        batch.drop_column("overwrite_existing")
        batch.drop_column("eta")
        batch.drop_column("speed")
        batch.drop_column("stage")
        batch.drop_column("search_query")
        batch.drop_column("thumbnail_url")
        batch.drop_column("album")
        batch.drop_column("artist")
        batch.drop_column("video_id")
