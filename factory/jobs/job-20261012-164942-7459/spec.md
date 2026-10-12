# product buy-box: Amazon-style grade selector panel

## Context
The storefront product page (apps/storefront/app/products/[slug]) renders GradePanel (per-grade rows, each with its own Add button). The serialized-commerce flow (reserve the cheapest unit of a chosen grade; the exact serial shows in the cart; a locked row refuses a second buyer) must stay identical.

## Deliverable
1. Product page becomes a two-column layout: gallery/details left, the BUY BOX as a right column, sticky near top (top-24), full-height panel feel.
2. Buy box content, top to bottom:
   - The SELECTED grade's unit price, large (aud()), no "from" hedge once a grade is selected;
   - Stock/status line: "In stock: N units - Grade <letter>" plus the selected unit's serial tail (masked style as elsewhere);
   - The GRADE OPTIONS as selectable tiles (role=radiogroup; each tile: Badge + label + "N available" + its from-price; selected tile = emerald ring + check; default selection = the cheapest available grade, like Amazon's cheapest condition);
   - ONE wide CTA under the options: "Add to cart - $<selected price>"; when the selected unit is already in cart, the CTA becomes "In cart - view" linking /cart. The add() flow (cartAdd of the cheapest unit of the selected grade) is unchanged.
3. Mobile: the buy box moves below the gallery as a full-width panel; option tiles stay >=44px targets; the panel is not sticky on mobile.
4. Aesthetics ride job 11's tokens: hover/focus-visible/active states, motion tokens, reduced-motion respected; borders via the design system's ink/line tokens.
5. No backend changes, no logic changes to cart/checkout - layout + component structure only.

## Acceptance
- Owner's eye: the page reads like Amazon's buy box (price -> options -> CTA); switching grades updates price/stock instantly; mobile stacks; the cart flow + serial display unchanged; two tabs trying the same unit still lock correctly (existing behavior).
- Gate: report exact count (expect 117/3+0 new); storefront prod build green.

## Allowed surfaces
apps/storefront/app/products/[slug]/**, the GradePanel file, apps/storefront/app/components/ui (only if a shared class/component is genuinely needed). No backend/UI elsewhere. Anything else = CHANGES.

## Constraints
- Work only on branch factory/<job-id>; LF/no-BOM; gates AFTER docker compose build api; never touch .env, secrets/, infra/, factory/*.