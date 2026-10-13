"""reports: the sales CHANNEL an order arrived through

WHY. The Reporting module filters sales by channel - Storefront, eBay, Amazon - and `orders` had no
column that could answer it. Every order this platform has ever taken came through its own storefront,
so the column is added with that as the default and every existing row backfills to it in the same
statement; the two marketplace values are admitted by the CHECK and are simply EMPTY, because nothing
ingests marketplace sales yet. That is the honest shape: a filter that offers three channels and
returns rows for one of them is a filter that works, whereas a filter derived from nothing would be
a control that lies.

WHY NOT INFER IT. There is no field on an order that says "eBay" - not the shipping address, not the
customer, not the payment provider. Inferring a channel would be inventing data, which is worse on a
report than a column that is usually the same value.

ADDITIVE AND IDEMPOTENT. IF NOT EXISTS / DROP CONSTRAINT IF EXISTS + ADD, so a hand-relaxed database
re-runs this as a no-op rather than an error.
"""

from alembic import op

revision = "0022_order_channel"
down_revision = "0021_returns_rma"
branch_labels = None
depends_on = None

UP = """
ALTER TABLE orders ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'storefront';
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_channel_check;
ALTER TABLE orders ADD CONSTRAINT orders_channel_check
  CHECK (channel IN ('storefront','ebay','amazon'));
CREATE INDEX IF NOT EXISTS orders_channel_idx ON orders (channel);
-- The trends report buckets by day over `placed_at`, which had no index of its own.
CREATE INDEX IF NOT EXISTS orders_placed_idx ON orders (placed_at);
"""

DOWN = """
DROP INDEX IF EXISTS orders_placed_idx;
DROP INDEX IF EXISTS orders_channel_idx;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_channel_check;
ALTER TABLE orders DROP COLUMN IF EXISTS channel;
"""


def upgrade():
    op.execute(UP)


def downgrade():
    op.execute(DOWN)
