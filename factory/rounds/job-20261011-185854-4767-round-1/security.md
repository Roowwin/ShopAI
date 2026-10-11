VERDICT: PASS

Job job-20261011-185854-4767. Commit reviewed: f77e559 (single commit, 8 files, merge-base 3ce8d96).

## 1. Door gate - properly gated, 403 with no data
`staff_overview.py:61-62`: `@router.get("/overview")` with `Depends(require_roles("admin","manager"))` - a role dependency, not bare `get_staff`. `deps.py:40-45` raises `HTTPException(403, "insufficient role")` with body `{"detail": ...}` only. The role enum is `admin, manager, technician, warehouse, sales`, so **warehouse/sales/technician all get 403** and only admin/manager reach the body; a customer token fails the `typ` check in `decode_access` -> 401. Test evidence: `test_overview.py:64-79` asserts no-cred 401, sales 403, admin 200.

## 2. Data exposure - PII-free, aggregate-only as intended
Every field built in `staff_overview.py:130-172` enumerated:
- Counts only: `inventory.*`, `lots.by_status`, `reservations.*`, `newsletter.total`, `orders.by_state`, `orders_30d`, `needs_attention[].count`. No per-customer breakdown, no customer ids.
- Aggregate money only: `stock_value.*`, `revenue_paid_cents_30d`, `aov_cents` - not per-customer spend.
- `orders` is `SELECT status, count(*), sum(total_cents) ... GROUP BY status` - **no join to users/customers anywhere in the file**.
- `audit_feed` selects only `at, actor_type, actor_id, entity, action, entity_id`, filters `actor_type IN ('staff','agent','system')` (excluding the `customer` type the DB admits), and critically **does not select the `before`/`after`/`meta` JSONB columns** - the only fields that could carry PII. `actor_id` is a `staff_users.id`, `entity_id` an entity BIGINT.
- `restock` items are `{id, title}` from `products` - catalog, not PII.
- **No emails, names, addresses, customer ids or per-customer spend anywhere. Explicitly PII-free.**

## 3. Test placement - claim accurate
Added to `STAFF_READS` only (`test_staff_read_walls.py:47-52`); NOT in `READ_WALLS` (still 3 entries). The admin-leg `r.json() != []` assertion is at `:104`. The 401 sweep iterates `STAFF_READS`, so the new door is covered for the no-credential case.
Adversarial note (not a defect): in `STAFF_READS` only, the door is not exercised by `READ_WALLS`' customer-bearer or sales legs; `test_overview.py` covers no-cred 401 and sales 403 but not customer-bearer. Safe by construction (`decode_access` rejects a customer `typ` with 401) - a coverage gap, not a vulnerability.

## 4. Page client gate - present, fails closed, cosmetic over the server wall
`page.tsx:8` imports `requireRole, useMe` from `@/lib/session`; `:41-42` gates on `requireRole(me, ["admin","manager"])`. Fetch runs only when `checked && allowed` (`:56-57`); on 403 it sets a message and leaves `data` null. All data blocks render only under `checked && allowed && data`; not-allowed renders a "role required" card with no data; initial SSR (`checked=false`) renders heading + Loading, no data. Tampering with client `me` cannot surface data - the server still 403s. Confirmed cosmetic, not load-bearing.

## 5. No new write surface
`staff_overview.py` has exactly one decorator, `@router.get` - GET-only. `main.py` change is import + `include_router` only. Page and the three dashboard components contain no POST/PUT/DELETE/PATCH/refund; the only write is the pre-existing `logout()`. `audit_log` is append-only at the DB level.

## 6. Surface - clean
Exactly 8 files changed, all allowed. Nothing in `.env`, `secrets/`, `infra/`, `alembic`, `factory/`, `apps/storefront`, or `admin/assistant/page.tsx`.

Out-of-scope observation (correctness only): the spec said to use `aud()` from `lib/api.ts`, but that file exports no `aud`; `StatRow.tsx:6-8` defines it locally with documented rationale.
