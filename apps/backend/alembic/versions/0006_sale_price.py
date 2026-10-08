from alembic import op

revision = "0006_sale_price"
down_revision = "0005_lot_number_seq"
branch_labels = None
depends_on = None

SQL = """
ALTER TABLE assets ADD COLUMN sale_price_cents BIGINT NULL;
UPDATE assets SET sale_price_cents =
  CASE
    WHEN product_id = (SELECT id FROM products WHERE slug = 'iphone-13') THEN 34900
    ELSE 27900
  END
WHERE status = 'listed' AND sale_price_cents IS NULL;
ALTER TABLE assets ADD CONSTRAINT chk_listed_has_price CHECK (status <> 'listed' OR sale_price_cents IS NOT NULL);
"""

def upgrade():
    op.execute(SQL)

def downgrade():
    op.execute("ALTER TABLE assets DROP CONSTRAINT IF EXISTS chk_listed_has_price;")
    op.execute("ALTER TABLE assets DROP COLUMN IF EXISTS sale_price_cents;")