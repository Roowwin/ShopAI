# deal-of-month: CMS-pinned Deal of the Month card on home

## Context
factory/backlog.md item 2. Home renders CMS content from /store/home-content (site_settings); offers already power the promo strip (0008). Green/amber theme.

## Deliverable
- CMS home payload gains one deal_of_month record { title, product_slug, badge } set via the EXISTING staff_ops home PUT (admin/manager, audited) plus ONE input added to the /admin/cms hero form in apps/backoffice (admin/cms page).
- Storefront app/page.tsx renders a Deal of the Month card ABOVE New Arrivals only when the record is set: title, badge, price, image_url, link to /products/<slug>, GST-consistent formatting.
- site_settings JSON only - NO migration, no new tables. Backend touch limited to staff_ops home handlers + the public home-content serializer.

## Acceptance
- Set via /admin/cms -> card visible on home after rebuild; unset -> block absent entirely (no placeholder).
- Card links to the real product page; green theme consistent with existing cards.
- pytest deterministic gate (29/29 with the two assistant deselects) green; storefront prod build green.
- Allowed surfaces: staff_ops.py home handlers, public home-content serializer, storefront app/page.tsx card, backoffice admin/cms form. Anything else: verdict CHANGES.

## Constraints
- Work only on branch factory/<job-id> (git worktree provided)
- LF / no BOM; PS 5.1 write rules
- Run: docker compose run --rm api pytest -q   (must be green)
- Do NOT touch: .env, secrets/, infra/nginx/certs/