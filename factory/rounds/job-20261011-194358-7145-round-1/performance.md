VERDICT: PASS

Job job-20261011-194358-7145 (ops views), commit `1c3e50e`. All measurements live (worktree backend in a one-off api container, real DB via pgbouncer; statements counted with a `before_cursor_execute` listener; plans from `EXPLAIN (ANALYZE, BUFFERS)`).

## Statement counts - claim holds, measured
Warm counts, invariant over 20 calls, no per-row query: the three list routes are **3** statements each (1 `require_roles` lookup + the set-based page query + its own `total` count) - exactly the claimed shape. Detail routes 4-6, all bounded. Caveat worth knowing: each page statement is **O(table), not O(limit)** (`GROUP BY`/`ORDER BY` aggregates every filtered row before `LIMIT`). Irrelevant at current size.

## Latency (median, live: 339 orders / 5 users / 11,360 audit rows / 6,624 assets)
orders 6.45 ms | customers 4.61 | audit 6.23 | orders/{id} 5.13 | customers/{id} 4.96 | assets/{id} 6.08. Totals cross-check exactly against direct `SELECT count(*)` on all three.

## The real scale cliff, named
On `audit` the **`total` count dominates**, not the page (0.85 vs 0.61 ms). It is an Index-Only Scan of the whole table: 10,973 rows in 1.16 ms => ~0.09 us/row => **~90 ms at 1M rows and ~0.9 s at 10M, per page view**. No index makes `count(*)` sublinear; the fix is a keyset cursor plus an approximate or omitted total. (The table grew 10,973 -> 11,360 during this session alone.)

## The selective-filter index abandonment is REAL and this route triggers it
`actor_type='customer'` (0 rows) -> Seq Scan 0.72-0.82 ms; `action='created'` (58) -> Seq Scan 0.97 ms; `action='product_updated'` (8) -> 0.86 ms. Crossover near ~400 estimated rows (`action='status'` at 2,393 and `actor_type='staff'` at 9,339 keep the `at DESC` index walk). `entity` filters are safe - `audit_entity_idx` gives an Index Scan. The unfiltered feed does use `audit_at_idx` and stays O(limit). Deep paging: `OFFSET 100000` costs 2.54 ms vs 0.12 ms at offset 0.

## Bounds - verified against the running API
`limit` capped at 200 and enforced (`0`, `-1`, `201`, `1000000` all -> **422**); `offset` bounded only below, but cost is O(min(offset, n)) so it is not an amplification risk. `q` has no `max_length`.

## Search filters - parameterised, but a scan
Proven at the wire: `q=demo'; DROP TABLE users;--` binds as a parameter with the statement text unchanged. Plans are Seq Scans - the leading `%` defeats btree, and `orders.public_id::text` (uuid) plus `users.email::text` (citext) add casts that would defeat an index on the raw column even for a prefix search. No `gin_trgm_ops` index exists. Acceptable well past this volume; it degrades in the 10^5-10^6 range, and the fix is a GIN trgm index on the **expression**.

## Client cost
Build green (fresh volume), no bundle regression (all six routes 107 kB First Load against 106 kB for the pre-existing pages; shared chunk unchanged, no new dependency). Two non-blocking notes:
- **`/admin/orders` issues a second call to `/staff/overview` purely for `orders.by_state`** - the heaviest read in the app (11 statements including two full 6,624-row `assets` scans), 11.92 ms / 3,877 B versus 6.45 ms for the list itself, so it nearly doubles the page's backend work for one dict. No loop (`deps: [checked, allowed]`). Top recommendation: fold a grouped `by_state` facet into the orders payload.
- **No debounce on the two search inputs**: `q` is in the `load` dependency list, so each keystroke fires a full list request plus its O(table) count, and an early response can land after a later one and render stale rows. The pre-existing assets page has the same shape, so it is a house pattern rather than a regression.

## Recorded
`staff_views.py`'s docstring carries **no index-reality or scale note**, unlike `staff_overview.py`'s - even though it is the module that took on the audit browser and the `actor_type` filter. Worth adding.
