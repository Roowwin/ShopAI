# backend+backoffice: GET /staff/overview and the admin dashboard

## Context
`/admin` is not a dashboard: `apps/backoffice/app/admin/page.tsx` renders an email, a role pill, two links and a Sign out button. This job adds the read-only endpoint and the page that makes it a real staff overview. It is the first consumer of the design system merged in `apps/backoffice/app/components/ui/` (Card, Badge, Stat, Table, Button, Heading) and of `lib/ui.ts`'s tone maps - use them; do not hand-roll cards.

## Deliverable

### 1. `apps/backend/app/api/v1/staff_overview.py` (new) - ONE endpoint
`GET /staff/overview`, `staff: dict = Depends(require_roles("admin","manager"))`, `db=Depends(get_db)`.
One endpoint, not several: one screen, one guarded surface, no request waterfall.

**Use the app DB (`get_db`), NOT the `ai.*` views.** The views' DDL exists nowhere in version control (only consumers appear in the repo), so a user-facing page must not depend on unversioned DB state. `rfo_app` reads the base tables directly.

Response shape (exact keys):
```jsonc
{
  "generated_at": "<iso8601>",
  "inventory": {
    "by_status": {"received": 12, "tested": 4, "in_repair": 1, "graded": 8, "listed": 40,
                  "reserved": 3, "sold": 220, "shipped": 180, "returned": 2, "scrapped": 5},
    "by_grade": {"A": 18, "B": 22, "C": 9, "D": 4},
    "total_units": 475
  },
  "lots": {"by_status": {"intake": 2, "active": 6, "completed": 30}},
  "stock_value": {"at_cost_cents": 1234500, "at_list_cents": 2345600,
                  "listed_units": 40, "cost_known_units": 30},
  "reservations": {"active": 3, "expiring_24h": 1},
  "orders": {"by_state": {"pending": 2, "paid": 5, "shipped": 12, "delivered": 200,
                          "cancelled": 4, "refunded": 0},
             "revenue_paid_cents_30d": 987600, "orders_30d": 42, "aov_cents": 23514},
  "newsletter": {"total": 123},
  "audit_feed": [{"at": "<iso8601>", "actor_type": "staff", "actor_id": 7,
                  "entity": "asset", "action": "grade", "entity_id": 42}],
  "needs_attention": [{"kind": "intake_waiting", "count": 2, "label": "Lots in intake"},
                      {"kind": "restock", "count": 4, "label": "Products out of stock",
                       "items": [{"id": 9, "title": "iPhone 13"}]},
                      {"kind": "reservations_expiring", "count": 1, "label": "Reservations expiring in 24h"},
                      {"kind": "in_repair_stale", "count": 0, "label": "In repair > 14 days"}]
}
```
Nine set-based statements, **no N+1**:
- `by_status`: `SELECT status, count(*) FROM assets GROUP BY status`
- `by_grade`: `SELECT grade, count(*) FROM assets WHERE grade IS NOT NULL GROUP BY grade`
- `lots.by_status`: `SELECT status, count(*) FROM lots GROUP BY status`
- `stock_value`: one aggregate - `COALESCE(sum(cost_cents),0)`, `count(cost_cents)`, `sum(sale_price_cents) FILTER (WHERE status='listed')`, `count(*) FILTER (WHERE status='listed')`
- `reservations`: `count(*) FILTER (WHERE status IN ('active','confirmed'))` and the same `FILTER (... AND expires_at < now()+interval '24 hours')`
- `orders`: `SELECT status, count(*), sum(total_cents) FROM orders WHERE placed_at >= now()-interval '30 days' GROUP BY status`
- `newsletter`: `SELECT count(*) FROM newsletter_subscribers`
- `audit_feed`: `SELECT at, actor_type, actor_id, entity, action, entity_id FROM audit_log WHERE actor_type IN ('staff','agent','system') ORDER BY at DESC LIMIT 20` (include `'agent'` even though no agent exists yet - the enum admits it in the next job)
- `restock`: `SELECT p.id, p.title FROM products p LEFT JOIN assets a ON a.product_id=p.id AND a.status='listed' GROUP BY p.id HAVING count(a.id)=0 ORDER BY p.title LIMIT 5`

