# decision job-20261011-194950-163 round 2

VERDICTS: PASS / PASS / PASS
DECISION: APPROVE

The blocking finding is closed, and both reviewers closed it by **trying to break it** rather than re-reading the
fix. The security lens ran every one of the eight actions with `execute:true` plus five shape-games on the `execute`
field, a propose-then-execute sequence, the `_FALLBACK_PROPOSAL` route and the cascade path - all refused with
identical before/after deltas. The architect lens removed the explicit 403 check at runtime and called the chat and
`staff_ops` handlers directly with role `"agent"`: both still refused, so the delegated-role and in-body-guard layers
each stand alone.

Two things make this a genuinely better job than the one I asked for:

1. **`AGENT_ROLE` narrowed the agent's reach beyond the write refusal.** With role `"agent"`, `privileged` is false,
   so agents moved *inside* `CHAT_DAILY_CAP` (round 1 had them cap-exempt via the admin sponsor) and
   `asset_details` no longer discloses `cost_cents`. Agent reach no longer depends on the sponsor at all.
2. **It found the cause of this program's "unreproducible" flake.** A plain FK from `agent_tokens.staff_id` meant one
   leftover agent row turned every suite's `pytest-%` cleanup into an FK failure - 10 failures across five unrelated
   files, which is exactly the shape seen after the ops-views job. Now `ON DELETE CASCADE`, verified live
   (`confdeltype = 'c'`), and the gate is clean at 61 passed.

## Ratified: the `infra/` surface amendment
Both the builder and the perf reviewer flagged that `infra/**` was not on this job's allowed surfaces. That is my
doing, not a silent breach: I explicitly instructed the nginx block, in the **template** rather than `conf.d`,
because this program established that `conf.d` is regenerated from the template at every nginx start. Ratified.

## Orchestrator action already taken
The door deviation is recorded (`eb07506`): ADR 0007 decision 3 carries an "as built" note naming
`POST /staff/agents/chat` and stating that an agent must be propose-only until Precondition 2 exists, and ADR 0008's
"what does not change" and Consequences say the same.

## Merge note to carry
`0010_agent_identity.py` was edited **after** it had been applied while keeping the same revision string, so alembic
will not re-run it. The dev DB was re-applied by hand (verified) and is the only environment affected - recorded so
it is not mistaken for a no-op later.

## Carried to the autonomy job (ADR 0008's preconditions)
- The shared Redis bucket keyed on the **sponsor's** staff id still holds `_FALLBACK_PROPOSAL`, the memory list and
  the daily cap, so an agent reads and writes the human's conversation context (demonstrated: `turns` 4 -> 5 across
  one agent turn). Worst case it flips a guard on the human's Confirm; it cannot produce a write.
- `AGENT_ROLE` is a constant, not a per-identity grant - per-identity grants are decision 9's territory.
- Rotate discards the original `ttl_days` and resets to a fixed 90.
- An agent-driven write would audit as `staff`/sponsor; decision 5's marker stays gated.
- `staff_users.role` admits `'agent'`; nothing creates such a row.
- Hygiene: the tracked `infra/nginx/templates/rfo.conf.template.bak{,2,3}` files pre-date this job and should be
  swept.

Gate: **61 passed**, no concurrent run in flight.
