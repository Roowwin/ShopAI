"""agent identity: admit 'agent' to three CHECKs; add agent_tokens

ADR 0007 decisions 1 and 2: an agent is a first-class identity class (a service principal, named
per instance, created/rotated/revoked by an admin in the backoffice only) whose credential is a
rotatable, revocable, expiring scoped token rather than a staff password + TOTP. This migration is
the schema half of the identity plumbing and nothing else.

The three CHECK constraints are auto-named by Postgres from the inline CHECKs in 0001_initial and
0004_refresh_tokens. Each is dropped BY ITS EXACT NAME and re-added with EVERY original value plus
'agent' - a re-ADD that forgot an original value would silently reject rows that are already in the
table, so the widened definition is a superset of the old one, never a replacement. The downgrade
restores the three original definitions verbatim.

agent_tokens does not exist yet; it is purely additive.
"""

from alembic import op

revision = "0010_agent_identity"
down_revision = "0009_newsletter"
branch_labels = None
depends_on = None

# Widen: drop by exact name, re-ADD as old values + 'agent'.
WIDEN = """
ALTER TABLE staff_users DROP CONSTRAINT IF EXISTS staff_users_role_check;
ALTER TABLE staff_users ADD CONSTRAINT staff_users_role_check
  CHECK (role IN ('admin','manager','technician','warehouse','sales','agent'));

ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_actor_type_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_actor_type_check
  CHECK (actor_type IN ('staff','system','customer','agent'));

ALTER TABLE refresh_tokens DROP CONSTRAINT IF EXISTS refresh_tokens_identity_type_check;
ALTER TABLE refresh_tokens ADD CONSTRAINT refresh_tokens_identity_type_check
  CHECK (identity_type IN ('staff','customer','agent'));
"""

# The identity row itself. token_hash is a SHA-256 of the plaintext, the same treatment
# refresh_tokens takes; the plaintext is never stored. scopes is reserved for the autonomy job
# (ADR 0008) and defaults to empty - nothing in this job reads it.
CREATE_AGENT_TOKENS = """
CREATE TABLE IF NOT EXISTS agent_tokens (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  staff_id BIGINT NOT NULL REFERENCES staff_users(id),
  token_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_tokens_staff_idx ON agent_tokens (staff_id);
"""

# Restore the pre-0010 definitions exactly (the values 0001_initial and 0004_refresh_tokens
# created). Narrowing back fails if an agent row exists - that is the intended signal that the
# data must be dealt with before the identity class is withdrawn.
NARROW = """
ALTER TABLE staff_users DROP CONSTRAINT IF EXISTS staff_users_role_check;
ALTER TABLE staff_users ADD CONSTRAINT staff_users_role_check
  CHECK (role IN ('admin','manager','technician','warehouse','sales'));

ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_actor_type_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_actor_type_check
  CHECK (actor_type IN ('staff','system','customer'));

ALTER TABLE refresh_tokens DROP CONSTRAINT IF EXISTS refresh_tokens_identity_type_check;
ALTER TABLE refresh_tokens ADD CONSTRAINT refresh_tokens_identity_type_check
  CHECK (identity_type IN ('staff','customer'));
"""


def upgrade():
    op.execute(WIDEN)
    op.execute(CREATE_AGENT_TOKENS)


def downgrade():
    op.execute("DROP TABLE IF EXISTS agent_tokens;")
    op.execute(NARROW)
