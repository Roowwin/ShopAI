PERFORMANCE: facet scoped to the filters in force - no material query, cache, or client cost; PASS.

- Plan shape is not materially changed. The facet is a 4-way inner-join aggregation
  (store_catalog.py:63-73); the added `JOIN categories c ON c.id = p.category_id` is
  cardinality-preserving because products.category_id is NOT NULL REFERENCES categories(id)
  (migrations/0001_initial.py:89, and categories.name/slug are UNIQUE at :71-72), so it can neither
  drop nor multiply a row, and moving p.status='active' from the join's ON into the WHERE is a no-op
  for an inner join. Cost is at most one PK/unique probe per product (the shop holds ~57). I cannot
  settle the actual plan without EXPLAIN - no DB here - but at this size both the base and the new
  statement run over tens of rows, and every filtered call aggregates a subset of the unfiltered
  call the endpoint already ran.
- Prepared statements: the premise is moot at the app layer. statement_cache_size=0 (app/core/db.py:16-19,
  PgBouncer transaction mode) so asyncpg keeps no statement cache; and the facet's SQL text now varies
  only with the PRESENCE, never the value, of 5 filters (store_catalog.py:106-114) - at most 32
  statements, the same property _catalog_sql already had over 6 filters x 5 sorts. Existing property
  extended, not a new cost class.
- No N+1: _brand_facets is awaited exactly once per envelope request (store_catalog.py:222-223) and
  issues one db.execute (store_catalog.py:131).
- Tests: facet reads per test are 5 (test_catalog_filters.py:386-407), 2 (:426,:429), 10 (:454-484),
  1 (:504) - each read is one HTTP GET = one list query + one facet query, immaterial beside the
  _staged fixture churn. The product path did not change: _catalog_sql (store_catalog.py:151-154)
  builds the identical clause text, in the identical order, from helpers that are verbatim copies of
  the removed code.
- Client/scope: `git diff --stat` = store_catalog.py + the test file only; the `brands` array keeps
  its {slug,name,n} shape (store_catalog.py:132); the storefront still sends its one catalog request
  (app/components/catalogFilters.ts:137 sets with_filters once). No new request, no dependency. Not
  measurable in this environment: EXPLAIN, latency, pytest wall-clock (no docker/DB/npm/pytest) - the
  judgement rests on the SQL and the migration index/FK facts above.

VERDICT: PASS
