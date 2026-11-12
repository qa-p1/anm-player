"""one history row per listen: remember how it ended

Revision ID: 20261112_0014
Revises: 20260722_0013
Create Date: 2026-11-12
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20261112_0014"
down_revision: str | None = "20260722_0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("history") as batch_op:
        batch_op.add_column(sa.Column("outcome", sa.String(length=16), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("history") as batch_op:
        batch_op.drop_column("outcome")
