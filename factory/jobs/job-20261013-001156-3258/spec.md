# backoffice J8: Corporate Excel importer - /admin/import mapping preview + bulk lot/asset ingest

## Context
The owner's brief: *"Build a robust importer for the corporate asset format (Asset, Status, Lot,
Class, Mfg, Model, Grade, Serial#, Resale, etc.)."* The repo has **no spreadsheet reader at all** -
`app/admin/intake/DropZone.tsx:21-27` states it plainly and `AiReview.tsx:109-114` renders the
briefed "spreadsheet rows" column as a *named absence* rather than inventing rows. This job wires
that column to something real.

**FAST LANE: no architect/security/performance review round runs.** The gates are
`docker compose build api` + `pytest -q` (3 deselects; expect 125/3 baseline + the new tests) and
`tsc --noEmit && npx next build`. Neither gate exercises a pixel of the UI, so your self-report is
the only quality signal for the page.

## Ground truth (verified against the live DB, not the ORM file)
- `assets`: `lot_id` is **NOT NULL**; `serial_number` is **citext with a partial UNIQUE index**
  (dupes are case-insensitive); `status` CHECK in 10 values; `grade` CHECK in A-D;
  `cost_cents` >= 0; **`chk_listed_has_price`: status='listed' requires `sale_price_cents` NOT NULL**;
  free text lives in `notes` (TEXT) and `condition_report` (JSONB).
- `products`: `brand_id`/`category_id` NOT NULL, `model`, `title`, `slug` UNIQUE, `status` in
  draft/active/archived. `brands.name` UNIQUE, `categories.slug` UNIQUE.
- `lots`: `lot_number` UNIQUE, status in intake/active/completed/cancelled.
- Trigger `rfo_lot_status_from_assets` (AFTER INSERT OR UPDATE ON assets) flips a lot to
  **completed** when it holds zero `listed` assets and back to **active** when it regains one.
  A bulk insert therefore has a *storefront-visible* side effect - see Acceptance.
- `openpyxl` is **NOT installed**; `python-multipart` **is** (that is how `staff_ai.py:38-61`
  already takes an upload). `app/schemas/` is empty; Pydantic models live inline in the API module.

## Deliverable 1 - `apps/backend/app/api/v1/staff_imports.py` (new)
Two multipart routes, one shared parse+mapping core:

- `POST /staff/imports/corporate/preview` -> parses, maps, validates, **writes nothing**.
- `POST /staff/imports/corporate/commit` -> same parse+mapping, then writes; refuses with 422 and
  the SAME report if any row is blocked, committing nothing.

**Column mapping** (case/space/punctuation-insensitive, matched on normalised header text):
`Class -> category`, `Mfg|Manufacturer|Make -> brand`, `Model -> product model + title`,
`Serial#|Serial|Serial Number|IMEI -> serial_number`, `Resale|Resale Price -> sale_price_cents`,
`Grade -> grade`, `Status -> status`, `Lot -> lot_number`, `Audit` + `Cosmetic` + `Functional`
merged into `technical_notes`. Report every header that mapped and every one that did not; never
silently drop a column.

**`technical_notes`** - the merged Audit/Cosmetic/Functional text - is written to `assets.notes`
(labelled per source: which column contributed which sentence), and the same three parts are kept
structured in `assets.condition_report` JSONB. State in your report which field the AI Studio
surface actually reads and make the merged text reach it.

**Formats**: CSV/TSV (stdlib `csv`, delimiter sniffed, utf-8-sig then cp1252) and XLSX/XLSM
(`openpyxl`, `read_only=True, data_only=True`, first worksheet, row 1 = header). A legacy `.xls`
and any other extension get a 422 naming what is supported - not a traceback.

**Lot integration**: rows are grouped by the `Lot` column. An existing `lot_number` is reused;
a new one is created with that number. A row with **no** Lot is a blocking issue (the column is
NOT NULL in the DB, so it cannot be quietly defaulted).

**Per-row validation** (blocking issues block the whole import, atomically):
unknown/blank-serial, missing Lot, grade not resolvable to A-D, status outside the 10 DB values,
price not parseable or negative, duplicate serial **within the file** (case-insensitive), serial
already present in the DB, and status `listed` without a Resale price (the DB constraint).

