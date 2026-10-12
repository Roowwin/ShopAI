# hygiene: demote the card CTA, round its focus ring, fix a comment and the toolbar's ring room

## Context
Four small items carried out of the last three jobs and now closing the owner's storefront brief. None
of them changes behaviour; three are one-line cosmetic/semantic fixes and one is a correction to a
sentence that is not true.

1. The product-grid CTA came out `primary` (emerald). The design system's own rule - see the comment on
   Button.tsx - is that `primary` is "the one loud thing on a page", and a catalog grid now carries one
   per tile. The owner has looked at it and asked for the demotion to `secondary`.
2. The card's focus ring is drawn on the stretched `::after` overlay with `ring-inset` (it has to be:
   the card's own `overflow-hidden` clips a descendant's outset ring). The overlay sets no radius, so
   the ring's four corners are trimmed by the card's `rounded-2xl` and only the straight runs show.
3. ProductCard's comment claims the titles that keep their brand in the eyebrow are "every Samsung,
   Apple and Lenovo title". That is not true: of the 16, it is 4 Samsung, 7 Apple and 5 Lenovo - a fifth
   Samsung card ("Refurbished Samsung Galaxy S21 - 6.2in, 128GB") correctly drops the brand because its
   title already says Samsung.
4. The catalog toolbar gained `py-1` so its own `overflow-x-auto` could not clip the triggers' focus
   ring top and bottom, but it has no horizontal equivalent: at the scroll origin the first and last
   triggers' rings are still trimmed left and right on phones.

## Deliverable
1. `ProductCard.tsx`: the `full` tile's "View product" Button moves from `variant="primary"` to
   `variant="secondary"`. Nothing else about it changes - still an `href`, still above the overlay
   (`relative z-10`), still the card's one action. Note in the record that this puts the whole grid on
   the quiet variant and that the emerald is now spent only on the site's real primary actions.
2. `ProductCard.tsx`: the overlay gains `after:rounded-2xl` so the inset ring follows the card's corner
   radius instead of being trimmed square by it. Keep `ring-inset` - it is load-bearing (see Context 2).
3. `ProductCard.tsx`: correct the comment to match the data - most Samsung titles and every Apple and
   Lenovo one, 16 in total (4 / 7 / 5) - and keep the reason: the eyebrow is the only place the brand is
   said for those, which is why the rule is conditional rather than a blanket "category only".
4. `LoadMore.tsx`: give the toolbar horizontal ring room the same way it got vertical room - padding
   inside the clip box, with a cancelling negative margin so the row's content still lines up with the
   section heading (`px-1 -mx-1`, dropped from `sm` up where the row no longer scrolls).

## Acceptance
- The served catalog HTML shows `variant="secondary"`'s classes on the card CTA (`bg-surface text-ink-700
  ring-1 ring-line`) and **no** `bg-brand-700 text-white` in the catalog section; the CTA is still an
  anchor with an href.
- The overlay carries `after:rounded-2xl` (class present in the served HTML). Whether the ring now reads
  as a rounded outline is a browser question and must be reported as such, not claimed.
- The toolbar carries the horizontal padding under `sm` and none at `sm` and up, and the row's first
  trigger still aligns with the section heading above it (the negative margin is what keeps that true -
  browser-only, say so).
- Nothing else moves: the two files' other behaviour (the filters, the paging, the header, the stretch
  overlay and the `z-10` CTA) is untouched; no dependency; no data change.
- Gate: report the exact count (expect 117 passed / 3 deselected) after `docker compose build api`;
  storefront `tsc --noEmit && npm run build` green (report the route count) and a live check of the
  served markup as above.

## Allowed surfaces
`apps/storefront/app/components/ui/ProductCard.tsx`, `apps/storefront/app/components/LoadMore.tsx`. No
other file, no backend, no tests, no data change, no new dependency. Anything else = CHANGES.

## Constraints
- Work only on branch factory/<job-id>; LF/no-BOM; gates AFTER `docker compose build api`; never touch
  .env, secrets(), infra/, factory/*.