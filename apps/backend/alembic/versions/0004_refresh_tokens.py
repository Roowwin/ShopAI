from alembic import op

revision = "0004_refresh_tokens"
down_revision = "0003_lots"
branch_labels = None
depends_on = None

SQL = """
CREATE TABLE refresh_tokens (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  identity_type TEXT NOT NULL CHECK (identity_type IN ('staff','customer')),
  identity_id BIGINT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_identity_idx ON refresh_tokens (identity_type, identity_id);
CREATE INDEX refresh_tokens_active_idx ON refresh_tokens (identity_type, identity_id) WHERE revoked_at IS NULL;
"""

def upgrade():
    op.execute(SQL)

def downgrade():
    op.execute("DROP TABLE refresh_tokens;")