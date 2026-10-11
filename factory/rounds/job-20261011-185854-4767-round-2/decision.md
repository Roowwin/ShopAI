# decision job-20261011-185854-4767 round 2

VERDICTS: CHANGES / PASS / PASS
DECISION: ESCALATE

Round 1's escalation is substantively addressed and independently verified: the perf comments are now TRUE
(re-confirmed by re-running `EXPLAIN (ANALYZE, BUFFERS)` - `by_status` is an Index Only Scan at 0.74 ms,
in-repair-stale an Index Scan at 0.096 ms, and `stock_value` + `by_grade` correctly named as the two full
sequential scans of assets), the zero-fill guarantee now reaches the UI (all four tables route through one
`Breakdown` over payload keys, and no hardcoded enum list survives anywhere in the page or the dashboard
components), the `cancelled` divergence is resolved, `aud` is module-local, and peer headings agree. Performance
and security both PASS; the backend delta is docstring-only (12.0 statements, ~11 ms, no index).

One blocking item remains, and it is a **claim-versus-reality gap** rather than a design problem:

`AuditFeed.tsx` still carries content colours on four `TD` cells (`:31` `text-ink-500`, `:37`
`font-mono text-xs text-ink-600`, `:40` `text-ink-900`, `:43` `colSpan={4} text-ink-500`), despite the report
claiming the colour had been routed through an inner `<span>` so no colour className lands on `TD`. That fix
was applied to the page's new `Breakdown` only. It is the design system's layout-only rule and the same nit
round 1 raised - but the reason it is blocking is that the report asserted something the code does not do.

Required: wrap those four cells' content in an inner `<span>` (or restate the claim as page-only with
AuditFeed exempt). Do NOT add a colour prop to `TD` (primitives are outside this job's surfaces) and do NOT
touch the `audit_feed` plan/index (J8's concern).

## Carried to J8
`audit_feed` uses `audit_at_idx` only because the current filter matches ~100% of rows; a selective
`actor_type` filter makes the planner abandon it for a seq scan + sort. J8 is the job that starts emitting
`actor_type='agent'`.

Gate at this revision: 44 passed; `tsc --noEmit` clean; `next build` green.