**Index reality - verified against the live DB, do not restate it as fully covered.** Covered: `assets_status_idx`, `assets_product_idx`, `orders_status_idx`, `reservations_expires_idx`, `audit_at_idx`. **Not** covered, i.e. these three are seq scans today: `by_grade` (no index on `assets.grade`), in-repair-stale (no index on `assets.updated_at`), and the orders revenue filter (no index on `orders.placed_at`). At current volume (~5.8k assets, hundreds of orders) that is sub-millisecond, so do **not** add indexes in this job - but say so honestly in your report rather than implying everything is indexed.

`needs_attention` derivations: intake lots (`lots.status='intake'` with units > 0), restock (query above), reservations expiring in 24h, in-repair stale (`status='in_repair' AND updated_at < now()-interval '14 days'`). There is no "listed without price" case - `chk_listed_has_price` forbids it.

Register the router in `apps/backend/app/main.py`.

### 2. Tests
- `apps/backend/tests/test_overview.py` (new): sales -> **403**; admin -> **200**; the shape keys above are present; and `inventory.total_units` **equals a direct `SELECT count(*) FROM assets`** (assert against the DB, not a literal). Use the house hermetic pattern (identity created via `bootstrap` + login, removed in a `finally`).
- `apps/backend/tests/test_staff_read_walls.py`: add `/staff/overview` to **`STAFF_READS` only**. **Do NOT add it to `READ_WALLS`** - that tuple's admin leg asserts `r.json() == []` (line ~99), which is written for list-returning reads, and this endpoint returns an object, so adding it there fails on a *correct* response. Verify by reading the test, then say in your report which tuple you touched and why.

### 3. The dashboard page
- Rewrite `apps/backoffice/app/admin/page.tsx` as the dashboard. Keep the existing identity header (email + role pill + Sign out) - do not lose it.
- New `apps/backoffice/app/components/dashboard/{StatRow,AttentionList,AuditFeed}.tsx`, built on the J4 primitives (`Card`, `Stat`, `Badge`, `Table`, `Heading`) and `lib/ui.ts`'s `statusTone`/`gradeTone` where they apply.
- Guard with the existing `useMe()` / `requireRole(me, ["admin","manager"])` from `lib/session.ts` (the door needs admin/manager; a warehouse user must not see a half-loaded dashboard).
- Layout: a stat row (units listed, stock value at cost/list, active reservations, orders 30d + revenue + AOV, newsletter total), then needs-attention, then the audit feed, then inventory by status/grade.
- Money is in cents - format with `aud()` from `lib/api.ts`.
- **No new write action, no refund, no delete.** There is no refund endpoint in the API and none may be invented.

## Acceptance
- `docker compose build api` then `docker compose run --rm api pytest -q` green; report the count before and after. Read your worktree's backend by mounting it:
  `MSYS_NO_PATHCONV=1 docker compose run --rm -v "<worktree>/apps/backend:/app" api pytest -q`
- **Live cross-check of one number**: with a staff token, `GET /staff/overview` and compare `inventory.total_units` against `SELECT count(*) FROM assets` run directly. Paste both. A dashboard that disagrees with its own DB is the failure this check exists for.
- **The trap, evidenced**: show the exact line in `test_staff_read_walls.py` that asserts `r.json() == []`, and state that `/staff/overview` is therefore in `STAFF_READS` only.
- Backoffice: `npx tsc --noEmit` and `npx next build` green via
  `docker run --rm -v "<worktree>/apps/backoffice:/app" -v rfo_backoffice_modules:/app/node_modules -w /app node:20-alpine sh -c "npx tsc --noEmit && npx next build"`.
  Do **not** pass padding/width overrides to the primitives (there is no tailwind-merge) - use the documented props.
- `/admin` SSR returns 200 and shows the dashboard's heading; unauthenticated it must not 500 (it redirects).
- Allowed surfaces: `apps/backend/app/api/v1/staff_overview.py` (new), `apps/backend/app/main.py`, `apps/backend/tests/**`, `apps/backoffice/app/admin/page.tsx`, `apps/backoffice/app/components/dashboard/**`. Anything else = **CHANGES**.
- State explicitly in the report whether you added any index (you should not) and why.

## Constraints
- Work only on branch `factory/<job-id>` (worktree provided) - LF / no BOM; PS 5.1 write rules
- Do NOT touch: `.env`, `secrets/`, `infra/`, `alembic`, `factory/*`, `apps/storefront/**`, `apps/backoffice/app/admin/assistant/page.tsx`
- The backoffice runs `next dev`; a new route DIRECTORY can need `docker compose restart backoffice`, but this job adds no route (only files under existing dirs) - record it if you find otherwise.
