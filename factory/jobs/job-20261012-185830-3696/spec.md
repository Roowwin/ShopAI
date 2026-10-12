# catalog: a category-scoped text term (q) - endpoint, URL vocabulary, toolbar pill, hermetic tests

## Context
Job A of the owner's nested-navigation brief (2026-10-12), split by their instruction. The brief wants
the Shop menu's sub-categories to be "filter shortcuts" - "Networking > Routers" showing routing gear
and nothing else - which needs a text term that can be applied WITH a category. Today it cannot:
`/store/catalog` filters on category, brand, unit grade, price band and sort, and has no free-text
term; `/store/search` has the text term but no category. The owner has authorised the backend change
and asked for the gate to prove the scoping.

Two facts that shape it, both verified:

- `products.search_vec` is a real tsvector column with a GIN index (`apps/backend/alembic/versions/0007_search_vectors.py`:
  `products_vec_idx`), and `/store/search` already queries it with a BOUND
  `websearch_to_tsquery('english', :q)` (store_catalog.py:184). `websearch_to_tsquery` is the function
  built for raw user input and never raises on odd syntax, so no `to_tsquery` and no escaping games.
- the catalog statement keeps every optional filter out of the query TEXT: `%CAT%` expands to nothing
  when no filter is set, and a test already pins that the unfiltered statement is byte-for-byte the
  one this endpoint has always run. The new term goes into the same WHERE list for the same reason.

The nested menu itself is Job B; nothing here touches the header or NavDropdown.

## Deliverable
1. `/store/catalog` gains an optional `q` (store_catalog.py):
   - trimmed; empty or whitespace-only is ABSENT, not an empty search (otherwise every unfiltered
     link would carry a predicate);
   - capped in length and refused with 422 over the cap, in the same style as the existing malformed
     filters - `websearch_to_tsquery` will not raise, so the cap is the only bound on the term;
   - the predicate is `p.search_vec @@ websearch_to_tsquery('english', :q)` - a bound parameter, no
     `::TYPE` cast in `text()` (asyncpg's prepared-statement path does not survive those), appended
     to the existing `where` list so that with no `q` the statement is byte-identical to today's;
   - it composes with every other filter, and because category is a predicate in that same WHERE, the
     term is category-scoped BY CONSTRUCTION - `?category=Laptops&q=dock` must return nothing rather
     than the docks;
   - the response envelope's `applied` echoes `q` (it is opt-in, and the envelope is what the UI
     trusts for what is really in force).
2. The URL vocabulary (`catalogFilters.ts` - still the ONE parse/serialize site): `Filters` gains
   `q: string | null`; `parseFilters` reads it (forgivingly, like the rest), `filterQuery` omits it
   when absent, `catalogPath` passes it to the endpoint, and `activeFilters` names it so the empty
   state reads honestly ("No devices match category Accessories, search \"dock\""). No parameter name
   changes and no other vocabulary moves.
3. Toolbar visibility (the rule the last three jobs established: a filter in force is never
   invisible). A `q` in force shows on the catalog toolbar as a removable pill - NOT a dropdown:
   free text has no option list to open. "Clear all" clears it with the rest.
4. Tests (`apps/backend/tests/test_catalog_filters.py`, in that file's own style - hermetic fixtures,
   delta-counted, archived in the `finally`):
   - the term returns only matching rows, and only WITHIN the requested category: a fixture product
     matching the term is created in two categories and the scoped call must return exactly one
     (this is the "only routing gear" requirement, and the reason for the job);
   - it composes with brand / grade / price / sort;
   - an empty or whitespace `q` behaves exactly as no `q` at all;
   - an over-long `q` is refused;
   - the envelope echoes `q`, alongside the existing envelope test;
   - the existing byte-identical unfiltered-statement test still passes UNCHANGED.
   These tests must pass in the gate, and must NOT be added to the deselect list: nothing here may
   depend on the hand-seeded stock that makes `test_search` a deselect (that is what makes it flaky).

## Acceptance
- Scoping proven: `/?category=Accessories&q=dock` returns the docks; `/?category=Laptops&q=dock`
  returns the honest empty state naming both the category and the term.
- `q` composes with the rest, is absent when blank, and the unfiltered statement is unchanged.
- Gate: report the exact count after `docker compose build api` - expect 117 passed plus however many
  tests were added, 3 deselected - and state the number of tests added. The deselect list does not change.
- Storefront `tsc --noEmit && npm run build` green (report the route count), and a live check of the
  pill and the scoped URL through nginx.
- `/store/search` is untouched: same behaviour, and its test stays deselected for the same reason.

## Allowed surfaces
`apps/backend/app/api/v1/store_catalog.py`, `apps/backend/tests/test_catalog_filters.py`,
`apps/storefront/app/components/catalogFilters.ts`, `apps/storefront/app/components/LoadMore.tsx`.
No migration (the column and its index exist), no other endpoint, no header/menu work (that is Job B),
no new dependency, no data change. Anything else = CHANGES.

## Constraints
- Work only on branch factory/<job-id>; LF/no-BOM; gates AFTER `docker compose build api`; never touch
  .env, secrets/, infra/, factory/*.