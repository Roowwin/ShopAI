VERDICT: PASS

Fast-lane landing (owner directive). The performance surface is small and bounded:

- `GET /staff/shipping/queue`: one `count(*)` and one page query over `orders` with an
  `NOT EXISTS` against `shipments` (whose `order_id` is UNIQUE, so the anti-join cannot multiply a
  row), then ONE lines query for the whole page keyed by `ANY(:ids)`. Three queries per page
  regardless of order count - no N+1.
- `GET /staff/shipping/orders/{id}`: three single-row/scoped queries (order, its lines, its
  shipment) plus one email lookup. Constant.
- `POST .../label` is dominated by the carrier call, which is bounded by a 30s timeout on both the
  create and the label fetch. The client is created per booking and closed in a `finally`, so a
  failed booking cannot leak a connection pool.
- The Pick & Pack page fetches the queue and the carrier list in one `Promise.all` and re-reads only
  after a successful dispatch; no polling. The Orders page's new tile costs one `limit=1` request.
- Gate: `pytest -q` with the documented deselects is **266 passed / 4 deselected / 0 failed** on the
  merged tree, with this tree mounted over the baked image (a sibling session rebuilds the shared
  `rfo-api` tag, so an unmounted run tests their code and its counts drift - the reason for the
  mount). `npx tsc --noEmit` exit 0 and `npx next build` exit 0, both new routes in the route list.
