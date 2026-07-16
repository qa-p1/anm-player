"""mixed playback history

Revision ID: 20260709_0007
Revises: 20260709_0006
Create Date: 2026-07-09
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20260709_0007"
down_revision: str | None = "20260709_0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("history") as batch_op:
        batch_op.add_column(sa.Column("source", sa.String(length=40), nullable=False, server_default="local"))
        batch_op.add_column(sa.Column("external_id", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("title", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("artist_name", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("album_title", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("artwork_url", sa.String(length=2048), nullable=True))
        batch_op.add_column(sa.Column("duration_seconds", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("source_url", sa.String(length=2048), nullable=True))
        batch_op.create_index("ix_history_source_external_id", ["source", "external_id"])


def downgrade() -> None:
    with op.batch_alter_table("history") as batch_op:
        batch_op.drop_index("ix_history_source_external_id")
        batch_op.drop_column("source_url")
        batch_op.drop_column("duration_seconds")
        batch_op.drop_column("artwork_url")
        batch_op.drop_column("album_title")
        batch_op.drop_column("artist_name")
        batch_op.drop_column("title")
        batch_op.drop_column("external_id")
        batch_op.drop_column("source")