**Guard**: `ROLES_CORPORATE_IMPORT = ("admin", "manager")`, enforced BOTH by the route's
`Depends(require_roles(...))` and in-body via `staff_ops._require_role(..., db=None)` - `db=None`
so the ADR 0008 agent-grant branch is unreachable. **Do NOT** add anything to
`staff_ops.GUARDED_ACTIONS` or `staff_ai.TOOL_ROLES`: `test_autonomy_execute.py` and
`test_chat_tool_roles.py` pin those tables, and this door is deliberately not chat-dispatchable.

**Writes**: `Lot` (find-or-create), `Product` (find by brand+category+model, else create with
slug from brand+model, unique-ified - report which were created vs matched), `Asset`, and one
`StockMovement(qty=1, reason="corporate_import")` per asset, plus one `audit_log` row per import.
Reuse `_gen_lot_number`, `_409`, `_audit_execution`-shaped auditing from `staff_ops`.

## Deliverable 2 - `apps/backend/requirements.txt`
Add `openpyxl>=3.1`.

## Deliverable 3 - `apps/backend/tests/test_corporate_import.py` (new)
Match `tests/test_intake.py`'s fixtures/helpers (`_h`, `_staff`, `_cleanup`) and add a
`finally`-based purge of everything this file creates (assets -> movements -> products -> lots,
by a unique test prefix); the stock ledger and audit log are append-only and must not be deleted.
Cover: preview mapping incl. merged technical_notes; missing-required-column report; XLSX path
(build the workbook in-memory with openpyxl); commit grouping lots + creating products once per
(brand,class,model); commit refusing atomically on a bad row and writing NOTHING; duplicate serial
(case-insensitive, and across file + DB); `listed` without price blocked; RBAC 403 for a
non-admin/manager role and 401/403 with no token; and that a re-run of the same file does not
double-import.

## Deliverable 4 - `apps/backoffice/app/admin/corporate-import/page.tsx` (new)
Three states in one page, matching `intake/page.tsx`'s shell
(`mx-auto max-w-5xl space-y-6 px-4 pt-8 pb-16`, `Heading level="h1"` + `text-sm text-ink-500`
subtitle) and reusing the UI kit from `@/app/components/ui`:
1. **Upload** - the `DropZone.tsx` file-input idiom, `accept=".csv,.tsv,.xlsx,.xlsm"`.
2. **Mapping preview** - the detected column map as a table (source header -> target field, and an
   explicit "not mapped" list), the row sample with per-row issues, and the summary counts.
   Use `AiReview.tsx`'s two-column `rounded-card bg-surface-muted p-4 ring-1 ring-line` idiom.
   **Every number rendered comes from the preview payload** - no client-side counting of rows
   that are not in the payload, no invented percentage.
3. **Success summary** - `BulkBar.tsx`'s run-summary idiom: created/failed counts, the per-lot
   breakdown, and the honest partial statement when some rows did not land.
Errors read as `j.detail ?? fallback`; `msg`/`err` lines use `text-brand-300` / `text-danger-600`.
A blocked import must render the blocking issues, not a generic failure.

## Deliverable 5 - nav
One line in the `inventory` group of `app/components/nav.ts`:
`{ href: "/admin/corporate-import", label: "Corporate Import" }`. No other nav edit (the palette
and active-state derive from `GROUPS`).

## Acceptance
- Gate: `docker compose build api` then `pytest -q` with the 3 deselects; report the exact count.
- Build: `tsc --noEmit && npx next build` with the REAL exit status (redirect to a file and read
  `$?` - a `| tail` reported a green build on a TS2304 failure earlier this phase), and the route
  count (baseline 21, +1 for this page).
- The import is atomic: a file with one bad row creates **nothing**, and the report says which
  row and why.
- Report the storefront-visible side effect: how many assets land `listed` (and therefore flip
  their lot active and become catalog-visible) for a given input, and say that the preview shows
  that count before the owner commits.
- Report which field the AI Studio actually reads for asset free text.
- Say plainly what is NOT verified without a session: the in-browser render, the file picker,
  and drag-and-drop.

## Constraints
- Work only on branch factory/<job-id>; LF/no-BOM; work with relative paths from inside the
  worktree; never `git -C`. Gate AFTER `docker compose build api` (the image bakes the code).
- Do NOT touch: `.env`, `secrets/`, `infra/`, `factory/*`, `apps/storefront/**`.
- Do NOT run `docker compose restart backoffice` - the running container serves the MAIN tree.
