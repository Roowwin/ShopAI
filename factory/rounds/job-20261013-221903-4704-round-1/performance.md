VERDICT: PASS

Fast-lane landing (owner directive).

- The register's new filters ride the existing query: an `EXISTS` over `users` on the invoice's own
  `customer_id`, and two range comparisons on `total_cents`. No join is added to the page query or
  the count, so both keep the same plan shape as before.
- The invoice DOCUMENT is four constant-scoped queries for ONE invoice (header, order, customer,
  lines), and is only reached by the print screen. The list endpoint is unchanged in cost, which is
  the point of keeping the document a separate read - a 50-row page still fetches 50 rows.
- `PATCH /expenses/{id}` is one indexed single-row UPDATE preceded by one single-row SELECT for the
  before-state; the audit row is the caller's, in the same transaction.
- The pages fetch once per filter change and re-read after a write; no polling. The P&L report's
  period picker is five client-side choices over one request, and the bars are divs - no chart
  library, no layout thrash.
- Gate: `pytest -q` with the documented deselects is **306 passed / 4 deselected / 0 failed** (301
  before this job, +5 new), with this tree mounted over the baked image. `npx tsc --noEmit` exit 0
  and `npx next build` exit 0, five new routes in the route list.
