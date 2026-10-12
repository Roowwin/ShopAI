# builder report — job-20261012-181415-776 (round 1)

Closes the record gap the round-1 architect named: the commit message carried the reasoning but not
the figures this job's Acceptance asks for. Everything below was run from the worktree, on commit
e949fb6.

## Gate (after `docker compose build api` from this worktree)

```
docker compose run --rm api pytest -q \
  --deselect tests/test_assistant.py::test_assistant_proposes_without_writing \
  --deselect tests/test_assistant.py::test_assistant_executes_scan_in \
  --deselect tests/test_storefront_api.py::test_search
```

**117 passed, 3 deselected** in 78.29s. Unchanged from job 19's 117/3, as expected for a
storefront-only diff.

## Storefront build

```
docker compose run --rm --no-deps storefront sh -c "npx tsc --noEmit && npm run build"
```

`tsc --noEmit` clean; `next build` green, **13/13 static pages generated**, 13 routes in the table -
the same route set as job 19. No new dependency (`package.json` is not in the diff).

## Live check (worktree build served on a throwaway container, then grepped)

The worktree's build was served with `next start` on `127.0.0.1:3099` against the running API, so the
running storefront was never touched:

| request | result |
|---|---|
| `/` | 200; Shop trigger present with `aria-expanded` + `aria-controls`, FAQ and Ask AI as siblings |
| strip removal | `aria-label="Categories"` 0 hits, both gradient fades 0 hits; the single `scrollbar-width:none` belongs to the facet toolbar, not a strip remnant |
| `/?min_cents=20000&max_cents=50000` | trigger reads `Price: $200 - $500` |
| `/?min_cents=10000&max_cents=30000` (a band from the OLD set) | trigger reads `Price: $100 - $300` - still filters, now legible |
| `/?min_cents=290000&max_cents=290100` (matches no preset, no stock) | trigger reads `Price: $2,900 - $2,901`; empty state reads `No devices match $2,900 - $2,901.` (was "price band") |
| `/category/Phones` | 200, product cards render, **0** toolbar triggers - still filter-free |
| announcement copy | `Renewed tech. Zero waste. - Certified refurbished, delivered AU & NZ` intact |

The Shop menu's own links are not in the served HTML and cannot be: the categories are fetched
client-side, exactly as the strip's were before it, so "every category is in the menu" is verified
from the code (`cats.map` over the untouched `/store/categories` fetch, no hardcoded names anywhere in
the diff) and by the reviewers, not from HTML.

## Header height - COMPUTED, NOT MEASURED

There is no browser in the worktree, so nothing here was rendered. By class arithmetic:

- **1280px: ~81px, unchanged from job 19.** The centre group is `md`-only and its links carry
  `min-h-[44px]`, the same 44px the row was already sized by (the Button base), so the row stays
  `py-2` = 16 + 44 = 60px over the announcement band's ~21px.
- **390px: ~81px, or ~94px if the 11px announcement sentence wraps to two lines** (~8 + 2 x ~13).
  The centre group is hidden below `md`, so the mobile row is unchanged; the wrap is the only
  variable. Devtools settles it in one line: `document.querySelector('header').getBoundingClientRect().height`.

## Note on the spec's own wording

Deliverable 1 says "Tab closes" while the Acceptance list says "Tab/arrows through the links". The
code follows the Acceptance, which is the correct disclosure behaviour - Tab has to be free to walk
into the list, so the menu closes when focus leaves the wrapper instead. The spec text is the thing
that is wrong; recorded here rather than edited after the verdicts, so the reviewed spec stays the
spec that was reviewed.
