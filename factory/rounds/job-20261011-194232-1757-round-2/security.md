VERDICT: PASS

Job job-20261011-194232-1757. Re-checked at `9bcd5cf` (read in full, plus the 0006/0007/state deltas). Surface
unchanged and clean: 5 files, all `docs/`.

**Safe to ACCEPT as a decision record.** Each of the eight findings, judged on whether it is genuinely closed
rather than restated:

1. **Agent-role contradiction - genuinely resolved.** Decision 9 stops asserting the role tuple is the sole
   authority for agents: an agent is authorised by a valid enabled grant, staff grants stay bounded by the role
   tuple, and the old overclaim ("a grant can never be more permissive than the door") is deleted while "what does
   not change" now reads "a **staff** grant cannot widen them" - accurate.
2. **Fallback guard - closed.** Decision 7 names the exact defect, the store (Redis) and the requirement that the
   execute path read the decision from there, and calls it a precondition; the new cross-worker rehearsal case
   makes it falsifiable.
3. **Never re-derive - closed.** Decision 8 requires execution from the server-persisted validated proposal and
   says plainly it is new machinery, not a constraint on existing behaviour.
4. **Cap semantics - materially closed**: key, day scope, increment on execution only, refund on failure,
   over-cap degrades to propose, and an explicit "does NOT copy `CHAT_DAILY_CAP`".
5. **Unbounded `action`/`args`** - addressed as Precondition 5 with the prior review's exact quote.
6. **`audit_feed` index** - Precondition 8 names the filter, the measured seq-scan-plus-sort and the severity, and
   declines to defer again. The right level for an ADR.
7. **Revocation-not-recall - closed properly** (decision 10 + a rehearsal case + an acceptance question). Better
   than what was asked for.
8. **In-body guard obligation** - Precondition 4 names the four handlers, confirms no current hole, and requires
   the guard before promoting any into `outward`.

**Honesty - substantially improved**: Context concedes the guards "are, in several places, not yet what they
appear to be", Preconditions is declared "part of the decision, not advice", and a Consequences bullet says the ADR
"authorises a design, not a running feature".

## Residuals folded in (non-blocking, at acceptance/implementation)
(i) the "without a new attack surface" claim was overstated - decision 9 introduces a new **authorisation path**
(the grant-scoped branch) on the same door; reworded; (ii) the agent-grant branch is now explicitly conditioned on
`identity_type == 'agent'`, with the action set closed to `TOOL_ROLES` keys and grants admin-only; (iii) the cap's
failure-after-commit case (the handlers commit inside themselves, so a refund must be tied to "provably wrote
nothing", not a non-2xx) and the reserve/refund atomicity/floor case are now stated; (iv) the persisted validated
proposal is now stated to be identity-scoped and single-use. None of these made accepting the design unsafe, but
each removes a way the document could be misread later.
