# decision job-20261011-194232-1757 round 1

VERDICTS: CHANGES (architect) / CHANGES (security) - performance not run: docs-only, no runtime surface
DECISION: ESCALATE

The design shape survived review, but the document did not survive it intact. Neither reviewer would sign off.

The architect found the duplicate-ADR problem was only half-fixed: the *filename* duplicate was removed but the
kept file's H1 was still identical to ADR 0007's, so the two documents were indistinguishable by title while ADR
0008 keys its whole supersession on "decision 4 of ADR 0006" - a line duplicated verbatim in 0007. It also caught
that ADR 0008 claimed "all of ADR 0007 stands" when 0007's "without exception" clause and decision 4 restate the
very invariant being superseded, and that the supersession read as already in force while 0008 was PROPOSED.

The security review - the most valuable of the program - found the ADR **not implementable as written**: an
agent identity could execute nothing (the role CHECK and every `TOOL_ROLES` tuple exclude `agent`) while the ADR's
own rehearsal bullet required agent auto-execution; the fallback-model guard it cited as preserved is
**process-local state** and silently passes across workers or a restart, so a degraded local model's decision
would execute; "never re-derive at execute time" had no mechanism, because the execute branch re-reads
client-supplied `action`/`args` and re-derives them; and caps were "a cap" with no key, increment point or refund.

## What that meant
As drafted, accepting this ADR would have **authorised autonomy over published listings** (a device made publicly
buyable at a price) while leaning on guards that do not hold. That is the specific failure mode an ADR exists to
prevent, and it is why the round was escalated rather than waved through on a coherent-looking document.

Two things are worth recording about the verdicts themselves:
- The security reviewer read the branch at `47d15a8` and then at `0fe6438`, and reported that the second commit
  closed the one inconsistency it had found by hand. It kept its other findings, which is the right behaviour.
- Both reviewers verified the ADR's claims **against the code** rather than accepting them, which is what turned
  "the fallback guard is preserved" from a plausible sentence into a finding.

## Rework delivered
New "Preconditions to enabling any grant" section (eight items) separating *accepting the design* from *enabling
anything*; decision 7 now requires the deciding model recorded server-side per proposal; decision 8 requires
execution from a persisted, identity-scoped, single-use validated proposal; decision 9 resolves the agent-role
contradiction (an agent is authorised by a grant; a **staff** grant may not widen a role tuple; the guard branch is
conditioned on `identity_type == 'agent'`, with the action set closed to `TOOL_ROLES` keys and grants admin-only);
decision 4 specifies cap semantics including the failure-after-commit and atomicity/floor cases; decision 10
states that revocation gates the future and does not recall the past; decision 5 records that the audit marker
touches every staff handler plus a CHECK widening. Rehearsal gained a cross-worker fallback case and a revocation
case. The ADR now says plainly that several mitigations **do not exist yet**.
