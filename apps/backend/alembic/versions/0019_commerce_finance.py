"""commerce and finance: the order lifecycle's timestamps, the payment event log, invoices, expenses

WHY. Three things the schema promised and nothing implemented. `orders.status` has carried
pending/paid/shipped/delivered/cancelled/refunded since 0001, but no column recorded WHEN an order
was paid or shipped and no door could move it past `paid`. `payments` recorded a provider reference
and nothing else - no method, no failure reason, no refunded amount, and nowhere to write the
provider's own events, so a replayed webhook could only be caught by reading the payment row back.
And there was no ledger at all: revenue and cost lived in `orders` and `assets.cost_cents` with no
invoice and no expense to net against them.

WHAT LANDS

  orders          paid_at / shipped_at / delivered_at / cancelled_at, carrier, tracking_number.
                  Fulfilment needs to say WHEN and WITH WHOM, and `updated_at` (which the touch
                  trigger moves on every edit) cannot answer either question.
  payments        updated_at, method, failure_reason, refunded_cents - the refund side of a payment,
                  which the status enum already claimed but nothing could record.
  payment_events  the provider's own events, keyed UNIQUE(provider, event_id). This is what makes a
                  webhook idempotent at the SOURCE rather than by inferring from the payment row:
                  the same event delivered twice is one row, and the second insert conflicts.
  invoices        one per order (UNIQUE order_id), ex-GST subtotal, GST, total, status.
  expenses        what was paid out, by category and date.
  invoice_number_seq  the human-facing document number, year-prefixed like lot_number_seq (0005).

NO FOREIGN KEYS ON THE NEW TABLES, ON PURPOSE. Every suite's teardown runs `DELETE FROM orders ...`
and `DELETE FROM users WHERE email LIKE 'pytest-%'`, and an FK pointing at either turns that cleanup
into a foreign-key error - the same failure that took the gate down when an actor column was given
an FK to staff_users. So `invoices.order_id`, `invoices.customer_id`, `expenses.created_by` and
`payment_events.payment_id`/`order_id` are bare ids with an index, exactly like
`stock_movements.actor_staff_id`. The uniqueness that matters (one invoice per order) is kept as a
UNIQUE CONSTRAINT on the column, which needs no FK to hold.

GST IS NOT REVENUE. `invoices.subtotal_cents` is the ex-GST amount and `tax_cents` is the GST
collected on the tax authority's behalf; the P&L nets the first and reports the second separately.
Adding them into "revenue" would overstate profit by the tax rate.

A NOTE ON THE REVISION CHAIN. The next free number when this was written was 0018, but a concurrent job claimed `0018_logistics` and had ALREADY APPLIED it to the shared database by the time this was checked, so this is 0019 parented onto that revision rather than a second head hanging off 0017. If 0018_logistics is ever not present in the tree this lands in, reparent this file to 0017_settings_api - alembic will refuse to build a history with a missing parent, which is the loud failure and not the quiet one.

ADDITIVE AND IDEMPOTENT. Every statement is IF NOT EXISTS / DROP CONSTRAINT IF EXISTS + ADD, so a
hand-relaxed database re-runs this as a no-op rather than an error.
"""

from alembic import op

revision = "0019_commerce_finance"
down_revision = "0018_logistics"
branch_labels = None
depends_on = None

