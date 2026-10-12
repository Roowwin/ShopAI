# builder report — job-20261012-183517-1898 (round 1)

## Gate (after `docker compose build api` from this worktree)

**117 passed, 3 deselected** in 68.28s. Unchanged, as it must be for a storefront-only diff.

## Storefront build

`tsc --noEmit` clean; `next build` green, **13/13 static pages**, the same 13-route table as before.

## Served-markup check (the branch's build on a throwaway container)

The live host serves the MAIN tree, so an unmerged branch cannot be checked there; the worktree's
build was served with `next start` on `127.0.0.1:3096` against the running API and the HTML inspected:

| claim | result |
|---|---|
| the card CTA is secondary | **8** CTAs, every one carrying `ring-1 ring-line` and **none** carrying `bg-brand-700` |
| the overlay radius | `after:rounded-2xl` present, **and** `ring-inset` still present (neither replaced the other) |
| the toolbar's ring room | row reads `py-1 px-1 -mx-1 … sm:py-0 sm:px-0 sm:mx-0` |

One note on the Acceptance wording: "no `bg-brand-700 text-white` in the catalog section" came back 0,
but not for the reason it implies - all eight tiles on this page have an image, so none renders the
Eco-choice Badge, which legitimately uses that class. The meaningful assertion is about the CTA's own
class, which is what was checked. On a page with image-less products the count would be non-zero and
correct.

Browser-only, not claimable from here (the architect agrees): whether the ring now reads as a rounded
outline, and whether the row's right-hand padding helps at the scroll end.

## The addendum, and why the round's verdicts are not all for one revision

Mid-round, the performance reviewer looked outside its own lens and reported that demoting the CTA had
falsified two comments in the same file: the StockPill comment's reason ("The emerald is spent once per
card, on the CTA") and the docstring's "the card's one primary action". Both were mine and both were in
this job's own diff, so commit **744abcb** corrects them - comment text only
(`git diff c08fda4 744abcb` is 4+/5-, every line inside a `/* */` block).

Recorded plainly, because the trail should not imply more than it has:

- the **security** and **performance** verdicts were written against c08fda4;
- the **architect** re-checked at 744abcb, confirmed the two comments were the only falsified
  statements, confirmed the addendum is comment-only, and restated its earlier findings at the new tip
  (PASS). Its file is the one that covers the revision that will be merged.

No pixel or rendering measurement is claimed anywhere in this job.
