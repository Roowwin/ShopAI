"""assets: listed -> graded, so a unit can be taken off the storefront

WHY. The grading workbench's Listing column has to be able to UNLIST a unit, and nothing could:
`rfo_assets_check_status` admitted only `listed -> reserved | sold | scrapped` out of the listed
state, and none of those three means "take it off the shop floor". A reservation is a customer
holding the unit, a sale is a sale, and scrapping is scrapping - unlisting is none of them, and
writing one of those statuses to mean it would corrupt the meaning of a column somebody else reads.

The storefront's own predicate is `status = 'listed'` AND an active lot AND an active product
(`store_catalog.py`), so the ONLY lever that hides one unit while leaving its neighbours on the
shelf is that unit's status. There is no visibility flag to flip: `assets.on_shelf` exists but is the
SUPPLIER's own workbook column ("On Shelf" off the Excel sheet), written by the importer and read
nowhere in the shop - and a re-import overwrites it, so it cannot hold a shop decision.

WHAT THIS OPENS, AND WHAT IT DELIBERATELY DOES NOT. Exactly one new pair: `listed -> graded`. A
listed unit goes back to graded, where it keeps its grade and its price, and the same button that
listed it can list it again.

It does NOT open `listed -> tested` or any other downward edge. The note in `staff_ops.py` that a
withdrawn grade cannot move the status down - which is why "awaiting a grade" is `grade IS NULL AND
status IN (...)` rather than a status test - remains exactly as true after this as before it.

A BODY IS REPLACED WHOLE, not patched: it is one plpgsql function and there is no partial edit for
it. `CREATE OR REPLACE` keeps the existing `trg_assets_status` bound to the function, so the trigger
itself is untouched. The list below is the body 0001_initial.py wrote, with one pair added and
nothing else moved - so the DOWN is that same body minus the pair, and a database that has never run
this migration re-runs it as a no-op.
"""

from alembic import op

revision = "0023_unlist_edge"
down_revision = "0022_order_channel"
branch_labels = None
depends_on = None

UP = r"""
CREATE OR REPLACE FUNCTION rfo_assets_check_status() RETURNS trigger AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF (OLD.status, NEW.status) IN (
        ('received','tested'),('received','scrapped'),
        ('tested','in_repair'),('tested','graded'),('tested','scrapped'),
        ('in_repair','tested'),('in_repair','graded'),('in_repair','scrapped'),
        ('graded','listed'),('graded','scrapped'),
        ('listed','graded'),('listed','reserved'),('listed','sold'),('listed','scrapped'),
        ('reserved','sold'),('reserved','listed'),
        ('sold','shipped'),('sold','returned'),
        ('shipped','returned'),
        ('returned','tested'),('returned','scrapped')) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'illegal asset transition % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
"""

# The body as 0001_initial.py left it. Removing the edge does not disturb any existing row - the
# function polices TRANSITIONS, and no row's current status is re-checked against it - which is why
# this DOWN is safe to run on a database holding units that were unlisted through the new pair.
DOWN = r"""
CREATE OR REPLACE FUNCTION rfo_assets_check_status() RETURNS trigger AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF (OLD.status, NEW.status) IN (
        ('received','tested'),('received','scrapped'),
        ('tested','in_repair'),('tested','graded'),('tested','scrapped'),
        ('in_repair','tested'),('in_repair','graded'),('in_repair','scrapped'),
        ('graded','listed'),('graded','scrapped'),
        ('listed','reserved'),('listed','sold'),('listed','scrapped'),
        ('reserved','sold'),('reserved','listed'),
        ('sold','shipped'),('sold','returned'),
        ('shipped','returned'),
        ('returned','tested'),('returned','scrapped')) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'illegal asset transition % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
"""


def upgrade():
    op.execute(UP)


def downgrade():
    op.execute(DOWN)
