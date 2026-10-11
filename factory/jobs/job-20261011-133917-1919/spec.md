# newsletter: public subscribe + admin subscriber list + storefront footer form

## Context
Backlog (order revised in docs/PROJECT_CONTEXT.md v5: newsletter before wishlist - wishlist parked behind customer-auth design). Public endpoints live in store_* files; admin page pattern: apps/backoffice/app/admin/*; hermetic test pattern already exists in tests/test_storefront_api.py (see test_guest_checkout_to_paid).

## Deliverable
- Migration 0009: additive-only table newsletter_subscribers (id PK, email normalized-UNIQUE, created_at timestamptz default now(), source text nullable). No data migration, nothing else touched. Applied via the tools-profile migrate service.
- Public POST /store/newsletter/subscribe {email}: validate, lowercase-normalize, dedupe (UNIQUE conflict = idempotent success, never a 500, never reveals whether other addresses exist).
- Backoffice /admin/newsletter: admin/manager only - subscriber list (email, created_at) + total count.
- Storefront: small footer subscribe form (client component: email input, submit, inline success/duplicate message) in the existing footer block of app/layout.tsx.

## Acceptance
- Duplicate subscribe = success, exactly one row; invalid email = 4xx; admin page lists and counts correctly.
- Tests hermetic (own fixtures + finally cleanup incl. created subscribers, tokens, staff), no hand-seeded dependence.
- Gate green with the 4 deselects (counts grow with new tests - run and report them); storefront and backoffice builds green; tsc shows no NEW errors (assistant-page:125 pre-existing known).
- Migration additive-only; existing migrations 0001-0008 untouched.
- Allowed surfaces: new migration file, the store router file hosting the PUBLIC subscribe endpoint, staff_ops.py (admin list under /staff/newsletter), backend tests, apps/backoffice/app/admin/newsletter/*, apps/storefront/app/layout.tsx (+ one new footer component), lib additions if needed. Anything else = CHANGES.

## Constraints
- Work only on branch factory/<job-id> (git worktree provided)
- LF / no BOM; PS 5.1 write rules
- Run gates AFTER docker compose build api (baked-image rule)
- Do NOT touch: .env, secrets/, infra/nginx/certs/, migrations 0001-0008