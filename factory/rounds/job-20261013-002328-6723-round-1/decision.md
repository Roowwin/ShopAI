# decision job-20261013-002328-6723

MODE: FAST LANE — the owner authorised self-approval on automated gates only (2026-10-12).
**No architect, security or performance round ran for this job.** There are no three-lens verdict
files in this round directory, and this record does not pretend otherwise.

DECISION: APPROVE (on the automated gates below, per the fast-lane authorisation — not as the
result of a review round)

COMMIT: `3276020` on `factory/job-20261013-002328-6723`. 4 paths, 2 of them renames.

## The owner's instruction
"change name into Product import" — following job 8 (`1b912b7`), which shipped the feature as
*Corporate Import*.

## What moved
Renamed wherever it is a NAME, so label, URL, API path and Python identifiers agree rather than
leaving a "Product Import" heading over a `/admin/corporate-import` URL:

| surface | before | after |
|---|---|---|
| route dir | `app/admin/corporate-import` | `app/admin/product-import` |
| nav label | Corporate Import | Product Import |
| page heading | Corporate import | Product import |
| API | `/staff/imports/corporate/{preview,commit}` | `/staff/imports/products/{preview,commit}` |
| symbols | `ROLES_/ACTION_CORPORATE_IMPORT`, `preview_/commit_corporate_import`, `CorporateImportPage` | `…_PRODUCT_IMPORT`, `preview_/commit_product_import`, `ProductImportPage` |
| test file | `tests/test_corporate_import.py` | `tests/test_product_import.py` |
| ledger strings | movement reason + audit action `corporate_import`, lot note "corporate import" | `product_import`, "product import" |

Verified no straggler: `grep -rn "orporate" apps docs scripts` returns **nothing**, and neither
does a grep for the old route or API path.

**The input FORMAT is deliberately unchanged.** The sheet is still the supplier's corporate column
contract (Asset, Status, Lot, Class, Mfg, Model, Grade, Serial#, Resale, Audit/Cosmetic/Functional);
only the feature's name moved. Renaming the column contract too would have been a claim that the
sheet changed shape, which it did not.

## Gates — run by the orchestrator against this tree

- `docker compose build api` (from the worktree) → **BUILD_API_EXIT=0**
- `pytest -q` with the three deselects → **137 passed, 3 deselected** (PYTEST_EXIT=0, 40.5s) —
  identical to job 8's count, as a pure rename should be.
- `npx tsc --noEmit && npx next build` → **NEXT_EXIT=0**, `/admin/product-import` prerendered at
  5.58 kB, and **no `/admin/corporate-import`** in the route table.

## The one thing this rename cannot fix by itself

`/admin/corporate-import` will now 404 for anyone with the old URL bookmarked. Nothing in the repo
links to it any more (grepped), so this is a note rather than a defect — and the running backoffice
needs a restart to serve the new route at all, which the landing does.

## Residual risk

Same as job 8 and unchanged by this rename: the page's in-browser render is unverified (no browser
in this loop), and the ledger strings change means dev rows written by job 8's tests still read
`corporate_import` while new ones read `product_import`. Both are test rows; no real import has
been run.
