VERDICT: PASS

Fast-lane landing (owner directive). Performance surface is small and bounded:

- `GET /staff/team` is one query over `staff_users` with a correlated subquery for the live-session
  count, on an index (`refresh_tokens_active_idx` is partial on exactly `(identity_type,
  identity_id) WHERE revoked_at IS NULL`). The roster is tens of rows.
- The three writes are single-row `UPDATE`s plus one `INSERT ... ON CONFLICT`, and the session
  revocation is one indexed `UPDATE`. No loop over rows, no N+1.
- The page fetches once on mount and re-reads after a successful mutation - the house pattern. No
  polling.
- The Import Center changes add no request: dropping a sheet issues exactly the same single
  `/staff/imports/products/preview` call the button did, and the new stat tiles read fields the
  server already returned.
- Gate: `pytest -q` with the documented deselects is 209 passed / 4 deselected / 0 failed, three
  consecutive runs, against this tree mounted over the baked image. `npx tsc --noEmit` exit 0 and
  `npx next build` exit 0 (17 routes, `/admin/team` present).
