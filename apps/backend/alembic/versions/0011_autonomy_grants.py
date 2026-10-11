"""autonomy grants: the (identity, action) grant ledger, created INERT

ADR 0008 (scoped autonomous execution) precondition 3, schema half only: autonomy is a grant,
never a switch - one row per (identity_type, identity_id, action) carrying the action class, the
daily cap and the enabled flag, administered by an admin in the backoffice. This migration creates
the table and nothing else: no production path can insert or enable a row (the grants UI is a
later job), `enabled` defaults false, and no code reads the table yet. It ships inert by design.

identity_id is deliberately NOT a foreign key: a grant's identity spans two parents (staff_users
for staff_user, agent_tokens for agent), and a single column cannot FK to both. Referential
meaning is enforced at the (later) authorisation path, not here.

Purely additive: autonomy_grants does not exist yet, and no existing table, constraint or default
is touched. The downgrade drops the table, verbatim-restoring the pre-0011 schema.
"""

from alembic import op

revision = "0011_autonomy_grants"
down_revision = "0010_agent_identity"
branch_labels = None
depends_on = None

SQL = """
CREATE TABLE IF NOT EXISTS autonomy_grants (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  identity_type TEXT NOT NULL CHECK (identity_type IN ('agent', 'staff_user')),
  identity_id BIGINT NOT NULL,
  action TEXT NOT NULL,
  action_class TEXT NOT NULL CHECK (action_class IN ('inventory', 'outward')),
  daily_cap INT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (identity_type, identity_id, action)
);
"""


def upgrade():
    op.execute(SQL)


def downgrade():
    op.execute("DROP TABLE IF EXISTS autonomy_grants;")
