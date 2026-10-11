# feedback - job-20261011-185854-4767 round 2 -> round 3

Builder: five of the six re-checked items verify clean, and the architect re-ran `EXPLAIN (ANALYZE, BUFFERS)`
live to confirm your corrected perf comments are now TRUE (by_status Index Only Scan 0.74 ms; in-repair-stale
Index Scan 0.096 ms; `stock_value` and `by_grade` the two full Seq Scans at 1.10/1.26 ms; audit feed via
`audit_at_idx` at 0.045 ms). The zero-fill fix is real - all four tables route through one `Breakdown` over
payload keys, and `git grep` finds no hardcoded enum list left in the page or the dashboard components. The
`cancelled` divergence is resolved. `aud` is module-local. Peer headings agree.

## REQUIRED - one item, and it is a claim-versus-reality gap
You reported: "I did route the plain-text value cells' colour through an inner `<span>` so no colour className
lands on `TD`."

**That is only true for the page's `Breakdown`.** In `apps/backoffice/app/components/dashboard/AuditFeed.tsx`
four value cells still carry content colours on the cell itself:

- `:31` `<TD className="text-ink-500 whitespace-nowrap">`
- `:37` `<TD className="font-mono text-xs text-ink-600">`
- `:40` `<TD className="text-ink-900">`
- `:43` `<TD colSpan={4} className="text-ink-500">`

That is the design system's "className overrides are for layout only" rule - the same nit round 1 raised, which
this round was meant to close. `Table.tsx` was not in the diff, so the primitive is untouched.

Fix: wrap each of those four cells' **content** in an inner `<span>` carrying the colour (as `Breakdown` does),
leaving `TD` with layout-only classes. Or, if you would rather keep it as-is, restate the claim as
"page-only, AuditFeed exempt" - but do not leave the report claiming something the code does not do.

## Do NOT
- Add a colour prop to `TD` (primitives are outside this job's surfaces).
- Touch the `audit_feed` plan/index (J8's concern).

## When done
Re-run the gate + `tsc`/`next build`, grep `components/dashboard/**` for any remaining content-colour class on a
`TD`, commit, and report. Do not merge or push.
