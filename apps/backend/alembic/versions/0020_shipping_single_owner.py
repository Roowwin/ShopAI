"""One owner for fulfilment: an order cannot be `shipped` without a parcel to point at.

THE HOLE THIS CLOSES. `orders.status` admits `shipped` and `delivered`, and `shipments` is the table
that says a parcel actually exists - but nothing in the database connected the two. Three sessions
grew three different ways to move an order into `shipped`, one of which wrote `orders.carrier` and
`orders.tracking_number` and no shipment row at all, and the platform ended up with orders that
claimed to be dispatched while the logistics rail could not see them: absent from the in-transit
alerts, absent from carrier performance, invisible to reconciliation. That is not a cosmetic split.
An order marked shipped with no parcel is an order nobody will ever chase.

WHY A TRIGGER AND NOT A CONSTRAINT. This is a claim about a row in ANOTHER table, and a CHECK
constraint cannot look at one. A trigger can, and it can do it with SAME-TRANSACTION visibility -
which is the whole design: the rail inserts the `shipments` row and then moves the order, in one
transaction, so the legal path sees its own uncommitted parcel and passes. Any other door that sets
the status alone is refused by the database rather than by a convention that the next feature is
free to forget. The app-level guard would have been one more thing to remember; this is one fewer.

DELIBERATELY NOT A TRIGGER ON `shipments`. The obvious alternative - refuse a shipment for an order
that is not paid - would have to be duplicated in the deliver path and would break the reprint and
correction flows that legitimately touch a parcel without moving the order. The rule being encoded
here is narrow and worth it: THE STATUS MAY NOT ASSERT A PARCEL THAT DOES NOT EXIST.

WHAT IT DOES NOT TOUCH. No column is added, changed or dropped; `orders.carrier` /
`tracking_number` / `shipped_at` stay exactly as they are, because they are the rail's denormalised
mirror and a dozen readers use them. This migration only refuses an INCONSISTENT write to `status`.

`delivered` is included on the same terms and for the same reason: a parcel cannot arrive without
having been sent.
"""

from alembic import op

revision = "0020_shipping_single_owner"
down_revision = "0019_commerce_finance"
branch_labels = None
depends_on = None

# The message is written for the operator who hits it, not for a log: it names what to do instead of
# what went wrong, because the only legitimate way to reach this error is a door that should not have
# existed.
FUNCTION = r'''
CREATE OR REPLACE FUNCTION rfo_order_shipped_needs_shipment() RETURNS trigger AS $$
BEGIN
  IF NEW.status IN ('shipped', 'delivered')
     AND (TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status)
     AND NOT EXISTS (SELECT 1 FROM shipments s WHERE s.order_id = NEW.id) THEN
    RAISE EXCEPTION
      'order % cannot be % without a shipments row: record the parcel with '
      'POST /staff/logistics/orders/{id}/ship first', NEW.id, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
'''

TRIGGER = r'''
DROP TRIGGER IF EXISTS trg_order_shipped_needs_shipment ON orders;
CREATE TRIGGER trg_order_shipped_needs_shipment
  BEFORE INSERT OR UPDATE OF status ON orders
  FOR EACH ROW EXECUTE FUNCTION rfo_order_shipped_needs_shipment();
'''


def upgrade():
    op.execute(FUNCTION)
    op.execute(TRIGGER)


def downgrade():
    op.execute("DROP TRIGGER IF EXISTS trg_order_shipped_needs_shipment ON orders;")
    op.execute("DROP FUNCTION IF EXISTS rfo_order_shipped_needs_shipment();")
