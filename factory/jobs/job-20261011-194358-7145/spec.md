# backend+backoffice: ops views - orders, customers, audit, asset detail

## Context
The backoffice can see inventory (J5's dashboard) but not commerce or history: there is no orders view, no
customers view, no audit browser, and no asset detail page. This job adds the read-only endpoints and pages.
`/admin` is now a real dashboard, so the nav (which currently has Home, Intake, Assets, Assistant, AI Listings,
CMS, Newsletter, Security) should gain Orders, Customers and Audit - J1 deliberately omitted those links because
the pages did not exist, which is why this job must add both together and must not leave a 404 link.

**This is the first job that puts customer PII in the staff UI.** Every endpoint here is
`require_roles("admin","manager")` and nothing less - a `warehouse`, `sales` or `technician` token must get 403
with an empty body, and the UI must fail closed over that wall.

## Deliverable

### 1. `apps/backend/app/api/v1/staff_views.py` (new) - read-only
All six routes `Depends(require_roles("admin","manager"))`, `db=Depends(get_db)` (the app DB, not the `ai.*`
views - see J5's note that their DDL is unversioned). All paginated with `limit`/`offset` and a `total`, all
set-based, no N+1. **No new writes, no refund, no delete** - there is no refund endpoint in this API and none may
be invented; refund state is displayed, never actioned.

- `GET /staff/orders?status=&q=&limit=&offset=` -> `{total, orders:[{id, public_id, status, total_cents, currency, placed_at, customer_email, item_count}]}`
- `GET /staff/orders/{id}` -> `{order, lines:[{asset_id, sku_title, unit_price_cents, line_total_cents, grade, serial_tail}], payments:[{provider, status, amount_cents, created_at}], customer:{email, display_name}}`
- `GET /staff/customers?q=&limit=&offset=` -> `{total, customers:[{id, public_id, email, display_name, status, created_at, orders_count, lifetime_cents}]}`
- `GET /staff/customers/{id}` -> `{customer, orders:[...]}` (same order shape as the list)
- `GET /staff/audit?entity=&actor_type=&action=&limit=&offset=` -> `{total, entries:[{id, at, actor_type, actor_id, entity, entity_id, action, before, after, meta}]}`
- `GET /staff/assets/{id}` -> `{asset, lot, movements:[...], reservations:[...], audit:[...]}`

`q` on orders matches the public id and the customer email; on customers it matches email and display name. Use
`ILIKE` with a parameterised pattern - never string-format a query.

Register the router in `apps/backend/app/main.py`.

**PII handling - the part to get right, and to report:**
- `customer_email` / `display_name` appear only on admin/manager-gated responses. Say so explicitly in your report.
- **Check what is actually in `audit_log.before` / `after` / `meta` for customer-scoped entities before exposing
  them.** Those JSONB columns are the only place in the audit row that could carry PII, and the audit view is the
  first thing to render them. Query the live DB for rows where `entity` relates to an order, payment or
  reservation and report whether any value looks like an email, name or address. If any does, **redact or omit
  those columns for those entities** rather than shipping it; if none does, say so with the query you ran. Do not
  guess.

### 2. Pages (read-only, built on the J4 primitives + J5's patterns)
- `app/admin/orders/page.tsx`, `app/admin/orders/[id]/page.tsx`
- `app/admin/customers/page.tsx`, `app/admin/customers/[id]/page.tsx`
- `app/admin/audit/page.tsx`
- `app/admin/assets/[id]/page.tsx`, and link each row of the existing assets table to it
- `app/admin/layout.tsx`: add Orders, Customers and Audit to the nav. **Every link must resolve** - verify each.
- Use `Card`, `Stat`, `Badge`, `Table` (its `label` prop is **required** - pass a meaningful one), `Heading`,
  `Button`, `Select` and `lib/ui.ts`'s tone maps. Do not hand-roll class strings.
- Drive count/status tables from **payload keys** via `Object.entries`, not hardcoded lists (the pattern J5 ended
  with - a hardcoded list silently drops a future enum value).
- Guard each page with `useMe()` + `requireRole(me, ["admin","manager"])` and fail closed.
- Money in cents - format via a **shared** helper, see below.

### 3. Move `aud()` to a shared module (resolves a J5 deviation)
J5 defined `aud()` module-locally in `components/dashboard/StatRow.tsx` because `lib/` was outside its surfaces.
These six pages need it too. Move it to `apps/backoffice/lib/format.ts` and have `StatRow.tsx` import it - one
formatter, not two. `apps/backoffice/lib/**` is in scope for this job.

### 4. Tests
- `apps/backend/tests/test_views.py` (new): for each of the six routes - no credential -> 401, sales -> **403**,
  admin -> **200**; plus pagination (`limit`/`offset`/`total` consistency) and one search filter. Assert at least
  one aggregate against a **direct SELECT** (e.g. `total` on `/staff/orders` == `SELECT count(*) FROM orders`).
- `apps/backend/tests/test_staff_read_walls.py`: add all six to **`STAFF_READS` only**. **Do not add any to
  `READ_WALLS`** - that tuple's admin leg asserts `r.json() == []` (written for list-returning reads) and every
  route here returns an object, so it would fail on a *correct* response. Quote that line in your report.

## Acceptance
- `docker compose build api` then the gate green - report the count before and after. Read your worktree's backend
  by mounting it (the api image bakes the main tree):
  `MSYS_NO_PATHCONV=1 docker compose run --rm -v "<worktree>/apps/backend:/app" api pytest -q`
- **Live cross-check of one number per new endpoint family**: e.g. `/staff/orders` `total` vs
  `SELECT count(*) FROM orders`; `/staff/customers` `total` vs `SELECT count(*) FROM users`. Paste both sides.
- **The PII audit**, with the query you ran and its result (see above).
- Backoffice: `npx tsc --noEmit && npx next build` green:
  `docker run --rm -v "<worktree>/apps/backoffice:/app" -v rfo_backoffice_modules:/app/node_modules -w /app node:20-alpine sh -c "npx tsc --noEmit && npx next build"`
  (git-bash needs `MSYS_NO_PATHCONV=1` or `-w /app` is mangled into a Windows path.)
- **Closed-world check if you write any comment in scanned source** (`app/**` or `lib/**`): strip comments from a
  copy, rebuild, and confirm the emitted rule set is unchanged. A class-shaped or bare utility word in a comment
  emits a real CSS rule - this has cost four findings in this program. Write comment prose that avoids bare
  utility words (`ring`, `hidden`, `inline`, `fixed`, `grid`, `block`, `table`, `border`, `shadow`, `rounded`).
- Every nav link resolves: curl each `/admin/...` route and confirm 200 (not 404).
- Allowed surfaces: `apps/backend/app/api/v1/staff_views.py` (new), `apps/backend/app/main.py`,
  `apps/backend/tests/**`, `apps/backoffice/app/admin/{orders,customers,audit,assets,layout.tsx}`,
  `apps/backoffice/app/components/**`, `apps/backoffice/lib/**`. Anything else = **CHANGES**.

## Constraints
- Work only on branch `factory/<job-id>` (worktree provided) - LF / no BOM; PS 5.1 write rules
- Do NOT touch: `.env`, `secrets/`, `infra/`, `alembic`, `factory/*`, `apps/storefront/**`,
  `apps/backoffice/app/admin/assistant/page.tsx` (J8 reworks it), `app/admin/page.tsx` (J5's dashboard)
- The backoffice runs `next dev`; NEW route directories can need `docker compose restart backoffice` before the
  dev server serves them (known bind-mount inotify gap) - record whether you needed it.
