# decision job-20261013-004111-2689

MODE: FAST LANE — the owner authorised self-approval on automated gates only (2026-10-12).
**No architect, security or performance round ran for this job.** There are no three-lens verdict
files in this round directory, and this record does not pretend otherwise.

DECISION: APPROVE (on the automated gates below, per the fast-lane authorisation — not as the
result of a review round)

COMMIT: `959e650` on `factory/job-20261013-004111-2689`. 3 files, all inside the product importer
and its page. No new route, no migration, no dependency.

## The owner's three asks

1. **Status "Active" → `received`.** There is no `active` in the ASSET status vocabulary at all —
   that word belongs to the LOT vocabulary, which is why the sheet was refused rather than
   mis-read. `received` is the bottom of the ladder and exactly what an in-service unit is here:
   taken in, testable, gradable.
2. **Grade "Unassessed" → NULL**, and ungraded assets importable.
3. **Preview limit 50 → 200 rows.**

## Design decisions worth the owner's eye

- **The synonym table is consulted AFTER the canonical vocabulary**, so a future synonym can never
  shadow a real status value. `_STATUS_SYNONYMS` holds one entry (`active`); nothing else was
  invented.
- **The no-grade word list is closed and spelled out** (`unassessed / ungraded / not assessed /
  no grade / n/a / none / nil / tbd / pending`) rather than a fuzzy match. A fuzzy match in this
  direction would quietly swallow a grade the operator *did* mean — the one error here that could
  reach a customer. A test pins the other side: `"-"` and `"see attached note"` are still refused.
- **Translations are reported, not silent.** The payload carries a `translations` block aggregated
  by (column, from, to) with a row count, and the preview prints it above the grid. Rewriting the
  operator's data without showing them would be worse than the mismatch it fixes.
- **Translation is not a way past the DB's rules.** `Status=listed` + `Grade=Unassessed` is still
  blocked (a listed unit needs a real grade); a test asserts it.

## Gates — run by the orchestrator against this tree

- `docker compose build api` (from the worktree, so the image bakes THIS branch) → exit 0
- `pytest -q` with the three deselects → **144 passed, 3 deselected** (137 + this job's 7 new)
- `npx tsc --noEmit && npx next build` → **NEXT_EXIT=0**, `/admin/product-import` prerendered

## An operational hazard this job found and fixed (not part of the ask)

Running `docker compose run` **with the worktree as the cwd** recreated the `postgres` container
with its config bind-mounted from `factory/worktrees/<id>/infra/postgres/...`. Data was never at
risk (the data volume is the named `rfo_pgdata`; verified 10,768 assets after), but the container
was left pointing at a directory that `approve` deletes — a restart afterwards would have failed
to start. Recreated from the main tree, and `docker inspect rfo-postgres-1` now shows **zero**
worktree-sourced mounts. The safe iteration pattern is `build` from theworktree, `run` from the
main tree — the image tag is shared, so the code under test is still the branch's.

## Not verified

The preview screen's appearance and the translation table's rendering (no browser in this loop).
The gates exercise no pixel.
