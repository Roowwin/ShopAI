VERDICT: CHANGES

Job job-20261011-185854-4767 round 2. Delta reviewed: `f77e559..8779eaa`.

Five of the six re-checked items verify clean; item 5's claim is demonstrably false in one file.

## Verified TRUE
1. **Perf comments** - re-ran `EXPLAIN (ANALYZE, BUFFERS)` live: `by_status` -> Index Only Scan using `assets_status_idx` (Heap Fetches 684, 0.74 ms); in-repair-stale -> Index Scan using `assets_status_idx` with `Index Cond (status='in_repair')` + `Filter updated_at < ...`, 0.096 ms (docstring 0.07 ms, within noise); `stock_value` -> Seq Scan 1.10 ms and `by_grade` -> Seq Scan 1.26 ms, i.e. "two full sequential scans of assets" is right; orders revenue -> Seq Scan on orders 0.19 ms; audit feed -> Index Scan using `audit_at_idx` + Filter 0.045 ms and the "selective actor_type is J8's concern" hedge is correct. `staff_overview.py` diff is docstring-only.
2. **Zero-fill reaches the UI.** `page.tsx` routes all four tables through one local `Breakdown` via `Object.entries`: `inventory.by_status`, `inventory.by_grade`, `lots.by_status`, `orders.by_state` (newly added Orders section). `git grep` for `ASSET_STATUSES`/`GRADES`/`LOT_STATUSES`/`ORDER_STATES` in `page.tsx` + `components/dashboard/` returns nothing - no hardcoded list survives. Unexpected keys are appended in insertion order, not dropped. This also closes round 1's fetched-but-unused `orders.by_state`.
3. **`cancelled` divergence resolved and benign** - no list in the page; the backend's `LOT_STATUSES` still omits `cancelled`, now harmless since a cancelled lot arrives via the grouped rows (rows-win) and `Object.entries` renders it.
4. **Smaller items TRUE** - `aud` is `function aud`, non-exported; peer headings all `level="h2"` (Inventory/Orders in `page.tsx`, Needs attention, Recent activity) with `Breakdown` titles at h3 under them; `tokens.ts` exports `NOTICE_TONE`/`MUTED_TONE`, imported by page/AttentionList/AuditFeed. Dashboard-local is the right call: `lib/ui.ts`'s `NEUTRAL` is private and `lib/` was outside the surfaces.

## BLOCKING - item 5's claim is false in `AuditFeed.tsx`
The builder reported routing value-cell colours through an inner `<span>` "so no colour className lands on `TD`". That holds for the page's `Breakdown` but **not** for `AuditFeed.tsx`, where four value cells still carry content colours on the cell itself: `:31` `text-ink-500 whitespace-nowrap`, `:37` `font-mono text-xs text-ink-600`, `:40` `text-ink-900`, `:43` `colSpan={4} text-ink-500`.
That is the design-system "className overrides are for layout only" rule - the same nit round 1 raised, which this round was meant to close. `ui/Table.tsx` is not in the diff, so the primitive is untouched.
Required: wrap each of those four cells' content in an inner `<span>` carrying the colour (as `Breakdown` does), or restate the claim as page-only with AuditFeed exempt - but not leave the report asserting something the code does not do. Do NOT add a colour prop to `TD`, and do NOT touch the `audit_feed` plan/index.

Regression status: full backend suite 44 passed, `tsc --noEmit` clean.
