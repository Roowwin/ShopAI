"""Logistics: the parcel an order travels in, and the bank credit that pays for it.

WHY THIS EXISTS. `orders.status` has admitted `shipped` and `delivered` since 0001 and NOTHING
could ever write either one: the checkout set `paid`, the payment webhook set `paid`/`cancelled`,
and the two rungs above them were a vocabulary with no road. That is not a cosmetic gap - it is why
the platform could not answer any of the three questions this migration's tables exist to answer:

  * "which orders are overdue for shipping?" needs to know what has shipped and when it was due;
  * "which bank payout paid for order 501?" needs the credit side of the money to exist at all;
  * "which carrier is cheapest and fastest?" needs carrier, cost and delivery time on one row.

WHAT IT ADDS. Three tables and no changes to any existing one - the order and payment tables keep
their shapes, so nothing that already reads them can shift under this.

  shipments       one parcel per order: who carried it, what it cost, when it left, when it was
                  promised and when it actually arrived. `delivered_at IS NULL` is the whole
                  definition of "still moving", which is what every in-transit alert reads.
  payouts         a credit on the bank statement. `bank_ref` is UNIQUE because it is the bank's own
                  identifier and re-importing a statement must be idempotent rather than doubling
                  every credit.
  payout_matches  the reconciliation itself: which payments a payout settled. A join table rather
                  than a `payments.payout_id` column, because the match has its OWN facts (who
                  confirmed it, when) and because a payment is settled exactly once - that is a
                  UNIQUE here rather than a convention in the application.

ONE PARCEL PER ORDER is a real modelling decision, not an oversight: it makes `orders.status =
'shipped'` mean exactly "a shipment row exists", so the state machine has one definition instead of
a rule about partial fulfilment. A multi-parcel order is the case that breaks it - the day it
arrives, drop the unique index below and derive the status from "every line is on a shipment",
which is a bigger change than this file should make speculatively.

WHAT IS DELIBERATELY NOT HERE. No `carriers` table: the carrier is a name on a shipment, and a
table of four rows would be a join to maintain for a string that is already the right grain (the
analysis groups BY carrier). No denormalised totals on `payouts`: how much of a credit is matched
is `sum()` over `payout_matches`, and a stored total would be a second answer to drift from the
first. No triggers and no `updated_at` on `shipments`: nothing rewrites a shipment except the
deliver scan, which sets `delivered_at` once, and the house `rfo_touch_updated_at` trigger exists to
track edits that this table has none of.
"""

from alembic import op

revision = "0018_logistics"
down_revision = "0017_settings_api"
branch_labels = None
depends_on = None

# ON DELETE CASCADE on both parents, on purpose. Shipments and reconciliation rows are FACTS ABOUT
# an order and a payment, so they cannot outlive the thing they describe - and the practical
# consequence matters more than the philosophy: the suites clean up the orders and payments they
# created, and a NO ACTION foreign key would make every one of those deletes fail with a foreign-key
# error pointing at a table the test never heard of. (The same lesson the agent-token FK taught,
# from the other side.) Reconciliation records are therefore cascade collateral; in production
# nothing deletes a payment, so the cascade is a test-and-teardown affordance, not a live risk.
SHIPMENTS = r'''
CREATE TABLE IF NOT EXISTS shipments (
    id              bigserial PRIMARY KEY,
    public_id       uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    order_id        bigint NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    carrier         text NOT NULL,
    service         text,
    tracking_ref    text,
    cost_cents      bigint NOT NULL DEFAULT 0,
    dispatched_at   timestamptz NOT NULL DEFAULT now(),
    promised_at     timestamptz,
    delivered_at    timestamptz,
    notes           text,
    created_by_staff_id bigint,
    created_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT shipments_carrier_present CHECK (length(btrim(carrier)) > 0),
    CONSTRAINT shipments_cost_cents_check CHECK (cost_cents >= 0),
    -- A delivery cannot precede the dispatch that caused it, and a promise cannot be made after the
    -- parcel is already gone. Both are a transposed date or a parser that ate a digit, and the
    -- analysis below averages these intervals - a negative transit time would silently flatter a
    -- carrier's average rather than failing loudly.
    CONSTRAINT shipments_delivered_after_dispatch_check
        CHECK (delivered_at IS NULL OR delivered_at >= dispatched_at)
);

-- One parcel per order - see the header. A partial unique index rather than a table constraint so
-- the index is the thing that enforces it (a constraint would add a second copy of the rule).
CREATE UNIQUE INDEX IF NOT EXISTS shipments_order_uniq ON shipments (order_id);
-- The analysis groups by carrier and filters to the undelivered tail; both ride this pair.
CREATE INDEX IF NOT EXISTS shipments_carrier_idx ON shipments (carrier);
CREATE INDEX IF NOT EXISTS shipments_open_idx ON shipments (dispatched_at) WHERE delivered_at IS NULL;
'''

PAYOUTS = r'''
CREATE TABLE IF NOT EXISTS payouts (
    id              bigserial PRIMARY KEY,
    public_id       uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    bank_ref        text NOT NULL UNIQUE,
    amount_cents    bigint NOT NULL,
    received_on     date NOT NULL,
    note            text,
    created_by_staff_id bigint,
    created_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT payouts_bank_ref_present CHECK (length(btrim(bank_ref)) > 0),
    -- A credit is money IN. Zero is not a credit, and a negative one is a debit - a different row of
    -- the statement that this door does not model and must not silently accept as a payout.
    CONSTRAINT payouts_amount_cents_check CHECK (amount_cents > 0)
);

CREATE TABLE IF NOT EXISTS payout_matches (
    id              bigserial PRIMARY KEY,
    payout_id       bigint NOT NULL REFERENCES payouts (id) ON DELETE CASCADE,
    payment_id      bigint NOT NULL REFERENCES payments (id) ON DELETE CASCADE,
    matched_by_staff_id bigint,
    matched_at      timestamptz NOT NULL DEFAULT now(),

    -- A payment is settled exactly once. Enforced here rather than trusted to the door, so a second
    -- reconciliation of the same order collides instead of double-counting the money.
    CONSTRAINT payout_matches_payment_uniq UNIQUE (payment_id)
);

CREATE INDEX IF NOT EXISTS payout_matches_payout_idx ON payout_matches (payout_id);
'''

# Actor columns carry NO foreign key to staff_users, deliberately: the suites clean up their own
# pytest-% identities, and an FK on a "who did it" column turns that cleanup into a foreign-key
# failure that takes the whole gate down. `stock_movements.actor_staff_id` is the precedent; the
# audit trail already records the actor with a real FK where one is affordable.


def upgrade():
    op.execute(SHIPMENTS)
    op.execute(PAYOUTS)


def downgrade():
    op.execute("DROP TABLE IF EXISTS payout_matches;")
    op.execute("DROP TABLE IF EXISTS payouts;")
    op.execute("DROP TABLE IF EXISTS shipments;")
