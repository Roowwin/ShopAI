# storefront product cards: primary View-product CTA, one title, muted stock

## Context
Owner brief 2026-10-12, second half: the product cards should read like a professional shop - a real
primary action, one copy of each name, a quiet stock badge, and less air between the home page's
last two sections. A separate job (previous) did the header and the filter vocabulary; this one is
the cards and the page copy around them.

Three measured facts drive the design, all from the live catalogue (57 products):

1. 56 of 57 titles carry a leading "Refurbished " (the exception is "Rehearsal day 20261011 handset").
   The store sells nothing else and the page's own copy already says certified refurbished, so on a
   card the prefix is noise. It is stripped AT RENDER, never in the data: the product page's h1, the
   OG image text and the titles already in shoppers' carts keep the stored wording. That asymmetry is
   deliberate - say so in the code comment so nobody "fixes" it later.
2. 41 of those titles ALSO begin with their own brand ("ASUS ZenBook 14 UX425", brand ASUS), so the
   card's eyebrow ("ASUS - Laptops") repeats it. But 16 do not - every Samsung ("Galaxy Book2"),
   Apple ("MacBook Air M1", "iPhone 13", "iPad Air 4") and Lenovo ("ThinkPad X1 Carbon") - and for
   those the eyebrow is the ONLY place the brand appears on the card. So the rule is conditional:
   the eyebrow drops the brand when the stripped title already starts with it, and keeps it when it
   does not. A blanket "category only" would delete the brand from 16 cards.
3. Today's full card is one `<a>` around everything, with the only call to action a "View product"
   line that fades in on hover - invisible on touch, and impossible to turn into a real button
   because a button inside a link is invalid HTML. The owner has approved the structural change.

## Deliverable
1. ProductCard's `full` variant (the catalog tile) becomes a `<div>` container, not a link:
   - `Card` already renders a `<div>` when it is given no `href` (Card.tsx), so no change to the
     primitive is needed unless the hover/focus split genuinely wants one - if you edit it, say why.
   - The product NAME is the card's one link, stretched to cover the whole card so the art, the
     eyebrow and the whitespace stay clickable: `after:absolute after:inset-0 after:content-['']` on
     the anchor, with the focus ring drawn on that overlay (`focus-visible:after:ring-2
     focus-visible:after:ring-brand-700 focus-visible:after:ring-offset-2`) so keyboard focus outlines
     the card rather than only the text.
   - ONE primary CTA at the card's foot - "View product" as `Button variant="primary"`, as an anchor
     (href, so middle-click and open-in-new-tab still work), sitting above the stretched overlay
     (`relative z-10`) so it is a real, separately focusable control.
   - Net effect: exactly two controls per card, both named, nothing nested. The hover lift and the
     shadow cue stay, reduced-motion still cancels the lift.
   - Note in the record that a primary button per tile is louder than the design system's usual "one
     loud thing on a page"; the owner asked for primary, so it is primary, and a future pass can
     demote it to `secondary` in one word.
2. Titles and eyebrows (all three variants - full, compact, text - since every card is a card):
   - strip a leading "Refurbished " at render, case-insensitively, via one small pure helper used by
     every variant;
   - the eyebrow shows `brand - category`, but shows ONLY the category when the stripped title
     already begins with the brand (the 41/16 rule above);
   - the compact and text variants keep their existing single-link card (no nested control, so no
     invalid HTML) and only inherit these two rules.
3. Stock badge: the count becomes small and muted - the Badge pill's tint goes from the emerald
   `bg-brand-50 text-brand-700` to a quiet `bg-surface-sunken text-ink-500`, in whichever variants
   render it. A zero count keeps its current wording and colour (it is already muted). Do not invent
   new wording, and do not change what the prop means.
4. Home page (page.tsx): tighten the gap between "Best sellers" and "Our products" only - the #shop
   section's top padding (currently `pt-16`, 64px). Leave the other sections' rhythm alone. Report
   the before/after values.

## Acceptance
- Owner's eye: a card shows the product name once, with no "Refurbished" and no brand repeated; the
  "View product" button is visible at rest (not hover-only) and reads as the card's action; the
  stock count is quiet; the gap above "Our products" is visibly tighter.
- Interaction parity: clicking the art, the eyebrow or the whitespace around the text still opens
  the product; the CTA opens the same product in the same tab; the card still lifts on hover.
- Accessibility, verified by reading and by grep: no `<button>` or `<a>` nested inside another `<a>`
  in the rendered card (the reason for the change); exactly one link carries the product name;
  Tab reaches the name link (ring around the whole card) then the CTA; Enter navigates from either.
- Coverage report from live data: how many of the 57 titles the strip changes, and how many keep the
  brand in the eyebrow vs drop it (the expectation is 56 stripped, 41 drop / 16 keep).
- Gate: report the exact count (expect 117 passed / 3 deselected) after `docker compose build api`;
  storefront `tsc --noEmit && npm run build` green (report the route count) and a live check of the
  served card markup through nginx - the CTA present, the title stripped, no anchor-inside-anchor.
- Header height and card pixel measurements are NOT available in the worktree: state plainly that
  any figure is computed from class values, not measured.

## Allowed surfaces
`apps/storefront/app/components/ui/ProductCard.tsx` (the bulk), `apps/storefront/app/components/ui/Card.tsx`
(only if the hover/focus split needs it - say why), `apps/storefront/app/page.tsx` (the #shop top
padding only). No backend, no tests, no data change, no other route, no new dependency, and do not
touch the header or the facet toolbar (both shipped and reviewed in the previous job). Anything else
= CHANGES.

## Constraints
- Work only on branch factory/<job-id>; LF/no-BOM; gates AFTER `docker compose build api`; never touch
  .env, secrets/, infra/, factory/*.
- Do NOT rename product data and do NOT change the product page's h1, the OG text or what the cart
  stores: the strip is a card-presentation rule (see Context 1).