# decision job-20261011-194232-1757 round 2

VERDICTS: PASS (architect) / PASS (security) - performance not run: docs-only, no runtime surface
DECISION: APPROVE

Both reviewers now pass, and the security reviewer says it explicitly: **safe to ACCEPT as a decision record.**

Every guardrail that does not exist yet is itemised and gated behind "no grant is enabled until all eight
Preconditions are built and the scorecard is archived"; the one genuine internal contradiction (agent
authorisation vs the role allow-list) is **resolved rather than papered over**; and the rehearsal now contains
cases that can actually falsify decisions 7, 9 and 10 (cross-worker fallback, agent turn, revocation).

The architect verified every new claim about current behaviour against the code rather than accepting it, and
confirmed the rewrite introduced no stale claim, wrong decision number or overbroad clause.

## Review coverage - stated explicitly
Both re-checks were run against `9bcd5cf`. Four small edits were then applied **after** those verdicts, all of them
the reviewers' own suggestions and none behavioural: the "no new attack surface" rewording (the security
reviewer's item (i), which it flagged as "the sentence most likely to be quoted later"), the explicit
`identity_type == 'agent'` conditioning plus closed-action-set obligation (its item (ii)), the cap's
failure-after-commit and atomicity/floor cases (its item (iii)), the identity-scoped single-use proposal (its item
(iv)), and the architect's two clarity notes. The record says so rather than implying the verdicts cover text they
did not see.

## What the owner is accepting
**A design, not a running feature.** No grant is enabled until the eight Preconditions exist and a rehearsal
scorecard - including a cross-worker fallback case and a revocation case - is archived. The outward blast radius
(`list` publishes, `price` sets the public price) is stated in the ADR, along with the fact that revocation gates
the future and does not recall the past.

## Carried to J8/J9
- Preconditions 1-8 are the gate on J9 (autonomy). J8 (agent identity) delivers Precondition 3's role-widening and
  the `actor_type='agent'` migration that decision 5 depends on.
- `audit_feed`'s index behaviour under a selective `actor_type` filter is named as Precondition 8 rather than
  deferred again.
