# decision job-20261011-185854-4767 round 1

VERDICTS: PASS / PASS / PASS
DECISION: ESCALATE

All three reviewers pass the job on its merits: the door is correctly gated (403 with an empty body for
warehouse/sales/technician, verified against the role enum), the payload is **explicitly PII-free** (aggregate
counts and aggregate money only; `audit_feed` excludes the `before`/`after`/`meta` JSONB columns and filters out
the `customer` actor type; no join to customers anywhere), the page fails closed over the server wall, the
endpoint is GET-only, the live cross-check matched (`total_units` 6259 == `SELECT count(*) FROM assets` 6259),
and performance is good (median 11.8 ms, 11 statements + 1 auth lookup, zero N+1).

**Decision escalated by the orchestrator on its own judgement, not the reviewers'.** One round, because two of
the items are *false statements in shipped source* rather than polish:

1. **A factual error in the code docstring, caused by my spec.** `staff_overview.py:18-19` claims
   `in_repair_stale` is a sequential scan. It is not - the plan is an `Index Scan using assets_status_idx` with
   an `updated_at` filter. My spec asserted this as "verified" after a design-phase review, and it was wrong for
   this predicate. `stock_value` (a second full assets scan, 1.03 ms) is also uncalled for. A misleading
   performance comment is exactly the failure my own notes warn about, so it gets fixed rather than filed.
2. **The zero-fill guarantee does not reach the UI.** The endpoint seeds grouped counts from the DB CHECK enums,
   but the page renders its **own hardcoded lists** (`page.tsx:22-25`) instead of the payload keys, so a future
   enum value would be emitted by the API and silently dropped by the UI. They already diverge: the frontend
   lists `cancelled` for lots while the backend's `LOT_STATUSES` omits it, so that row renders from a key the
   API never seeds.
3. Smaller but real: a dead `aud` export; `orders.by_state` fetched-but-unused while `lots.by_status` got a card
   for exactly that reason (inconsistent treatment); and peer dashboard sections with mismatched heading sizes.

Cheaper now than later: the builder has full context, and the same understanding would have to be rebuilt by
whoever next touches this surface.

## Carried to J8 (the agent-identity job)
`audit_feed` uses `audit_at_idx` only because the current filter matches ~100% of rows. With a **selective**
filter the planner abandons the index for a seq scan + sort (proved with `actor_type='agent'`, 0.70 ms). J8 is
the job that starts emitting `actor_type='agent'`, so the index/plan should be revisited there.

## Ratified deviation ledger (program)
- J3: `client_max_body_size` 2k -> 16k on the chat route (spec number wrong).
- J5: `aud()` placed in `dashboard/StatRow.tsx` because the backoffice's `lib/api.ts` exports none and was
  outside the allowed surfaces (spec assumed a helper that does not exist). Correct call given no shared package.

Gate at this revision: 44 passed / 0 deselected (branch), 42 -> 44. Baseline 42.
