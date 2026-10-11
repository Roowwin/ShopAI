VERDICT: PASS

Job job-20261011-194950-163 round 2, delta `d864dae..6da8461`. Perf only.

## Migration CASCADE change - no cost or locking change
The `ON DELETE CASCADE` edit is inside the `CREATE_AGENT_TOKENS` string, i.e. the FK of a brand-new table created
from empty, so table creation stays instant. The three CHECK widenings are **byte-for-byte unchanged** (the delta
touches only that one string - no `WIDEN`/`NARROW`/`DROP`/`ADD CONSTRAINT` lines appear). Round-1 measurements stand:
the whole trio commits in ~5 ms (`audit_log` 11.6k rows: 1.3 ms) under a short ACCESS EXCLUSIVE lock. CASCADE only
affects `DELETE` on `staff_users` (14 rows, rare), cascading into the tiny `agent_tokens` table - no per-request
cost. (Deployment note: the DB is already at `0010`, so this edit only takes effect on a downgrade/re-apply.)

## Propose-only door - strictly cheaper, not more expensive
`if body.execute: raise 403` runs **before** the chat handler is called, so an execute turn now costs only the
`get_agent` PK lookup plus a branch - no Redis increment, no AI call, no handler work. A propose turn is unchanged
(1 `get_agent` + the same chat call); delegating `AGENT_ROLE="agent"` merely yields an empty `can_do` list, adding
no work.

## Nothing else adds a query, per-request cost or material bundle change
- `page.tsx`'s Expires rework is JSX only: fetch count unchanged (2 on mount, 1 refetch per create/rotate/revoke).
  Rebuilt worktree: `/admin/agents` = **2.25 kB / 107 kB First Load** (was 2.23 kB, +0.02 kB), shared chunk 103 kB
  unchanged, build and type-check green.
- nginx: one new anchored regex ordered before `^/staff/` - a single extra pattern match, nanosecond-scale,
  perf-neutral. (For the record `infra/` is outside the job's original allowed surfaces - a scope item, not a perf
  finding, and ratified by the orchestrator since the change was explicitly instructed.)
- Routes unchanged otherwise: 1-2 single-row statements each, no N+1, hash computed in-process.

## Gate
**61 passed (49 baseline) = +12 tests, no measurable runtime addition.** The heaviest new test issues ~5 small
SELECTs (two `count(*)` aggregates plus a status lookup); the propose test issues 1. All indexed over small tables,
no loops or large fixtures.

No measurable performance regression anywhere in the delta.
