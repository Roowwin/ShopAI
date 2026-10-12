# builder report — job-20261012-182405-5574 (round 1)

Closes the record gaps the round-1 architect named, and corrects one thing it caught. Everything
below is from the worktree at commit bec03fd.

## Gate (after `docker compose build api` from this worktree)

**117 passed, 3 deselected** in 41.92s - unchanged from the previous two jobs, as expected for a
storefront-only diff (same 3 deselects: the assistant pair + test_search).

## Storefront build

`tsc --noEmit` clean; `next build` green, **13/13 static pages**, same 13-route table as before.

## Served-markup check (the branch's own build, served on a throwaway container)

The architect could not check this: `shop.rfo.localhost` still serves the MAIN tree, so a branch's
card is invisible there until it is merged. Method used instead - the worktree's build served with
`next start` on `127.0.0.1:3098` against the running API, then the HTML inspected:

| claim | result on served HTML |
|---|---|
| no anchor inside an anchor | anchor nesting depth **1** across the whole catalog section |
| two controls per card | **16** anchors over **8** cards |
| "Refurbished " stripped | **0** occurrences in the cards (was 8 per page) |
| hover-only CTA gone | `opacity-0` **0** occurrences |
| primary CTA present and above the overlay | `bg-brand-700 text-white` present, `relative z-10` present |
| stock pill muted | **8** `bg-surface-sunken text-ink-500`, **0** of the old emerald tint |
| `#shop` tightened | `pt-12` |

Brand rule, both branches: on the default catalog the eyebrow is the category alone (those titles
start with their brand); on `/?brand=apple` it is **"Apple - Laptops"** above **"MacBook Air M1"**
(brand kept, prefix stripped - the case the 16 are about); on the search page the text tile shows
**"Samsung"** above **"Galaxy Book2"**.

No pixel measurements: there is no browser here, so nothing above is a rendering measurement, and no
height figure is claimed anywhere in this change.

## Correction the architect caught (wording, not behaviour)

ProductCard.tsx:28 and the commit message say the titles that keep their brand in the eyebrow are
"every Samsung, Apple and Lenovo title". That is not literally true and should not have been written:
the 16 are **4 Samsung, 7 Apple, 5 Lenovo**, and a fifth Samsung card
("Refurbished Samsung Galaxy S21 - 6.2in, 128GB") correctly DROPS the brand because its title already
says Samsung. The rule and its outcome are right; only the sentence overreaches. Left uncorrected in
the code because the verdicts ruled on that revision - the fix, if wanted, is to say "most Samsung and
every Apple and Lenovo title" (one line, hygiene lane, no behaviour change).

## The trade-off Deliverable 1 asked to be recorded

A primary (emerald) button on every catalog tile is louder than the design system's own rule that
`primary` is "the one loud thing on a page" (Button.tsx). The owner asked for a primary action, so it
is primary - and it is a one-word change to demote every card CTA to `variant="secondary"` if the
grid reads too loud in the browser. Recorded here because the spec asked for it in the record and the
commit message did not carry it.

## Cosmetic, known and not fixed

The stretched overlay sets no border radius, so the inset focus ring's four corners are trimmed by the
card's `rounded-2xl`; the four straight runs still outline the card. One word (`after:rounded-2xl`)
would square it away. Found by the architect, left for the hygiene lane rather than changed after the
verdicts.
