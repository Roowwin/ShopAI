# decision job-20261011-181836-7704 round 2

VERDICTS: PASS / PASS / PASS
DECISION: APPROVE

Round-1's single blocking item is genuinely fixed and independently verified: the execute leg now
asserts exactly 403 (mutation-proven - widening TOOL_ROLES makes it fail), and the side-effect
assertion counts `(lots, assets, audit_log)`, which `create_lot` provably moves where the old
`status='listed'` count could not.

Recorded with approval, NOT glossed:
- The propose-path leg is a **structural canary, not restored coverage** - both its assertions are
  unfalsifiable on a non-execute path. The docstring overstates it ("both are load-bearing") and is
  to be corrected on the next touch of that file.
- **No test pins the action-scoped contract** (the 422 for `execute:true` with an absent/unknown
  action) - the motivating property of this job. Queued.
- A leftover dev-DB row `LOT-2026-00700` (id 728, empty intake lot) from the mutation run. Recorded
  as a deliberate deviation, left in place deliberately (append-only audit), handed to a data-hygiene
  job. The builder's justification for its invisibility was partly wrong - `ai_snapshot` does NOT
  filter `units > 0`, so it appears in the model's recent-lots context. No authz or exposure impact.

Carried to the program (own jobs, all confirmed present and deliberately untouched here):
- `TOOL_ROLES` vs the `staff_ops` gate divergence for `test`/`list` (chat more permissive; direct
  dispatch bypasses the door's `Depends`) - a live privilege-escalation path.
- nginx rate-zone loss: the chat door moved off `limit_req zone=staff` onto an unrated `/staff/ai/`.
- Missing leading `db.commit()` before the long model call can pin a pgbouncer transaction past
  `idle_in_transaction_session_timeout`.

Gate at this revision: **42 passed**, 0 deselected.
