# decision job-20261013-012056-3188

MODE: FAST LANE — the owner authorised self-approval on automated gates only (2026-10-12).
**No architect, security or performance round ran for this job.** There are no three-lens verdict
files in this round directory, and this record does not pretend otherwise.

DECISION: APPROVE (on the automated gates below, per the fast-lane authorisation — not as the
result of a review round)

COMMIT: `1ae73c0` on `factory/job-20261013-012056-3188`. 6 files.

## Two briefs, one job

**(A) Pipeline + universal search + ready-for-pricing. (B) The correction layer**: view toggle,
grade overwrite, description edit, audit — and a cleared grade returning to the queue.

## The defect the tests caught (worth the owner's attention)

The first run of the new tests failed on `test_clearing_a_grade_returns_the_unit_to_the_unfinished_queue`
— and it was right to. "Unfinished" had been filtered to the statuses a unit has *not yet* been
graded through, which excluded `graded`. But a cleared grade leaves the status at `graded` (the
trigger has no `graded -> tested` edge, so there is no legal demotion to write), which meant the one
flow the brief calls out — "if a grade is removed, the asset must reappear in the Unfinished view" —
silently did not work. The queue is now `grade IS NULL AND status IN (gradable)`, and the progress
count uses the same set, so the number beside the bar cannot disagree with the rows under it.

The other failure was a bug in my own test (`_lot_with_units` numbers units from S0, so `-S1` is the
second asset).

## Decisions the owner may want to check

- **`ready_for_pricing` is DERIVED, not stored.** `status='graded'` with a grade present is what
  that flag means here; a second column holding the same fact is a second thing to drift. It is
  exposed as a named field on every asset and as a lot count, so the pricing job has one thing to
  read.
- **Clearing a grade leaves the status at `graded`.** There is no `graded -> tested` edge in the
  trigger, so any demotion would be this handler pretending to a transition the domain does not
  have. The row therefore reads "graded" with no grade, and the workbench labels that state. If the
  owner wants a real demotion, that is a trigger change and a separate job.
- **`grade` must be PRESENT in the body even when null.** `model_fields_set` distinguishes "clear
  it" from "forgot it" — a body that omits the field is still a 422, so the chat rail and every
  existing caller keep their old behaviour exactly. A test pins it.
- **The description edit is a new door** (`POST /staff/assets/{id}/notes`), roles = the grading
  roles, audited with a before/after pair, and deliberately absent from `GUARDED_ACTIONS` /
  `TOOL_ROLES` so no agent grant can reach it.

## Gates — run by the orchestrator against this tree

- `docker compose build api` (from the worktree) → exit 0
- `pytest -q` with the three deselects → **159 passed, 3 deselected** (151 + 8 new)
- `npx tsc --noEmit && npx next build` → **NEXT_EXIT=0**; `/admin/product-import` is now a **540 B**
  shell and `/admin/intake` 8.38 kB, which is the shared-panel split working — one importer, two
  doors, not two copies.

## Preservation check (no review round ran, so this is the substitute)

The photo/scan/lot-creation flows were **moved, not edited**: `/staff/lots` 5=5,
`/staff/assets/scan-in` 4=4, `/staff/ai/intake-draft` 4=4, `Create lot` 1=1, `Photo intake` 1=1,
`Scan` 7=7 against the base. The importer's panel is the same component file the standalone route
renders, so there is no second implementation to drift.

## Not verified

The funnel's rendering, the stage strip, the inline description editor and the segmented control
are unverified without a browser. The backend behaviour — search resolution, scope, overwrite,
clear, audit rows, the ready flag — is covered by the eight new tests.
