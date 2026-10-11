# feedback - job-20261011-185854-4767 round 1 -> round 2

Builder: all three reviewers PASS this job on its merits - the door is correctly gated (403 with an empty body
for warehouse/sales/technician, verified against the role enum), the payload is explicitly PII-free, the page
fails closed over the server wall, the endpoint is GET-only, and your live cross-check matched
(`total_units` 6259 == `SELECT count(*) FROM assets` 6259). Performance is good: median 11.8 ms, 11 statements
+ 1 auth lookup, **zero N+1**, one dashboard fetch.

This round is **my** escalation, not the reviewers' - I am spending it because two items are false statements in
shipped source rather than polish, and because you have the context now that a later job would have to rebuild.

## REQUIRED 1 - the docstring's scan claim is factually wrong (and it was my spec's error)
`staff_overview.py:18-19` says three aggregates are sequential scans including the in-repair-stale count. That is
**false for that one**: the measured plan is

    Index Scan using assets_status_idx (Index Cond: status='in_repair')  +  Filter on updated_at   0.44 ms

There is no index on `assets.updated_at`, but the status index carries the predicate. Your spec asserted this as
"verified" after a design-phase review and I passed it through uncorrected - so this is my error, propagated into
your comment. Fix the comment to say what is actually true.

Also **unmentioned**: `stock_value` is a **second full scan of assets** (aggregate over all rows, no WHERE) at
**1.03 ms** - the same O(assets) cost as `by_grade`, which IS the dominant statement. Call it out.

State the measured scale while you are there: the two full-assets scans run at ~0.17 us/row, so ~100 ms combined
at **~300k assets (~50x current)**; the orders scan only matters at ~1M orders. Current volume is comfortably
sub-budget (~12 ms).

## REQUIRED 2 - the zero-fill guarantee does not reach the UI
`_counts` seeds defaults from the DB CHECK enums and lets grouped rows overwrite, so the API is sound. But the
page renders its **own hardcoded lists** (`page.tsx:22-25`, iterated at `:106/:121/:136`) instead of the payload
keys - so a future enum value would be emitted by the API and silently dropped from the UI table. They **already
diverge**: `page.tsx:25` lists `cancelled` for lots, while backend `LOT_STATUSES` (`staff_overview.py:45`) omits
it, so that row renders from a key the API never seeds.

Fix one way or the other: drive the tables off the payload keys (preferred - it makes the guarantee real), or
reconcile the two lists so they cannot diverge, and say which you did. Either way the `cancelled` mismatch must
be resolved.

## REQUIRED 3 - the smaller items
- `StatRow.tsx:11` **exports** `aud()` but StatRow is its only consumer - make it module-local.
- `orders.by_state` is fetched but never rendered (`page.tsx:33`; StatRow's orders prop omits it), yet you added
  a "Lots by status" card for exactly that fetched-but-unused reason. Inconsistent. Render it, or state why not.
- **Peer-section heading sizes mismatch**: Inventory h2 is 18px (`page.tsx:99`) while Needs attention and Recent
  activity use h3-as-h2 at 14px (`AttentionList.tsx:24`, `AuditFeed.tsx:25`). Make the peer sections agree.
- Two duplicated token pairs against the design system's no-duplicate rule:
  `bg-accent-100 text-accent-700` (`page.tsx:80`, `AttentionList.tsx:16`) and
  `bg-surface-sunken text-ink-600` (`AuditFeed.tsx:32`, `AttentionList.tsx:17`, the same pair as `lib/ui.ts`'s
  private NEUTRAL). Centralise them or document why they stay.

## NOT yours
- `TD` exposes no colour prop (so your content-colour className overrides on `TD` sit outside "layout only") -
  that is a primitive gap, and primitives are outside this job's surfaces. Recorded.
- `audit_feed` uses `audit_at_idx` only because the current filter matches ~100% of rows; with a selective
  filter the planner abandons it for a seq scan + sort (proved with `actor_type='agent'`). That is a J8 concern,
  since J8 is what starts emitting `actor_type='agent'`. Do not touch it here.

## When done
Re-run the gate with the worktree-mount recipe and the backoffice `tsc`+`next build`, re-do the live cross-check
if your response shape changes at all, commit, and report. Do not merge or push.
