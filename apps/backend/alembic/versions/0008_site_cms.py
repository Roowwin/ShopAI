"""site CMS: settings + product image/featured columns"""

revision = "0008"
down_revision = "0007_search_vectors"
branch_labels = None
depends_on = None

from alembic import op

SQL = """
CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT false;
"""

def upgrade():
    op.execute(SQL)

def downgrade():
    op.execute("DROP TABLE IF EXISTS site_settings;")
    op.execute("ALTER TABLE products DROP COLUMN IF EXISTS image_url;")
    op.execute("ALTER TABLE products DROP COLUMN IF EXISTS featured;")