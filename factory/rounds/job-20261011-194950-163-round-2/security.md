VERDICT: PASS

Job job-20261011-194950-163 round 2, commit `6da8461`. The blocking finding is closed and I could not break it.
Worktree was clean at this commit, so all live results are from the mounted worktree.

## The exploit is dead - reproduced, zero deltas
Agent token, no prior proposal, `execute:true` for **all eight** actions (`create_lot`, `list`, `price`, `grade`,
`test`, `move`, `scan_in`, `activate_lot`) -> **403 {"detail":"agent identities are propose-only"}** each time.
Delta counters (lots, assets, `status='listed'`, `audit_log` total, `list`/`price` audit rows) are **identical
before and after** all eight attempts.
- Shape games on `execute` all coerced to true and refused: `True`, `1`, `"true"`, `"yes"`, `"on"`, `"1"` -> 403.
  Falsy forms (`False`, `0`, `"false"`, `None`) -> propose 200 / 422, no write.
- Propose-then-execute: the agent proposes, then executes that exact action -> 403. The staff door with the same
  shape still executes (control 200).
- The `_FALLBACK_PROPOSAL` path: the refusal sits **before** the handler, so the flag can never route an agent to
  execute.
- Five back-to-back propose turns moved nothing.
- Cascade path closed: deleting the sponsor cascades the agent row away (0 orphans) and the old token -> 401.

## `AGENT_ROLE` fully closes it; the missing `require_roles` is now correct
The mirror still has no `require_roles` - deliberately, and it matters not at all: `require_roles` wraps `get_staff`
(typ="staff"), so it cannot gate an agent door; the gate is `get_agent` plus the explicit 403. The delegated role is
now the **constant** `"agent"`, verified against the live `TOOL_ROLES` - no tuple admits it. So agent reach no
longer depends on the sponsor at all, and the double barrier is strictly stronger than a role allow-list.
**It also narrowed the agent's read surface**: with role `"agent"`, `privileged` is False, so agents are now inside
`CHAT_DAILY_CAP` (round 1 made them cap-exempt via the admin sponsor) and `asset_details` no longer discloses
`cost_cents`.

## Differential sweep - still exactly one difference
Anonymous vs agent vs customer vs staff over the full openapi route set: the only agent-vs-anonymous difference is
`POST /store/checkout`, where the agent is *stricter* (401 where anonymous gets a 422). All 42 `/staff/*` pairs are
401 to an agent bearer; the mirror is 200 (control); `POST /staff/ai/chat` 401; authenticated `/store/*` 401; a
staff token on the mirror 401.

## `ON DELETE CASCADE` - applied, wall unaffected
Live `agent_tokens_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES staff_users(id) ON DELETE CASCADE`. Verified:
mint an agent, delete its sponsor -> the agent row is gone and the old token 401s. A sponsorless token can never
authenticate independently of the cascade (`get_agent` INNER JOINs `staff_users`, the column is NOT NULL with an
FK). The three CHECK widenings are unchanged - one constraint each, no stale duplicates, full supersets.

## nginx
Committed in **both** the template (source of truth) and the generated `conf.d`; rendering the template with the real
domain/rate values produces a file identical to the committed `conf.d`; `nginx -t` passes.

## Gate
**61 passed / 0 deselected**, clean run with no concurrent pytest in flight.

## Residuals - non-blocking, none is an agent-caused write; all belong to the autonomy job
- **The shared Redis bucket keyed on the sponsor's staff id** is still shared by `_FALLBACK_PROPOSAL`, the memory
  list and the daily cap. The memory half was demonstrated live (the sponsor's `turns` went 4 -> 5 across one agent
  turn), so an agent reads and writes the human's conversation context. `_FALLBACK_PROPOSAL` is the same dict under
  the same key, so an agent's propose writes the flag the human's Confirm reads - code-evident, and the builder
  records it, but the guard could **not** be made to fire in this environment, so it is not claimed as
  demonstrated. Worst case it flips a guard on the *human's* Confirm; it cannot produce a write.
- `AGENT_ROLE` is a constant, not a per-identity grant - every agent has identical (propose-only) reach. Correct
  interim; per-identity grants are ADR 0008 decision 9's territory.
- Rotate still resets to a fixed 90-day TTL, discarding the original `ttl_days`.
- An agent-driven write would still audit as `actor_type='staff'` with the sponsor's id (ADR 0008 decision 5's
  marker is gated and correctly absent).
- `staff_users.role` admits `'agent'` (spec-mandated); nothing creates such a row.
- Hygiene: the tracked `infra/nginx/templates/rfo.conf.template.bak{,2,3}` files pre-date this job.

## Environment note (unchanged)
Two overlapping pytest runs sabotage each other (the `pytest-%` cleanup), so a colliding gate run produces a moving
set of unrelated failures. The clean run above had none in flight.
