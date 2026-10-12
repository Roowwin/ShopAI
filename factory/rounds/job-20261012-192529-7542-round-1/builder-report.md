# builder report — job-20261012-192529-7542 (round 1, and the round that lands)

Item 1 of the owner's clean-sweep brief. Items 2 and 3 are not in this job: the header-height audit
waits on the owner's measurements, and the stale-worktree sweep was done in the main tree (it is not a
worktree task - 10 empty orphan directories and 3 merged-and-clean worktrees removed, and one worktree
holding uncommitted backoffice work left in place and reported).

## The numbers the commit message owes (the architect was right that it reports none)

**Gate** (after `docker compose build api` from this worktree; statuses taken from the command, not a
pipe):

```
docker compose run --rm api pytest -q <3 deselects>           -> 125 passed, 3 deselected in 36.01s
docker compose run --rm api pytest -q tests/test_catalog_filters.py -> 15 passed (was 10; +5 new)
docker compose run --rm --no-deps storefront sh -c "npx tsc --noEmit && npm run build"
                                                              -> status 0, "Compiled successfully"
```

125 = the 120 the previous jobs carried plus the 5 tests this one adds. The deselect list is unchanged.

**Live, through the worktree-built api against real stock** - the acceptance line itself:

| filters in force | Brand facet |
|---|---|
| (unfiltered) | all 15, unchanged: `amd:3 asus:4 apple:7 cisco:3 dell:8 hp:4 intel:3 kingston:4 lg:1 lenovo:5 logitech:6 netgear:1 samsung:5 seagate:1 tp-link:2` |
| `category=laptops` | `asus:1 apple:3 dell:2 hp:1 lenovo:2 samsung:1` - Cisco, Seagate, AMD, Intel, LG, Netgear, TP-Link, Kingston and Logitech all gone |
| `category=networking&q=router` | `tp-link:1` only |
| `category=accessories&brand=logitech` | `asus:1 dell:1 hp:1 lenovo:1 logitech:6` - the brand in force stays listed and the others survive |
| `category=parts&grade=A` | `kingston:1 seagate:1` - the seeded BarraCuda really does have a grade-A unit |

## Two runs failed before this one, and neither was the implementation

The builder-report of the previous job said the round-1 green was false. This job's version of that is
its inverse: two RED runs that were measurement faults, not code faults.

1. The first version of the unit-scoping test asserted a brand's **absence** ("a brand with no
   accessories must not be offered under Accessories"), which seeded stock can always falsify. I
   verified the cause before touching anything - the seeded Seagate BarraCuda sits in Parts with one
   grade-A and one grade-D unit, so `seagate` under `grade=A` is that product, not a leak. The tests
   were rewritten so every expectation is the same filtered query read before and after the fixtures
   exist: their own contribution, +1 or +0, which no seeded row can fake.
2. The re-run then failed identically, because **the api image bakes `apps/backend`** (no bind-mount -
   `docker-compose.yml` gives it no volumes, unlike the storefront) and the container was still running
   the previous test file. Rebuild is not optional after editing backend tests.

## What the reviewers corrected in my own claims

- **"character for character" / "the facet gets the same pinned"**: false as to the TEXT. `CATALOG_BRANDS`
  itself changed (the join, the status move, the placeholders), so the new statement test compares
  against the very constant the function builds from and its equality half is tautological - it cannot
  detect a template edit. What IS unchanged, and what the spec actually asks for, is the RESULT: the
  unfiltered facet returns today's 15 brands with today's counts, which holds because
  `products.category_id` is `NOT NULL REFERENCES categories(id)` so the added join drops and multiplies
  nothing. The meaningful half of that test is the "no unset filter leaked" and "no `%` left" assertions.
  Note the pre-existing list test has exactly the same shape, so this is a property of the house pattern
  rather than something this job introduced. Recorded, not changed: the verdicts are on this revision.
- The commit message reports "this round's numbers" and then names none of them. They are above, and
  this file is committed with the round, so the record carries them; the commit itself was left alone
  because amending it would invalidate three verdicts written against that exact revision.

## Not verified here

The plan (no EXPLAIN - the performance reviewer reached the same limit and judged it immaterial at
~57 products), and anything on a rendered page: this changed no storefront file, and the facet's list
is inside the toolbar panel, which exists only while the menu is open.
