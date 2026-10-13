# End-to-end validation: the asset lifecycle, the parent/child shelf, and the admin health check

This document covers the three artefacts that were added to validate the platform end to end:

| Artefact | Path | Runs where |
|---|---|---|
| E2E lifecycle + parent/child suite | `apps/backend/tests/test_e2e_lifecycle.py` | in the `api` container, under pytest |
| Admin accessibility / contrast health check | `apps/backoffice/scripts/a11y_health_check.py` | on the host (stdlib only) |
| This write-up | `docs/e2e-validation.md` | — |

---

## 1. The E2E suite

### Why it exists

Every other suite in `apps/backend/tests/` pins one door: the sheet importer, the status ladder,
the grading workbench, the storefront API. None of them walks a unit through the whole pipeline,
and none of them can tell **"published correctly"** from **"published too early"** — both end
with the unit on sale. This suite walks one unit from a serial off the intake dock to a thing a
shopper can buy, and asserts the shelf is **empty at every stage before the last**.

### The lifecycle it validates

`Import → Grade → Price → List`, with the storefront checked between every pair of stages:

```
POST /staff/products            -> the PARENT (a product/model), created already `active`
POST /staff/lots                -> a lot, created `intake`          <- the release switch
POST /staff/assets/scan-in      -> the CHILD (one unit), `received`
        ... storefront shows NOTHING: an unstocked parent 404s nowhere, it renders empty
POST /staff/assets/{id}/grade   -> `test_first` walks received -> tested -> graded
        ... still nothing: `graded` is not `listed`
POST /staff/assets/{id}/price   -> sale_price_cents
        ... still nothing: priced is not listed
POST /staff/assets/{id}/status  -> `listed`
        ... still nothing: a listed unit in an INTAKE lot is still held back
POST /staff/lots/{id}/activate  -> now, and only now, the unit is on the shelf
POST /store/reservations        -> reserve the exact child
POST /store/checkout            -> the order line names that child, not the parent
```

### The parent/child shape, and what the tests defend

A `products` row is the **parent** (the model, shared by every unit of it); an `assets` row is the
**child** (one physical unit, carrying its own grade, price and serial). The child is the only
thing with a price; the parent only ever shows a `min()` over whichever children happen to be
listed *and* in an active lot.

The suite exists to catch the ways that shape can break the shop:

| Test | Invariant |
|---|---|
| `test_e2e_import_grade_price_list_publishes_once_at_the_end` | the four stages, and an empty shelf after each of the first three |
| `test_e2e_the_unit_a_shopper_buys_is_the_exact_child` | checkout locks the child: the order line carries the child id; reserving the only child empties the shelf, releasing it restores it |
| `test_two_parents_sharing_a_model_keep_their_own_shelves` | one model arriving as two product records does **not** mix their units or their from-price |
| `test_a_child_is_held_back_until_its_own_lot_is_released` | the lot, not the unit's own status, is the release gate — and knowing the child id does not get around it |
| `test_unlisted_and_unpriced_children_never_reach_the_shelf` | graded-but-unlisted and dock-fresh children stay off the shelf; the full serial never travels, only its last four digits |
| `test_a_parent_with_no_children_renders_empty_rather_than_missing` | an empty shelf is a page (200, `units: []`), not a 500; an unknown slug is a clean 404 |

### Running it

The `api` image **bakes the code** — there is no bind mount — so a source change needs a rebuild
before the gate sees it:

```
docker compose build api
docker compose run --rm api pytest -q
```