UP = """
-- ---------- orders: when, and with whom ----------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at      TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipped_at   TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS carrier        TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_number TEXT;

-- ---------- payments: the refund side ----------
ALTER TABLE payments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE payments ADD COLUMN IF NOT EXISTS method TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS failure_reason TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS refunded_cents BIGINT NOT NULL DEFAULT 0;
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_refunded_check;
ALTER TABLE payments ADD CONSTRAINT payments_refunded_check
  CHECK (refunded_cents >= 0 AND refunded_cents <= amount_cents);

-- ---------- the provider's own events (webhook idempotency at the source) ----------
CREATE TABLE IF NOT EXISTS payment_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payment_id BIGINT NULL,
  order_id BIGINT NULL,
  amount_cents BIGINT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT payment_events_provider_event_uniq UNIQUE (provider, event_id)
);
CREATE INDEX IF NOT EXISTS payment_events_payment_idx ON payment_events (payment_id);
CREATE INDEX IF NOT EXISTS payment_events_order_idx ON payment_events (order_id);

-- ---------- the ledger ----------
CREATE SEQUENCE IF NOT EXISTS invoice_number_seq;

CREATE TABLE IF NOT EXISTS invoices (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  number TEXT NOT NULL UNIQUE,
  order_id BIGINT NULL UNIQUE,          -- bare id: see the FK note above
  customer_id BIGINT NULL,
  status TEXT NOT NULL DEFAULT 'issued'
    CHECK (status IN ('draft','issued','paid','void')),
  currency CHAR(3) NOT NULL DEFAULT 'AUD' CHECK (currency = 'AUD'),
  subtotal_cents BIGINT NOT NULL CHECK (subtotal_cents >= 0),
  tax_cents BIGINT NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  shipping_cents BIGINT NOT NULL DEFAULT 0 CHECK (shipping_cents >= 0),
  total_cents BIGINT NOT NULL CHECK (total_cents >= 0),
  issued_on DATE NOT NULL DEFAULT CURRENT_DATE,
  due_on DATE NULL,
  paid_at TIMESTAMPTZ NULL,
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (total_cents = subtotal_cents + tax_cents + shipping_cents)
);
CREATE INDEX IF NOT EXISTS invoices_issued_idx ON invoices (issued_on);
CREATE INDEX IF NOT EXISTS invoices_status_idx ON invoices (status);
DROP TRIGGER IF EXISTS trg_invoices_touch ON invoices;
CREATE TRIGGER trg_invoices_touch BEFORE UPDATE ON invoices
FOR EACH ROW EXECUTE FUNCTION rfo_touch_updated_at();

CREATE TABLE IF NOT EXISTS expenses (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  category TEXT NOT NULL,
  vendor TEXT NULL,
  description TEXT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents >= 0),
  tax_cents BIGINT NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  incurred_on DATE NOT NULL DEFAULT CURRENT_DATE,
  paid_at TIMESTAMPTZ NULL,
  created_by BIGINT NULL,               -- bare id: see the FK note above
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS expenses_incurred_idx ON expenses (incurred_on);
CREATE INDEX IF NOT EXISTS expenses_category_idx ON expenses (category);
DROP TRIGGER IF EXISTS trg_expenses_touch ON expenses;
CREATE TRIGGER trg_expenses_touch BEFORE UPDATE ON expenses
FOR EACH ROW EXECUTE FUNCTION rfo_touch_updated_at();
"""

DOWN = """
DROP TRIGGER IF EXISTS trg_expenses_touch ON expenses;
DROP TRIGGER IF EXISTS trg_invoices_touch ON invoices;
DROP TABLE IF EXISTS expenses;
DROP TABLE IF EXISTS invoices;
DROP SEQUENCE IF EXISTS invoice_number_seq;
DROP TABLE IF EXISTS payment_events;
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_refunded_check;
ALTER TABLE payments DROP COLUMN IF EXISTS refunded_cents;
ALTER TABLE payments DROP COLUMN IF EXISTS failure_reason;
ALTER TABLE payments DROP COLUMN IF EXISTS method;
ALTER TABLE payments DROP COLUMN IF EXISTS updated_at;
ALTER TABLE orders DROP COLUMN IF EXISTS tracking_number;
ALTER TABLE orders DROP COLUMN IF EXISTS carrier;
ALTER TABLE orders DROP COLUMN IF EXISTS cancelled_at;
ALTER TABLE orders DROP COLUMN IF EXISTS delivered_at;
ALTER TABLE orders DROP COLUMN IF EXISTS shipped_at;
ALTER TABLE orders DROP COLUMN IF EXISTS paid_at;
"""


def upgrade():
    op.execute(UP)


def downgrade():
    op.execute(DOWN)
