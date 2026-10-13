"""returns and RMA: the request, its photographs, the decision, and the return label

WHY. There was no way for a customer to ask to send anything back. The storefront's Returns page
told them to email support and wait for a return authorisation - a human reading a mailbox and
replying by hand - and nothing in the platform recorded that a request existed, what it was for,
what the customer said, or what was decided. This is that record.

WHAT LANDS

  rma_requests   one row per return: which order, which customer, the reason (a CLOSED set - the
                 three the form offers), the customer's own words, and a status ladder that moves
                 pending -> info_requested/approved/denied -> received -> completed, plus the
                 decision's own record (who, when, and what they said).
  rma_photos     the defect photographs. The BYTES live in `media_objects` (0013), the same store
                 the asset gallery uses; this table only says which uploads belong to which
                 request, so one image store is repointed at a bucket rather than two.
  rma_number_seq the human-facing reference (RMA-2026-00001), year-prefixed like lot and invoice
                 numbers - it is what a customer quotes and what a parcel gets matched to.

THE RETURN LABEL IS RECORDED, NOT DELIVERED. Approving a request mints a carrier and a tracking
reference and stamps `label_issued_at`; there is no outbound carrier API and no mailer in this
platform (nothing in it has ever sent an email), so the label is a DOCUMENT the customer downloads
from their own request page. The columns are on the request rather than in a `labels` table because
a return has exactly one.

NO FOREIGN KEYS ON THE BUSINESS IDS, ON PURPOSE. Every suite's teardown ends with
`DELETE FROM orders ...` and `DELETE FROM users WHERE email LIKE '...'`, and an FK pointing at
either turns that cleanup into a foreign-key error - the failure that took the gate down when an
actor column was given an FK to staff_users. So `order_id`, `customer_id` and `decided_by` are bare
ids with an index, exactly like `stock_movements.actor_staff_id`. The one FK here is `rma_photos` ->
`rma_requests`, where BOTH sides are this migration's own and the cascade is the behaviour we want.

ADDITIVE AND IDEMPOTENT. Every statement is IF NOT EXISTS / DROP ... IF EXISTS + ADD, so a
hand-relaxed database re-runs this as a no-op rather than an error.
"""

from alembic import op

revision = "0021_returns_rma"
down_revision = "0020_shipping_single_owner"
branch_labels = None
depends_on = None

UP = """
-- ---------- the human-facing reference ----------
CREATE SEQUENCE IF NOT EXISTS rma_number_seq;

-- ---------- the request ----------
CREATE TABLE IF NOT EXISTS rma_requests (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  number TEXT NOT NULL UNIQUE,
  order_id BIGINT NOT NULL,                    -- bare id: see the FK note above
  customer_id BIGINT NULL,                     -- bare id
  email TEXT NOT NULL,
  -- The three reasons the form offers. A free-text reason would be a field nobody can report on.
  reason TEXT NOT NULL CHECK (reason IN ('defective','wrong_item','changed_mind')),
  detail TEXT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN
    ('pending','info_requested','approved','denied','received','completed','cancelled')),
  -- What was decided happens to the unit, which the restock half reads. Null until a decision.
  resolution TEXT NULL CHECK (resolution IN ('refund','replacement','repair','resale','scrap')),
  carrier TEXT NULL,
  tracking_ref TEXT NULL,
  label_issued_at TIMESTAMPTZ NULL,
  decided_by BIGINT NULL,                      -- bare id
  decided_at TIMESTAMPTZ NULL,
  decision_note TEXT NULL,
  received_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A label is a carrier AND a reference or it is neither; half a label is not printable.
  CONSTRAINT rma_label_pair_check CHECK ((carrier IS NULL) = (tracking_ref IS NULL)),
  -- A decision is recorded with who made it and when, or not at all.
  CONSTRAINT rma_decision_check CHECK ((decided_at IS NULL) = (decided_by IS NULL))
);
CREATE INDEX IF NOT EXISTS rma_status_idx ON rma_requests (status);
CREATE INDEX IF NOT EXISTS rma_order_idx ON rma_requests (order_id);
CREATE INDEX IF NOT EXISTS rma_email_idx ON rma_requests (lower(email));
DROP TRIGGER IF EXISTS trg_rma_requests_touch ON rma_requests;
CREATE TRIGGER trg_rma_requests_touch BEFORE UPDATE ON rma_requests
FOR EACH ROW EXECUTE FUNCTION rfo_touch_updated_at();

-- ---------- the photographs ----------
CREATE TABLE IF NOT EXISTS rma_photos (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rma_id BIGINT NOT NULL REFERENCES rma_requests(id) ON DELETE CASCADE,
  media_id BIGINT NOT NULL,                    -- bare id into media_objects
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT rma_photos_media_uniq UNIQUE (rma_id, media_id)
);
CREATE INDEX IF NOT EXISTS rma_photos_rma_idx ON rma_photos (rma_id, position, id);
"""

DOWN = """
DROP TABLE IF EXISTS rma_photos;
DROP TRIGGER IF EXISTS trg_rma_requests_touch ON rma_requests;
DROP TABLE IF EXISTS rma_requests;
DROP SEQUENCE IF EXISTS rma_number_seq;
"""


def upgrade():
    op.execute(UP)


def downgrade():
    op.execute(DOWN)
