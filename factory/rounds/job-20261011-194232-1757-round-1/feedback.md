# feedback - job-20261011-194232-1757 round 1 -> round 2

Author: this is a docs job and I drafted it rather than delegating, so this file records the review findings
driving the rewrite. Two verdicts, both CHANGES; neither reviewer would sign off.

## From the architect
1. **The duplicate ADR problem was only half-fixed.** Removing the duplicate *filename* left the kept file's H1
   (`# ADR 0006: authorized-agent rail (Hermes-class agents)`) word-for-word identical to ADR 0007's, while ADR
   0008 keys its entire supersession on "decision 4 of ADR 0006" - a line duplicated verbatim as 0007 decision 4.
   A reader could supersede the wrong document. Retitle 0006 to match its filename.
2. **"All of ADR 0007 stands" is false.** 0007's Status asserts 0006 "gates EVERY proposal-to-execute path in this
   rail without exception", and its decision 4 restates the superseded invariant. Scope both the same way 0006's
   are scoped, and annotate 0007 itself.
3. **Tense.** The supersession read as already in force while 0008 is PROPOSED. Read "on acceptance" in 0006 and
   in `docs/state.md`.

## From the security review (four blocking, four missing)
4. **Agent grants were unreachable** - `staff_users.role` admits no `agent` and every `TOOL_ROLES` tuple is a staff
   tuple, so an agent could execute nothing, contradicting the ADR's own rehearsal bullet.
5. **The fallback guard is process-local** (`_FALLBACK_PROPOSAL` dict + process-global `LAST_VIA`) and propose and
   execute are separate HTTP requests, so across workers or a restart it silently passes.
6. **"Never re-derive" had no mechanism** - the execute branch re-reads client `action`/`args` and re-derives them.
7. **Cap semantics unspecified** (key, increment point, refund), and the existing cap's increment-before-check
   defect was not addressed.
8. **Unbounded `action`/`args`** - a prior perf review explicitly asked for this in ADR 0008.
9. **`audit_feed` index abandonment** - deferred to "the job that emits agent rows", which is this ADR.
10. **Revocation is not recall** - must be stated for outward actions.
11. **Future CMS/product writes** are pre-declared `outward` but carry no in-body guard.

## Also required
Grants looked up by the **server-decoded** identity; the honesty section must concede that the kill switches and
the grant UI **do not exist yet**, that `audit()` hardcodes `actor_type="staff"` across all seven staff handlers,
and that "reversibility" restores future behaviour only.

## Delivered
See `decision.md`. The ADR now separates accepting the design from enabling any grant (eight-item Preconditions),
and every one of the eleven items above is either fixed in the text or gated as a precondition.
