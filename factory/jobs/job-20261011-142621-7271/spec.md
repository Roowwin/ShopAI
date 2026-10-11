# demo-store seeding via real flows: POST /staff/products + scripts/seed_demo.py

## Context
Catalog is 0002-seeded only (2 phone products; galaxy-s21 has 9 listed units, iphone-13 has 0; 4999 graded unlisted RX-BULK units on galaxy; laptops/tablets categories empty). No API creates products today. Goal: the store should look like a running refurb business - catalog across all 3 categories, real listed graded stock, real paid orders, a couple of real promos, real customer accounts. Everything through the REAL app flows: the seeder must never write product/asset/order rows directly.

## Deliverable
1. POST /staff/products in staff_ops.py (admin/manager, audited): body {brand_slug, category_slug, model, title, slug (optional), description, specs (json dict)}. Brand/category must already exist (422 otherwise). Slug auto-derived from title when omitted, unique-checked (409 on duplicate). Returns the full product row.
2. apps/backend/scripts/seed_demo.py (app-root-relative; baked into the api image) - runs INSIDE the stack: docker compose run --rm api python scripts/seed_demo.py - and talks ONLY to the real API over HTTP (base URL = the same internal api target the storefront apiInternal client uses). Bootstraps a seed admin via app.bootstrap_staff, logs in like any client, then: per product (default 8, --products arg, static demo list spread over apple/samsung x phones/laptops/tablets): create via POST /staff/products; one lot each; M units per lot (default 5, --units-per): scan-in -> tested -> grade (A-D mix) -> price -> listed -> activate lot. Optional --rehabilitate N: convert N existing RX-BULK graded units through the same real flow (test -> grade -> price -> listed). K guest orders (default 6, --orders): reserve -> checkout -> simulate-payment spread over listed units, plausible AU addresses. 2 promotions via POST /staff/cms/promotions if not present. C customers (--customers, default 3) via POST /store/auth/register with strong random passwords, printed ONCE in the summary. Final printed summary table (products/units/orders/customers/promos created). Idempotent by slug/serial scheme (seed-demo-* / RX-SEED-*): re-run creates nothing twice. NO direct SQL to products/assets/orders/newsletter; brand/category lookups may read SQL only if no GET endpoint exists.
3. Tests (hermetic, finally-cleanup, house pattern = test_guest_checkout_to_paid): POST /staff/products - 401 unauth; 403 sales; 200 admin creates + row returned; 409 dup slug; 422 unknown brand/category.

## Acceptance
- New gate tests pass (report the new total; 4 deselects unchanged).
- Manual run: scripts/seed_demo.py --products 3 --units-per 2 --orders 2 produces 3 catalog products with listed graded units, 2 paid orders visible in best sellers, promos visible, summary printed; re-run adds nothing twice.
- Gate green; storefront prod build green; if no storefront change was needed, the report must say so explicitly.
- Allowed surfaces: staff_ops.py, apps/backend/scripts/seed_demo.py (app-root-relative), tests. NO migrations (0001-0009 untouched), NO store router changes, NO storefront changes. Anything else = CHANGES.

## Constraints
- Work only on branch factory/<job-id> (git worktree provided)
- LF / no BOM; PS 5.1 write rules
- Gates AFTER docker compose build api (baked-image rule)
- Do NOT touch: .env, secrets/, infra/nginx/certs/, alembic migrations