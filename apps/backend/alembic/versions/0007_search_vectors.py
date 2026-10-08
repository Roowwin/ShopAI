from alembic import op

revision = "0007_search_vectors"
down_revision = "0006_sale_price"
branch_labels = None
depends_on = None

SQL = """
ALTER TABLE products ADD COLUMN search_vec tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(model,''))) STORED;
CREATE INDEX products_vec_idx ON products USING GIN (search_vec);
ALTER TABLE assets ADD COLUMN search_vec tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(serial_number,'') || ' ' || coalesce(grade,''))) STORED;
CREATE INDEX assets_vec_idx ON assets USING GIN (search_vec);
"""

def upgrade():
    op.execute(SQL)

def downgrade():
    op.execute("DROP INDEX IF EXISTS assets_vec_idx;")
    op.execute("DROP INDEX IF EXISTS products_vec_idx;")
    op.execute("ALTER TABLE assets DROP COLUMN IF EXISTS search_vec;")
    op.execute("ALTER TABLE products DROP COLUMN IF EXISTS search_vec;")