# architect review round 1 - job-20261011-122535-6360

Manual reviewer. Base phase11-ai. Scope verified: staff_ops.py, store_catalog.py home_content, backoffice admin/cms form, storefront page.tsx + DealOfMonth.tsx (pre-authorized). Gate 27 passed / 4 deselected (policy: assistant pair + catalog/search count-asserts out of gate).

VERDICT: CHANGES
- Deal card renders when product has ZERO listed units (LEFT JOIN -> price NULL -> dash + zero-stock link). Fix behavior: publish deal_of_month only when product active AND >=1 listed asset in an active lot; unset/blank/bad-slug behavior unchanged (all correct).
- Add one hermetic pytest for the stockless case (self-created fixture; no hand-seeded lots).
- Non-blocking note only: admin form gives no feedback when slug matches no product (backlog idea, not rework).
- Otherwise pass-grade: raw record stripped from public payload, aud() pricing, roles/audit intact, honest EXISTS availability, no migration.
