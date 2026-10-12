# decision job-20261013-014133-1626

MODE: FAST LANE — the owner authorised self-approval on automated gates only (2026-10-12).
**No architect, security or performance round ran for this job.** There are no three-lens verdict
files in this round directory, and this record does not pretend otherwise.

DECISION: APPROVE (on the automated gates below, per the fast-lane authorisation — not as the
result of a review round)

COMMIT: `0e8bb1e` on `factory/job-20261013-014133-1626`. 4 files. No new route, no migration, no
dependency, no authorization change.

## What the brief asked for, and what was already there

Four of the five asks were already built by jobs 11-12 and only needed re-ordering or re-labelling:
the search bar, the quick-grade bar with A-D, the immediate disappearance from the queue, the
"ready for the store manager" hand-off, and the description edit. **The job is therefore mostly a
restructure**, and the honest framing is that this round moved the work rather than making it.

New this round:

- **Process above Import**, with Import behind a collapsed `<details>`. The page reads by who does
  the work and how often; the pipeline's sequence is stated once, on the strip.
- **The Stage component lost its number.** With Process first, a "1" on the Import block would sit
  *below* the "2" — the page arguing with its own strip.
- **A Model column** (`p.model`, falling back to `product.title`) — the brief names Model, and the
  grader reads against it. Backend adds `product_model` to the worklist payload.
- The Price/List cards now name the **store manager** as the owner of that half of the pipeline,
  which is the brief's "Logic" section made visible where the stage will be.

## THE ONE THING TO CHECK — the queue is wider than the brief's wording

The brief says the queue is "assets that are currently **received** but do not have a grade".
The queue is **`grade IS NULL AND gradable`** — a superset. It was NOT narrowed, and that is
deliberate:

| included | why |
|---|---|
| `received`, no grade | the brief's case, and the bulk of it |
| `tested` / `in_repair`, no grade | already inspected, still needs a grade; excluding them strands them |
| `graded`, no grade | a unit whose grade was **taken back** — the trigger has no `graded -> tested` edge, so this is the only state that correction can produce |

The third row is why narrowing would be a regression: job 12 proved live that clearing a grade
returns the unit to the queue, and that flows through exactly this case. Filtering to
`status='received'` would silently re-break it. The queue and the progress count use the same set,
so the number beside the bar cannot disagree with the rows under it.

**If the owner wants the literal `received`-only queue**, say so and it is a one-line change — but
the take-back round-trip would need a trigger change to keep working.

## Gates — run by the orchestrator against this tree

- `docker compose build api` (from the worktree) → exit 0
- `pytest -q` with the three deselects → **160 passed, 3 deselected** (159 + 1 new)
- `npx tsc --noEmit && npx next build` → **NEXT_EXIT=0**, `/admin/intake` 8.59 kB,
  `/admin/product-import` still a 540 B shell (the shared panel).

## Preservation check

The intake flows survived the re-order untouched: `/staff/lots` 5=5, `/staff/assets/scan-in` 4=4,
`/staff/ai/intake-draft` 4=4, `Create lot` 1=1, `Photo intake` 1=1, `Scan` 7=7, and `<Stage>`/`</Stage>`
balance 4/4. The first build failed on an unclosed `<details>` from the re-order script — caught by
`tsc`, fixed, then green.

## Not verified

The collapsed disclosure's behaviour, the hero search's appearance and the Model column's rendering
are unverified without a browser. The queue's contents, the search resolution and the grade
round-trip are covered by the tests.
