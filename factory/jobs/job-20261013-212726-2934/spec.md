# Unified Shipping Path: one owner for fulfilment, labels and status

## Context

Three sessions built overlapping fulfilment surfaces. The owner's ruling: **`shipments` is the single
source of truth, and `staff_logistics.py` is the single rail.** Read
`docs/PROJECT_CONTEXT.md` standing rules, and the header comments of `staff_logistics.py`,
`staff_orders.py` and `services/carriers.py` before editing.

The current state, measured (not assumed):

* `staff_orders.py` ALREADY refuses `shipped`/`delivered` on its status door via `FULFILMENT_ELSEWHERE`
  (line 64), redirecting them by name to the rail. That half of the job is done - do not rebuild it,
  and do not weaken it.
* `staff_logistics.ship_order` (line 336) is the ONLY writer of `orders.status = 'shipped'` plus
  `shipped_at`, `carrier` and `tracking_number`, and it writes them in the SAME transaction as the
  `shipments` INSERT. Item 3 holds in code; this job makes it structural (below).
* THE GHOST DOOR: `GET /staff/orders/{order_id}/label` (`staff_orders.py:186`) prints a label by
  reading the DENORMALISED `orders.carrier` / `orders.tracking_number` mirror. It has no frontend
  caller, and its payload is a second answer to a question the rail owns.
* MY LAST JOB ADDED A FOURTH SURFACE: `api/v1/staff_shipping.py` (`/staff/shipping/{queue,carriers,
  orders/{id},orders/{id}/label}`) plus `services/carriers.py`. The queue/document/label routes must
  MOVE onto the rail. `services/carriers.py` itself stays where it is - it is a service, not a route.

## Deliverable

### A. `apps/backend/app/api/v1/staff_logistics.py` - the rail takes the whole surface
Move in from `staff_shipping.py`, keeping their behaviour and their tests' claims intact:
* `GET /staff/logistics/queue` - paid orders with no shipment, oldest first, each with its recipient
  address, lines and totals.
* `GET /staff/logistics/orders/{order_id}/fulfilment` - one order's fulfilment document (address,
  lines, totals, customer, and the `shipment` if one exists). Works BEFORE dispatch, which is what
  the packing slip needs.
* `POST /staff/logistics/orders/{order_id}/label` - book a carrier label (moved verbatim in intent).
  Refuses with the missing configuration named when the carrier is unconfigured, refuses a non-paid
  order (audited, because it is an act against a real order), and does NOT write a shipment row.
* `GET /staff/logistics/orders/{order_id}/label` - **the ghost door's replacement, with the same
  contract**, so removing the old path is a redirect rather than a loss: refused until the order has
  shipped or been delivered, then the payload a print page needs (carrier, tracking reference, the
  barcode value, the ship-to block, the declared value and currency). IT MUST READ THE `shipments`
  ROW, not `orders.carrier`/`tracking_number` - reading the mirror would be the same defect wearing
  the rail's address.
* `GET /staff/logistics/carriers` - MERGE, do not add a second path. The rail's existing endpoint
  answers "what has each carrier cost and how fast has it been"; `services/carriers.available(db)`
  answers "can a label be booked right now, and if not what is missing". One endpoint, both answers,
  under a key the UI can read.
* Move `_recipient`, `_lines`, `_order_columns` and the queue SQL in; do not copy them.

### B. Delete the duplicates
* Delete `apps/backend/app/api/v1/staff_shipping.py` and its `include_router` line. Nothing may
  remain registered under `/staff/shipping`.
* `staff_orders.py`: delete `GET /{order_id}/label`, and `LABEL_ROLES` / `ACTION_ORDER_LABEL` if
  nothing else uses them. Leave the order payload's `carrier`/`tracking_number`/`shipped_at` fields
  ALONE - they are the rail's denormalised mirror and other readers use them - but add a comment at
  the deletion point naming where the door went.
* `services/carriers.py` stays; the rail imports it.

### C. `apps/backend/alembic/versions/0020_shipping_single_owner.py` - item 3, structurally
A BEFORE UPDATE trigger on `orders` refusing to move a row INTO `shipped` unless a `shipments` row
for that order exists IN THE SAME TRANSACTION. Same-transaction visibility is the whole point: the
rail inserts the shipment and then updates the order, so the legal path passes, while any future
door that sets the status alone is refused by the database rather than by a convention. Refuse
`delivered` on the same terms. Downgrade drops the trigger and its function. `CREATE OR REPLACE`
style, idempotent, LF/no-BOM, and name the error message for the operator.
Do NOT change any existing table's columns and do NOT touch `0018`/`0019`.

### D. Tests
* `apps/backend/tests/test_fulfillment.py` - retarget every route to the rail's paths. Keep every
  existing claim (queue membership, the address on the payload, the three-role wall, the
  unconfigured-carrier refusal proving no shipment row and no audit row, the recorded request shape).
* ADD to it: the ghost door is GONE (`GET /staff/orders/{id}/label` is 404/405, and nothing under
  `/staff/shipping` answers at all); the unified label read is refused before dispatch and returns the
  SHIPMENT's carrier and tracking reference after; and the trigger refuses a bare
  `UPDATE orders SET status='shipped'` while the rail's own path succeeds.
* `apps/backend/tests/test_order_lifecycle.py` (a sibling's file) - its label call must follow the
  door to `/staff/logistics/orders/{id}/label`. Change ONLY that call and its comment; do not
  restructure that suite.

### E. Backoffice - point every call at the rail
* `app/admin/shipping/page.tsx`: queue, carriers and the label POST move to `/staff/logistics/...`,
  and the carrier picker reads the merged readiness block.
* `app/admin/orders/[id]/documents/page.tsx`: reads `/staff/logistics/orders/{id}/fulfilment`.
* `app/admin/orders/page.tsx`: the awaiting-fulfilment count moves to the rail's queue.
* No route under `/staff/shipping` may be called from anywhere in `apps/backoffice`.

## Acceptance
* Gate: `docker compose run --rm api pytest -q` with the accepted deselects, BEFORE and AFTER counts,
  NO NEW FAILURES, with THIS tree mounted over the baked image.
* `npx tsc --noEmit` and `npx next build` exit 0 from a NON-piped run; report the exit code.
* The migration applies AND downgrades clean.
* Prove from the DATABASE, not from a response: a shipped order has a shipment row whose carrier and
  tracking reference are the ones the order carries.
* `grep -rn "/staff/shipping" apps/` returns NOTHING.
* Live route check of the served Pick & Pack page after deploy.

## Constraints
- Work only on branch `factory/<job-id>`. LF / no BOM. No new dependency.
- Do NOT edit `services/logistics.py` (the engines), `0018_logistics.py` or `0019_commerce_finance.py`.
- `app/main.py` gets the removed `staff_shipping` import/registration and nothing else.
- Never fabricate a label or a tracking number - `services/carriers.py` refuses when unconfigured and
  that behaviour must survive the move.
