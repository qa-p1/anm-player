"""cascade queue items with download jobs

Revision ID: 20260711_0009
Revises: 20260711_0008
Create Date: 2026-07-11
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260711_0009"
down_revision: str | None = "20260711_0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

NAMING_CONVENTION = {"fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s"}


def upgrade() -> None:
    with op.batch_alter_table("queue_items", naming_convention=NAMING_CONVENTION) as batch_op:
        batch_op.drop_constraint("fk_queue_items_download_job_id_download_jobs", type_="foreignkey")
        batch_op.create_foreign_key(
            "fk_queue_items_download_job_id_download_jobs",
            "download_jobs",
            ["download_job_id"],
            ["id"],
            ondelete="CASCADE",
        )


def downgrade() -> None:
    with op.batch_alter_table("queue_items", naming_convention=NAMING_CONVENTION) as batch_op:
        batch_op.drop_constraint("fk_queue_items_download_job_id_download_jobs", type_="foreignkey")
        batch_op.create_foreign_key(
            "fk_queue_items_download_job_id_download_jobs",
            "download_jobs",
            ["download_job_id"],
            ["id"],
            ondelete="SET NULL",
        )
