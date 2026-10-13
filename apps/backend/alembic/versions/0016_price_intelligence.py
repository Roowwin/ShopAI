"""Smart pricing: the suggested price an import computes, kept on the unit it was computed for.

WHY A COLUMN AND NOT JUST A PREVIEW FIELD. The suggestion is produced during an import and read by
a person weeks later, in the Asset Workbench, when the unit is actually priced. A number that lives
only in the preview payload is gone the moment the operator closes the tab, which would leave the
bulk-intake flow - the one flow that produces hundreds of units at once - with an advisory that
evaporates before anyone can act on it. So the import writes what it computed.

THE SUGGESTION IS NOT THE PRICE. `sale_price_cents` remains the only field a listing is priced
from, and this migration does NOT touch it: `_run_import` never writes a price the sheet did not
carry (ADR 0006 - the confirm stays human). This column is a second opinion recorded beside the
unit, and `suggested_price_basis` records WHICH evidence produced it (`market` / `fmv` / `cost`),
because a number whose basis is lost cannot be argued with.

BOTH NULLABLE, and that is the honest state of most rows: a unit whose model and grade have no
priced comparables, and whose sheet carried neither FMV nor Settlement, has no suggestion at all.
A zero would be a price claim; NULL is the absence of one. The CHECK follows `assets_cost_cents_check`
- a negative suggestion is a broken computation, not a discount.

NO INDEX. Nothing filters or sorts by this column yet; the workbench reads it one unit at a time
from the row it is already fetching. A partial index on "suggested but unpriced" is the obvious
candidate the day a bulk-pricing screen wants it, and adding it now would be an index maintained on
every import for a query that does not exist.

NOT IN THE `excel_assets` VIEW. That view is the supplier workbook reflected 1:1 - twenty-six
columns, the sheet's own names, nothing added. This is the app's own column, not the supplier's, and
a twenty-seventh name in that view would make "SELECT * FROM excel_assets returns the workbook"
false in exactly the way 0015's comment promises it is not.
"""

from alembic import op

revision = "0016_price_intelligence"
down_revision = "0015_excel_foundation"
branch_labels = None
depends_on = None

COLUMNS = r'''
ALTER TABLE assets ADD COLUMN IF NOT EXISTS suggested_price_cents bigint;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS suggested_price_basis text;
'''

CHECK = r'''
ALTER TABLE assets ADD CONSTRAINT assets_suggested_price_cents_check
  CHECK (suggested_price_cents IS NULL OR suggested_price_cents >= 0);
'''

# A basis is one of four short words chosen by `services/pricing.py`, and the CHECK pins that set
# here rather than trusting every writer to spell them the same. It is deliberately loose in one
# direction: NULL is allowed, because a row with no suggestion has no basis.
BASIS_CHECK = r'''
ALTER TABLE assets ADD CONSTRAINT assets_suggested_price_basis_check
  CHECK (suggested_price_basis IS NULL
         OR suggested_price_basis IN ('market', 'fmv', 'cost', 'none'));
'''


def upgrade():
    op.execute(COLUMNS)
    op.execute(CHECK)
    op.execute(BASIS_CHECK)


def downgrade():
    op.execute("ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_suggested_price_basis_check;")
    op.execute("ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_suggested_price_cents_check;")
    op.execute("ALTER TABLE assets DROP COLUMN IF EXISTS suggested_price_cents, "
               "DROP COLUMN IF EXISTS suggested_price_basis;")
