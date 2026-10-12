# decision job-20261013-001156-3258

MODE: FAST LANE — the owner authorised self-approval on automated gates only (2026-10-12).
**No architect, security or performance round ran for this job.** There are no three-lens verdict
files in this round directory, and this record does not pretend otherwise.

DECISION: APPROVE (on the automated gates below, per the fast-lane authorisation — not as the
result of a review round)

COMMIT: `1b912b7` on `factory/job-20261013-001156-3258`. 6 files.
DIFF vs the branch point: `apps/backend/app/api/v1/staff_imports.py` (new),
`apps/backend/tests/test_corporate_import.py` (new),
`apps/backoffice/app/admin/corporate-import/page.tsx` (new), and three one-to-three-line edits —
`apps/backend/app/main.py` (import + include_router), `apps/backend/requirements.txt`
(+openpyxl), `apps/backoffice/app/components/nav.ts` (one nav entry). No `.env`, no `secrets/`,
no `infra/`, no `factory/*`, no `apps/storefront/**`.

## Gates — run by the orchestrator against this tree, not taken from a builder's report

- `docker compose build api` (from the worktree, so the image bakes THIS branch) → **BUILD_API_EXIT=0**
- `pytest -q` with the three deselects → **137 passed, 3 deselected** (PYTEST_EXIT=0, 43.9s).
  125 is the phase-12 baseline; the 12 over it are this job's new file.
- `npx tsc --noEmit && npx next build` (worktree mounted over `/app`) → **NEXT_EXIT=0**, 22 routes
  (21 before this job), with `/admin/corporate-import` prerendered static at 5.64 kB.

## What this job delivers, and the honesty statement it leads with

- The repo had **no spreadsheet reader at all** before this: the intake drop zone refused
  `.csv/.xlsx/.xls/.tsv` in words and `AiReview.tsx` rendered the briefed "spreadsheet rows" column
  as a named absence rather than inventing rows. Both are now backed by a real reader; neither
  claim was deleted.
- **The import is all-or-nothing.** A file with one bad row returns 422 carrying the same preview
  payload it was refused from, and writes nothing — proven in-test, not asserted
  (`test_commit_refuses_the_whole_file_when_one_row_is_blocked` checks the asset/lot/product counts
  are all zero afterwards).
- **The mapping is by name, not position** — the test's header is deliberately in a different order
  from the mapping table, and a second test proves `Manufacturer`/`Serial No`/`Product Class`/
  `Resale Price`/`Condition Grade` land on the same fields as `Mfg`/`Serial#`/`Class`/`Resale`/`Grade`.
- **The merged technical note** goes to `assets.notes` (the free-text field the asset workbench
  returns) with the three parts also kept structured in `condition_report`. The chat assistant's
  `asset_details` answer does **not** read `notes`; the studio reaches it through the asset detail
  view. That is stated in the module header because "the AI Studio reads this" would otherwise be
  an unchecked claim.
- **`rfo_app` cannot delete `stock_movements`** (SELECT+INSERT only, by grant), so a committed
  import's units are permanent in dev exactly as scan-in units are; the test file says so and
  purges only what the role is allowed to remove. This was found by running the tests, not by
  reading.

## Not verified (no browser in this loop)

The file picker, the preview's row rendering, and the summary's appearance. The build proves the
page compiles and the payload shapes match what the server returns; it does not prove the screen
looks right. The two gates exercise no pixel and no interaction — this job's UI quality signal is
the source above.

## Residual risk, stated once

`openpyxl` is a new third-party dependency in the api image (3.1.5 installed and pinned `>=3.1`).
It is a parser reading a file the operator themselves uploads, behind an admin/manager door, with
an 8 MiB and 5000-row ceiling; the image rebuild that installs it is part of the gate above.
