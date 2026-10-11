"""newsletter: public subscriber table (additive only)"""

from alembic import op

revision = "0009_newsletter"
down_revision = "0008"
branch_labels = None
depends_on = None

SQL = """
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NULL
);
"""

def upgrade():
    op.execute(SQL)

def downgrade():
    op.execute("DROP TABLE IF EXISTS newsletter_subscribers;")
