# content-pages: FAQ, Contact, Our Grades A-D, Returns/Warranty pages

## Context
See factory/backlog.md item 1. Storefront is Next.js App Router in apps/storefront, green/amber brand theme.

## Deliverable
- Four public pages: /faq, /contact, /grades, /returns (App Router server components, shared content layout styled like existing pages)
- Footer: links to all four; Header: /faq link only in nav
- Copy fits a refurbished electronics shop: FAQ (ordering, shipping, grading, warranty), Contact (support email, hours; address can be a placeholder), Grades (A-D condition scale explained), Returns/Warranty (plain-language terms)
- Storefront-only change; no backend, API, migration, or CMS work

## Acceptance
- All four routes render real copy; no lorem ipsum, no TODO placeholders
- Footer and nav links navigate in the prod build
- npx tsc --noEmit inside apps/storefront shows no NEW diagnostics vs the known baseline
- Storefront prod build succeeds; docker compose run --rm api pytest -q green
- Nothing outside apps/storefront touched (verdict CHANGES if backend files appear)

## Constraints
- Work only on branch factory/<job-id> (git worktree provided)
- LF / no BOM; PS 5.1 write rules
- Run: docker compose run --rm api pytest -q   (must be green)
- Do NOT touch: .env, secrets/, infra/nginx/certs/