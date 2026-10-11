# fix: /store/best-sellers binds :lim (dead block found by live acceptance) + first test for it

## Context
store_catalog.py best_sellers binds :lim in SQL but passes {} params -> asyncpg prepare fail -> 500 always. The storefront swallows it (page.tsx catch void) so Best sellers NEVER rendered (the "honest empty state" was a swallowed 500). Pre-existing; found by job 4/5 acceptance; out of those surfaces.

## Deliverable
1. apps/backend/app/api/v1/store_catalog.py: pass {"lim": limit} - that is the entire code fix.
2. apps/backend/tests: FIRST hermetic test for best-sellers, house pattern: create own product + lot + one listed unit through the real flow, pay an order for it, GET /store/best-sellers -> 200, the created slug present with count >= 1. Assert 200 even with zero matching (limit honored). Finally-cleanup at least the staff identity; leaving sold orders behind matches the existing checkout-test precedent.

## Acceptance
- New test passes in the gate (report the new total; 4 deselects unchanged).
- Allowed surfaces: store_catalog.py + backend tests ONLY. Anything else = CHANGES.

## Constraints
- Work only on branch factory/<job-id>; LF/no-BOM; gates AFTER docker compose build api; do not touch .env, secrets/, infra/, factory/*.