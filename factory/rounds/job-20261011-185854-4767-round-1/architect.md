VERDICT: PASS

Job job-20261011-185854-4767. Commit reviewed: f77e559. Verified live on the current stack: backend suite 44 passed / 0 deselected, `tsc --noEmit` clean, `next build` green (`/admin` statically prerendered), the two new test files 5/5. Every load-bearing builder claim checks out against the schema and live DB.

## Verified correct
1. **Eleven vs nine statements - justified.** The spec's own nine bullets omit `intake_waiting` and `in_repair_stale` while its derivations paragraph demands both, so the spec is internally inconsistent; 11 is the honest minimum. The `count(*) OVER ()` trick is correct (window functions evaluate after HAVING, before LIMIT): live, standalone out-of-stock count = 162 while LIMIT 5 returns 5 rows each carrying the true total.
2. **`total_units = sum(by_status)` equality holds.** `assets.status` is TEXT NOT NULL with a CHECK enum; live `by_status` sums to 6276 = `SELECT count(*) FROM assets`. The zero-filled defaults add nothing.
3. **Components well-factored and using the primitives** (StatRow->Stat; AttentionList->Card/Heading/Badge; AuditFeed->Card/Table family/Badge). No hand-rolled cards; `Card className="p-4"` is the documented caller-owns-padding usage.
4. **`aud()` placement** is the right call given no shared package, `lib/api.ts` outside the allowed surfaces, and hand-mirroring already accepted elsewhere.
5. **The third "Lots by status" card** is not scope creep - a contract field, read-only, derived.
6. **Spec trap respected**: `test_staff_read_walls.py:50` adds `/staff/overview` to `STAFF_READS` only; `READ_WALLS` untouched; the `r.json() != []` line it warns about is `:104`. Diff touches exactly the 8 allowed files. No index added, correctly. `revenue_paid` summing only `status='paid'` matches the spec's own AOV arithmetic (paid revenue / all orders), so cancelled/pending in the denominator is spec intent.

## Findings (non-blocking; escalated to a rework round by the orchestrator)
1. **The zero-fill guarantee does not reach the UI.** `_counts` (`staff_overview.py:49-55`) seeds defaults and lets rows overwrite, so no real state is dropped and no phantom appears - but the page renders its **own hardcoded lists** (`page.tsx:22-25`, iterated `:106/:121/:136`) rather than the payload keys. A future enum value would be emitted by the API and silently dropped from the UI. They already diverge: `page.tsx:25` includes `cancelled` (admitted by `0003_lots.py:13`) while backend `LOT_STATUSES` (`staff_overview.py:45`) omits it. This is the one place the stated guarantee is narrower than the comment implies.
2. **`orders.by_state` is fetched but never rendered** (`page.tsx:33`; StatRow's orders prop omits it) and `generated_at` is unused - yet the same "fetched-but-unused" reasoning *was* applied to `lots.by_status` (which got a card). Inconsistent treatment; both are contract keys, not removable, but the difference should be stated.
3. **Dead export**: `StatRow.tsx:11` exports `aud()` but StatRow is the only consumer - make it module-local.
4. **Duplicated token pairs** against the design system's no-duplicate rule: `bg-accent-100 text-accent-700` (`page.tsx:80`, `AttentionList.tsx:16`) and `bg-surface-sunken text-ink-600` (`AuditFeed.tsx:32`, `AttentionList.tsx:17`, = lib/ui's private NEUTRAL).
5. **Heading-size inconsistency among peer sections**: Inventory h2 18px (`page.tsx:99`) vs Needs attention / Recent activity h3-as-h2 14px (`AttentionList.tsx:24`, `AuditFeed.tsx:25`).
6. Content-colour `className` overrides on `TD` sit outside "layout only", but `TD` exposes no colour prop - a primitive gap, not builder error.
