"""allow album-scoped online library tracks

Revision ID: 20260708_0005
Revises: 20260708_0004
Create Date: 2026-07-08
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260708_0005"
down_revision: str | None = "20260708_0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("library_tracks", recreate="always") as batch_op:
        batch_op.drop_constraint("uq_library_tracks_source_external_id", type_="unique")
        batch_op.create_index("ix_library_tracks_source_external_id", ["source", "external_id"])


def downgrade() -> None:
    with op.batch_alter_table("library_tracks", recreate="always") as batch_op:
        batch_op.drop_index("ix_library_tracks_source_external_id")
        batch_op.create_unique_constraint("uq_library_tracks_source_external_id", ["source", "external_id"])
