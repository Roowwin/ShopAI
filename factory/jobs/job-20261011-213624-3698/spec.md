# backoffice dashboard v1: /admin/dashboard - KPIs, alerts, SVG donut + bars, role-gated

## Context
Backoffice is Next.js App Router (apps/backoffice), house style: hand-rolled Tailwind pages, apiFetch, roles admin/manager/sales (NOTE: there is no OWNER/STAFF role - gate on admin/manager). No chart library exists and none may be added - charts are hand-rolled SVG. The backend aggregates from REAL tables: assets, lots, stock_movements (append-only), orders/order_lines, products, site_settings, audit_log. The backoffice next build is RED at base (assistant/page.tsx:125 TS18048 m.proposal possibly undefined, pre-existing) - this job repairs that line with a proper null-guard.

## Deliverable
1. GET /staff/dashboard/summary in staff_ops.py (admin/manager, house deps): returns in ONE response: assets_by_status (received/tested/graded/listed/reserved/sold counts), listed_units_total, pricing_pending (count of graded assets with no sale_price_cents), revenue_last_7d_cents + orders_last_7d (paid only), stuck_assets (received/tested older than 7 days: count + oldest serial_number), lots_stuck (received lots older than 14 days: count), grade_mix (listed units by grade A-D), category_mix (listed units by category name), team_activity (audit_log grouped by actor_id, last 7d, top 5 with actor_email + action count). Pure SQL over existing tables; parameterized; no new tables.
2. /admin/dashboard page (apps/backoffice/app/admin/dashboard/page.tsx): 4 KPI cards (listed inventory, pricing pending, 7-day revenue in AUD via the cents formatter, stuck assets), the alerts panel (pricing pending, stuck assets, lots stuck - each row links to its workbench page), ONE hand-rolled SVG donut (assets_by_status) and ONE SVG bar chart (grade_mix), team leaderboard list (top 5). House styling (Tailwind, emerald/slate/amber accents). Role gate client-side (staff/me) like /admin/newsletter.
3. A small shared component file for the two SVG charts (apps/backoffice/app/admin/dashboard/charts.tsx) - no chart libraries.
4. The assistant:125 null-guard (fix TS18048 with a real m.proposal check - this makes the BACKOFFICE PROD BUILD green for every future job).
5. Admin layout nav gains a Dashboard link (existing layout file, nav area).
6. Tests (hermetic, house pattern): the summary endpoint - 401 unauth; 403 sales; 200 admin with exact counts for its own fixtures (create product + lot + units with known states; assert numbers exactly), revenue computed for its own paid order. Finally-cleanup of its fixtures.

## Acceptance
- Gate passes (report the new count; the 3 deselects unchanged).
- npm run build of the backoffice prints FULLY GREEN (the 125-fix removes the base-red - no other diagnostics allowed).
- Surfaces: staff_ops.py, apps/backoffice/app/admin/dashboard/** (page+charts), apps/backoffice/app/admin/assistant/page.tsx (ONLY the 125 guard), the admin layout nav file, backend tests. Anything else = CHANGES. No migrations, no storefront.

## Constraints
- Work only on branch factory/<job-id>; LF/no-BOM; gates AFTER docker compose build api; do not touch .env, secrets/, infra/nginx/certs/, alembic, factory/*.