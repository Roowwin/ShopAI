"""the order tax line may carry any rate the settings store holds

WHY. 0001 wrote the GST rates into the schema as literals: `order_tax_lines.rate_bp` carried
`CHECK (rate_bp IN (1000, 1500))`, and the jurisdiction was pinned to AU_GST/NZ_GST. That was fine
while `store_ops` also hardcoded the same two rates - the constraint and the code agreed because
neither could move. The Settings API makes the rate an operator-editable value, and the moment it
does, that CHECK becomes a landmine: a rate the operator stores is a rate the next checkout writes
to this table, and any value outside {1000, 1500} turns a valid sale into a 409.

So the constraint is widened to the range the settings validator already enforces in Python
(0..10000 basis points, i.e. 0..100%). The jurisdiction CHECK is deliberately LEFT ALONE: the
settings validator only ever stores an `AU_GST`/`NZ_GST`-shaped label, so the two agree - and if a
future jurisdiction ever needs adding, that is a migration with a real decision behind it, not a
loosening done blind here.

The two DDL statements are idempotent (`DROP ... IF EXISTS` then `ADD`), so applying this against a
database where the constraint has already been relaxed by hand is a no-op rather than an error.

THE REVISION CHAIN. This was written as `0016_settings_api` with parent `0015_excel_foundation`,
alongside a concurrent `0016_price_intelligence` with the same parent - two heads, which alembic
refuses to upgrade past. That revision has since landed, so this is reparented onto it and renamed
`0017_settings_api`, giving one linear chain: 0015 -> 0016_price_intelligence -> 0017_settings_api.
"""

from alembic import op

revision = "0017_settings_api"
down_revision = "0016_price_intelligence"
branch_labels = None
depends_on = None

UP = """
ALTER TABLE order_tax_lines DROP CONSTRAINT IF EXISTS order_tax_lines_rate_bp_check;
ALTER TABLE order_tax_lines ADD CONSTRAINT order_tax_lines_rate_bp_check
  CHECK (rate_bp >= 0 AND rate_bp <= 10000);
"""

DOWN = """
ALTER TABLE order_tax_lines DROP CONSTRAINT IF EXISTS order_tax_lines_rate_bp_check;
ALTER TABLE order_tax_lines ADD CONSTRAINT order_tax_lines_rate_bp_check
  CHECK (rate_bp IN (1000, 1500));
"""


def upgrade():
    op.execute(UP)


def downgrade():
    op.execute(DOWN)