To iterate on test code without a rebuild, mount the backend tree over `/app` (run this from the
repo root, or compose's relative bind mounts will resolve against the wrong directory):

```
docker compose run --rm -v "$(pwd -W)/apps/backend:/app" api pytest -q tests/test_e2e_lifecycle.py
```

The suite is part of the normal gate: the accepted baseline is **3 deselects** (the two
LLM-flaky assistant tests plus `test_search`), and this file adds no deselects and touches no
hand-seeded stock — it builds every row it asserts on, under its own unique `pytestE2E…` tag.

### House rules it follows

* No shared helpers: `conftest.py` carries the `client` fixture and nothing else, so this file
  defines its own `_h` / `_staff` / `_tag` / `_one`, exactly as its neighbours do.
* `asyncio_mode = auto`, so no `@pytest.mark.asyncio`.
* `assert r.status_code == N, r.text` — the response body is always the failure message.
* **Rows it creates mostly cannot be deleted.** `rfo_app` holds only SELECT+INSERT on
  `stock_movements`, and the ledger's FK pins every unit it names, so the units, lots and
  products stay in dev. Only identity rows and the orders this file creates are cleaned up.
* Most tests deliberately leave their lots in `intake`, which keeps their stock off the
  storefront entirely — a lot that is not active is invisible to the catalog whatever its units
  say. The two tests that must prove the shelf really works do activate their lot.

### A note on flakiness

Every suite in this repo sweeps `staff_users WHERE email LIKE 'pytest-%'` during cleanup, so two
gates running **concurrently against the shared dev database** delete each other's identities
mid-test; the symptom is a `401 {"detail": "account unavailable"}` partway through a test that
was passing on its own. Run the gate when the DB is quiet — this is a property of the shared dev
database, not of this file.

---

## 2. The admin health check

```
python apps/backoffice/scripts/a11y_health_check.py           # human report, exits 1 on any FAIL
python apps/backoffice/scripts/a11y_health_check.py --strict  # WARNs fail the run too
python apps/backoffice/scripts/a11y_health_check.py --json    # machine-readable
```

It runs on the **host** with the standard library only. It cannot run inside `api`: that service
has no volumes and its image is `COPY . .` of `apps/backend` alone, so it never sees the
backoffice tree.

### What it checks

1. **Contrast.** Every `bg-*` + `text-*` pair in the admin source is enumerated and computed
   against the token values actually declared in `app/globals.css` (WCAG 2.1 AA: 4.5:1 body text,
   3:1 large text). The admin palette's ink scale is **inverted** — a higher ink number is
   lighter, i.e. stronger text on a dark ground — which is exactly the trap: `text-ink-900` reads
   like "very dark grey" and is in fact near-white.
2. **Accessibility smells** that need no browser: images with no `alt`, interactive elements with
   no accessible name, `onClick` on non-interactive elements, anchors with no `href`, fields with
   no label of any kind.
3. **Token drift**: colour utilities that neither the palette nor a known Tailwind builtin can
   resolve. An unresolved token is a WARN, never a silent pass.

### Design decisions worth knowing

* **Pairs are grouped by variant.** Without this, the idle state of the lot workbench's grade
  button (`bg-surface-sunken text-ink-500 … hover:bg-brand-700 hover:text-white`) yields a
  `bg-brand-700 + text-ink-500` pair that exists in **no** state — the hover fill belongs to the
  hover ink. Grouping by the variant prefix removed two such phantom pairs on the first run.
* **Comments are stripped before parsing.** Several comments discuss `<img>` and `<a>` in prose
  ("renders an `<a>`"); a reader that cannot tell prose from markup reports the explanation
  rather than the code. It blank-checks them in place so line numbers stay true.
* **Tags carrying a spread are skipped.** `<input className={…} {...rest} />` is a wrapper: the
  label, id and placeholder come from the caller, and flagging the wrapper reports the API.
* **Translucent fills** are composited over both candidate grounds (the panel and the page). A
  pair that fails on both is a FAIL; one that passes on one and fails on the other is a WARN
  showing both readings.
* **Two recorded exceptions are honoured, not re-litigated**: `--line` / `--line-strong` sit below
  the 3:1 non-text bar on purpose (they are hairlines; `globals.css` says not to "fix" them). They
  are never text, so they do not enter the sweep; their ≈102 uses are counted and reported as an
  accepted exception.

### First run: three findings, all real, all fixed

The check's first honest run found three genuine AA failures — all the same root cause,
`text-slate-500` on the deliberate **light** mock-storefront card inside `LivePreview.tsx`:

| Where | Pair | Ratio |
|---|---|---|
| `LivePreview.tsx:80` — the "Out of stock" badge | `bg-slate-100` + `text-slate-500` | 4.34:1 (< 4.5) |
| `LivePreview.tsx:85` — the photo placeholder, best case | `bg-slate-100` + `text-slate-500` | 4.34:1 (< 4.5) |
| `LivePreview.tsx:85` — the photo placeholder, worst gradient stop | `bg-slate-200` + `text-slate-500` | 3.86:1 (< 4.5) |

Both were changed to `text-slate-600`, which clears the bar against every gradient stop
(≥ 5.6:1). The check now reports **0 failures**, with 7 warnings — the warnings are checkbox,
file-input and search fields whose accessible name comes from surrounding markup, and they are
left visible on purpose rather than suppressed.

---

## 3. Honest limits

* The health check is a **static** sweep, not a rendering audit. It cannot see inheritance,
  `opacity-*` on an ancestor, an image behind a translucent panel, or a class assembled at
  runtime. Treat a FAIL as a real defect and a WARN as something to look at.
* The E2E suite asserts on the API and the database. It does not render the storefront React tree
  — the parent/child *page* is covered by the storefront's own build check plus the payload
  assertions here, not by a browser test.
* The child's `serial_tail` is masked to four digits by the API and the suite asserts that the
  full serial is absent from the payload. It cannot prove the masking holds for a serial shorter
  than four characters.
