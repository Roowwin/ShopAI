# catalog UX: all categories in the nav strip + brand/grade/price filters + URL state

## Context
9 categories exist but Header renders slice(0, 6) - phones/tablets/processors invisible. The catalog page filters by category (query param, existing) with sort options. The catalog query = store_catalog.py house pattern (parameterized, asyncpg-safe: no ::TYPE casts in text()).

## Deliverable
1. Header nav: render ALL live categories - drop the slice; horizontal scrollable chip strip with fade edge on overflow (same house styling); the category page itself already lists everything.
2. Catalog filters, each a chip/selector row composing with the others, ALL reflected in the URL query string (shareable links):
   - category (existing parameter, now also URL-state)
   - brand (single-select chip row + All; brand slug from products join)
   - grade (A/B/C/D + All; filters on listed units grade)
   - price band (presets: Under 100 / 100-300 / 300-600 / 600+)
   - sort (existing: New/price ascending/price descending/name)
3. Backend: the catalog query gains optional brand/grade/max_cents params (additive, validated, parameterized, default-off = current behavior byte-identical); the response carries the applied filter set back for UI state.
4. Empty state honest: a filter combo with zero results says so plainly with a clear-filters action.

## Acceptance
- Filters each filter correctly alone and compose together; the URL reflects the state and a pasted URL reproduces the same view (tested via hermetic fixtures + delta counts).
- Gate: report exact count (expect 110+ with new tests); 3 deselects unchanged. Storefront build green; backoffice untouched.

## Allowed surfaces
apps/storefront/app (catalog page, Header, new shared filter components), app/api/v1/store_catalog.py (params only), tests. No migrations (brand/grade live on existing tables). Anything else = CHANGES.

## Constraints
- Work only on branch factory/<job-id>; LF/no-BOM; gates AFTER docker compose build api; never touch .env, secrets/, infra/, factory/*.