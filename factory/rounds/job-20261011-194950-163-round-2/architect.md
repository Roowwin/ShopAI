VERDICT: PASS

Job job-20261011-194950-163 round 2, delta `d864dae..6da8461` (6 files). R1 is closed, and closed by more than the
one line that fixed it.

## Propose-only is enforced by three layers - and the "second means" claim is true, proved empirically
(a) explicit: `if body.execute: raise 403 "agent identities are propose-only"`, before the delegation.
(b) delegated role: the new `AGENT_ROLE = "agent"` is passed as `staff["role"]`, and **no** `TOOL_ROLES` tuple admits
it, so `chat()`'s own gate refuses.
(c) innermost: the seven `staff_ops._require_role` in-body guards cover all eight tools.

**Verified by removing (a) at runtime** and calling the handlers directly with role `"agent"`: `chat() refused list
403 your role cannot execute list`, `chat() refused price 403 your role cannot execute price`, then
`staff_ops refused set_status 403 insufficient role`, `set_price 403 insufficient role`. So (b) and (c) each stand
alone. `privileged` reads the delegated role, so the admin/manager `CHAT_DAILY_CAP` exemption no longer applies.

## Live: green, and no remaining write path found
`test_agent_identity.py` **12 passed**; the execute-refusal test asserts 403 **and** zero deltas on a real graded
serial (listed count and `audit_log` publish rows unchanged, asset still `graded`), so "zero deltas" is not vacuous.
Full gate **61 passed / 0 deselected**.

Paths audited and none found: `get_agent` is used by exactly one route, so the mirror is the only door an agent
token opens; the propose path issues reads plus Redis memory writes only - no DB mutation, no `audit()` call; and an
agent cannot **unset** the sponsor's `_FALLBACK_PROPOSAL` flag, because the only `pop` sits inside the execute
branch behind the refusals - its propose can only *set* the flag, which adds a refusal.

## nginx - correct block, correct order, template and conf.d agree
`templates/rfo.conf.template:70` carries the door's exact limits, placed after `^/staff/ai/chat$` and **before** the
generic `^/staff/` block (its position relative to `^/staff/ai/` is irrelevant - the regexes are anchored and
`agents` does not match `ai`). Substituting the six compose variables into the template yields a file
**byte-identical** to the committed `conf.d/rfo.conf` (md5 `140d96bee4e6fa4c574601f3872d8819` both sides, no `${`
left), and `nginx -t` is successful on that render. The main tree is clean and carries no `staff/agents/chat` block
in either file - the misdirected first edit is gone.

## Migration - FK clause verified, widenings untouched
`staff_id BIGINT NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE`; live `pg_constraint` shows
`confdeltype = 'c'`. The three CHECK widenings are unchanged by this delta and still hold live as full supersets
with every original value preserved. The mechanism is sound: `get_agent` requires a live sponsor, so a sponsorless
row can never authenticate and CASCADE is the fail-safe direction.

## Scope
6 files: the migration, `staff_agents.py`, the test file, the page, the two nginx files. No
`staff_ai.py`/`staff_ops.py`/audit call-site/compose change; no grant lookup, no caps/kill-switch code, no
auto-execute branch. The four round-1 boundaries hold.

## Carried (not blockers)
1. **The door deviation must be recorded** - ADR 0007 decision 3 and ADR 0008's "existing chat route" wording.
   **Orchestrator action already taken** (`eb07506`): both were amended to name `POST /staff/agents/chat` and to
   state that an agent must be propose-only until Precondition 2 exists.
2. **Merge note:** `0010_agent_identity.py` was edited *after* it had been applied while keeping the same revision
   string, so alembic will not re-run it. The dev DB was re-applied by hand (verified `confdeltype = 'c'`) and is
   the only environment affected - stated so it is not mistaken for a no-op later.
