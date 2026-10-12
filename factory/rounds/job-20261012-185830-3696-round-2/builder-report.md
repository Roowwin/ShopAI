# builder report — job-20261012-185830-3696 (round 2, and the round that landed)

## What the two rounds were

Round 1 (`92ce800`) added the category-scoped `q`: the endpoint predicate, the URL vocabulary, the
toolbar pill, and three tests. Round 1's architect returned CHANGES for a real defect in one of those
tests - a scoping assertion that ended in an absolute count (`len(category=accessories) > 1`) and so
depended on the ten accessories the demo seeder installs, which no migration creates. It passed on the
shared dev database and would have failed in CI. Round 2 (`72a3e6a`, test file only) replaces the
narrowing proof with one measured on four rows the test stamps itself - two matching accessories, one
matching laptop, one accessories row the term must not match - so the term-filtered set is a strict
superset relationship and no absolute count is left anywhere. The round-2 architect re-walked every
assertion and named the row each depends on, then PASSed.

## Gate (after `docker compose build api` from the worktree)

**120 passed, 3 deselected** in 39.01s at the round-2 tip - 117 plus the 3 tests this job adds.
`tests/test_catalog_filters.py` alone: 10 passed (was 7). The deselect list is unchanged: nothing here
leans on hand-seeded stock, which was the point of the rework.

## Storefront build

`tsc --noEmit` clean, `next build` green, 13/13 pages and 13 routes, run at the round-1 tip. The
round-2 delta is the test file only (application blobs byte-identical: store_catalog.py `d81cb5c6`,
catalogFilters.ts `8fa82330`, LoadMore.tsx `3898535c`), so the build is unaffected by it.

## Live check on the real catalogue (through the worktree-built api)

The acceptance line itself, and the reason the job exists:

| request | n | result |
|---|---|---|
| `?q=dock` | 3 | the three docks |
| `?category=accessories&q=dock` | 3 | the same three |
| `?category=laptops&q=dock` | **0** | same word, another category - nothing leaks |
| `?category=networking&q=router` | 1 | TP-Link Archer AX55 |
| `?category=networking&q=server` | **0** | no servers |
| `with_filters=1` | - | `applied.q = "dock"` |

Per-shortcut counts for Job B, measured the same way: Docks 3, Mice 1 (`mouse`), Keyboards 1
(`keyboard`), Hubs 1, Webcams 1, Headsets 1, Switches 5, Routers 1 - and Laptops 0, which is why it
gets no sub-menu.

## What is NOT verified, stated rather than implied

- The fresh-database PASS itself. Reproducing round 1's failure needs a purged dev database, which is
  destructive and out of scope; the warrant for the fix is the code property the architect
  independently checked (every assertion names a row this test stamps).
- The served-page side of the pill: the storefront has no test suite and the running shop serves the
  main tree, so it is checked at deploy time (after this merge), not here.

## Two latent notes from the round-2 architect, recorded not fixed

1. Every catalog read in that test file pins `limit=100`, so the strict-superset assertion would flake
   if the live store ever held more than 100 active accessories rows. Not a defect today (10), but it
   is the same shape of fragility this job just removed, one level out.
2. The seed path is `apps/backend/scripts/seed_demo.py`; the round-2 commit message abbreviates it to
   `scripts/seed_demo.py`. Same file, and the abbreviated form is the one this suite's comments have
   used throughout.

## Provenance of the verdicts

All three round-2 verdicts were written against the branch tip `72a3e6a` (through the two-commit diff),
so unlike the previous job's round, no reviewer's finding is stranded on a superseded revision.
