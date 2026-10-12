# catalog: scope the Brand facet to the filters in force (no more dead brands)

## Context
The catalog's Brand dropdown offers brands that cannot exist in what the shopper is looking at. The
facet query (`_brand_facets` -> `CATALOG_BRANDS`) takes no filters at all, so the SAME fifteen brands
come back for every category, with global counts - including "Cisco (3)" under Laptops (Cisco only
makes switches) and "Seagate (1)" under Laptops. Picking one gives the honest empty state rather than a
lie, but it is a dead-end option: the same disease as the seven dead sub-categories the previous brief
proposed, and it is the last place the catalog offers a filter that cannot match.

Found 2026-10-12 while probing stock for the nested-menu job; the fix was not requested then and is
item 1 of the owner's clean-sweep brief.

## Deliverable
1. The facet is computed under the same filters as the list, MINUS the brand itself:
   - category and the text term scope it (they decide which products exist at all);
   - the unit-level filters - grade and the price band - scope it too, so a brand whose matching units
     are all grade D is not offered to someone browsing grade A. The list's own doctrine already says
     a chip must never offer a brand "with nothing behind it", and behind a grade-A view a
     grade-D-only brand is nothing;
   - the brand predicate is deliberately NOT applied: a facet that filtered itself would collapse to
     the selected brand and strand the shopper on it, unable to switch.
   - `n` therefore means "products of this brand within the current filter set", which is what the
     dropdown displays beside the name.
2. No drift by construction: the predicates must be SHARED with `_catalog_sql`, not copied. Factor the
   category/term/unit clauses into helpers that both the list and the facet build from, so a future
   filter cannot be added to one and forgotten in the other. (`_catalog_sql` keeps its keyword-only
   shape and the byte-identical unfiltered statement it is pinned to.)
3. Shape unchanged where it must be: the response's `brands` array keeps its `{slug, name, n}` fields
   and order, so the storefront needs no change at all; the bare-array (non-envelope) branch is
   untouched; and with NO filters set the facet is exactly today's list, global counts included.
4. Tests (`apps/backend/tests/test_catalog_filters.py`, hermetic and delta-counted like the rest):
   - a brand that exists only in another category is absent from the facet under `category=X`, and
     present when unfiltered;
   - the same for a text term (`?q=`), including that a term scoping the facet hides a brand whose
     only products do not carry the term;
   - a unit-level scope: with `grade=X`, a brand whose only listed units are another grade is not
     offered;
   - self-exclusion: with a brand selected, the OTHER brands are still listed (the list must stay
     switchable) while the counts reflect the rest of the filters;
   - unfiltered, the facet is unchanged - delta-counted against a reading taken before the fixtures
     exist - and the fixtures are archived in the `finally`.
   No test may depend on the demo seeder's stock (the drift that makes `test_search` a deselect).

## Acceptance
- Live, through nginx: the Brand list under `?category=laptops` contains no Cisco and no Seagate; under
  `?category=networking&q=router` it contains TP-Link only; with a brand selected the others remain
  listed; and the unfiltered catalog's list is identical to before the change. Report the numbers.
- Gate: report the exact count after `docker compose build api` - expect 120 passed plus however many
  tests were added, 3 deselected - and say how many tests were added. The deselect list must not change.
- Storefront `tsc --noEmit && npm run build` green, reported with the REAL exit status (redirect to a
  file and read `$?` - do not let a `| tail` own it).
- State plainly that this is a backend-visible change: the storefront needs no edit, and the served
  HTML of a filtered catalog should show the scoped brand list in the toolbar panel (which renders
  only when the menu is open, so say what the HTML can and cannot show here).

## Allowed surfaces
`apps/backend/app/api/v1/store_catalog.py`, `apps/backend/tests/test_catalog_filters.py`. No storefront
change, no other endpoint, no migration, no data change, no new dependency. Anything else = CHANGES.

## Constraints
- Work only on branch factory/<job-id>; LF/no-BOM; gates AFTER `docker compose build api`; never touch
  .env, secrets/, infra/, factory/*.
- Not in this job: the header-height audit (waiting on the owner's measurements) and the stale-worktree
  sweep (already done in the main tree, and it is not a worktree task).