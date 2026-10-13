VERDICT: PASS

Fast-lane landing (owner directive). The move is performance-neutral by construction, and the one
new check is cheap:

- The moved reads keep their shapes: `GET /staff/logistics/queue` is one `count(*)` plus one page
  query plus ONE lines query for the whole page (`ANY(:ids)`), and the fulfilment document is four
  constant-scoped queries. No N+1 was introduced by the move.
- The label read adds one `LEFT JOIN shipments` on a UNIQUE-indexed `order_id` - a single-row
  lookup - and the fulfilment document's shipment lookup reuses the existing `_shipment_payload`
  rather than adding a second query shape.
- The trigger fires `BEFORE INSERT OR UPDATE OF status` only, so ordinary updates that do not touch
  `status` are not gated at all, and the `NOT EXISTS` it runs is an index probe on
  `shipments.order_id` (UNIQUE). It is on the write path of a dispatch, which is a manual act
  measured in presses per hour, not a hot loop.
- `/carriers` gains one extra `carriers.available(db)` call, which is pure environment and settings
  reads with no query of its own.
- Gate: `pytest -q` with the documented deselects is **301 passed / 4 deselected / 0 failed**, with
  this tree mounted over the baked image. `npx tsc --noEmit` exit 0 and `npx next build` exit 0,
  both routes present.
