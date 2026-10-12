# decision job-20261013-021706-74

MODE: FAST LANE — the owner authorised self-approval on automated gates only (2026-10-12).
**No architect, security or performance round ran for this job.** There are no three-lens verdict
files in this round directory, and this record does not pretend otherwise.

DECISION: APPROVE (on the automated gates below, per the fast-lane authorisation — not as the
result of a review round)

COMMIT: `add4c48` on `factory/job-20261013-021706-74`. 6 files. No new route, no migration, no
dependency, no authorization change.

## The owner's correction, taken as read

Two briefs, and the second one corrects the first: searching an asset id or a serial must show the
**whole lot**, not the one unit. That is the substantive change here, and it also fixed a real
design mistake from job 12 — a serial match filtered to a single row, which hid the units the
grader is actually holding.

## Removals, and where the things went

| removed from Lot Process | where it went |
|---|---|
| Import section (sheet importer + photo/scan/lot tools) | **moved** to the Product import page as `IntakeTools.tsx` — internals byte-identical |
| Price and List stages, the stage strip, "pipeline" framing | deleted; they were placeholders for work that does not exist |
| Serial and Status columns, the unfinished/all toggle | deleted from the UI |

**Nothing was deleted that a person can do.** The intake flows are reachable on
`/admin/product-import`; a check confirms their request expressions and labels are unchanged
(`/staff/lots` 5=5, `/staff/assets/scan-in` 4=4, `/staff/ai/intake-draft` 4=4, `Create lot` 1=1,
`Photo intake` 1=1, `Scan` 7=7). The one capability dropped from the UI is the **Clear-grade**
button — the brief specifies [A] [B] [C] [D] for that column, and the API door for clearing a
grade (`{"grade": null}`) is untouched, so it is one line away if it is wanted back.

## The table, exactly as briefed

`Asset ID · Lot · Class · Model · Upgrade Description · Grade` — verified in order from the source,
and the page carries no other control but the search.

## Editable description: two decisions worth checking

- **Always a field, never read-mode-with-an-edit-behind-it.** The brief says "MUST be an editable
  text field"; a control that has to be revealed first is a click the grader should not have to
  make. The pencil-and-reveal from job 12 is gone.
- **Saving happens on blur or Enter, and only when the value CHANGED.** An unchanged blur writes no
  request and no audit row — otherwise tabbing down a lot would fill the audit log with hundreds of
  rows saying nothing happened.

## Gates — run by the orchestrator against this tree

- `docker compose build api` (from the worktree) → exit 0
- `pytest -q` with the three deselects → **161 passed, 3 deselected** (160 + 1 new)
- `npx tsc --noEmit && npx next build` → **NEXT_EXIT=0**. The sizes are the move: `/admin/intake`
  **8.59 → 5.19 kB**, `/admin/product-import` **540 B → 9.95 kB**.

## Not verified

The inline textarea's save-on-blur, the highlight's rendering, and the keyboard walk (focus moving
to the next row's grade button, Up/Down between rows) are unverified without a browser — they are
DOM behaviour, and the gates exercise no DOM. The search resolution, the lot expansion, the
highlight id, the grade and notes writes and their audit rows are covered by 17 tests.
