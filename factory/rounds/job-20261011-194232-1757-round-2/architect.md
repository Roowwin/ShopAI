VERDICT: PASS

Job job-20261011-194232-1757. Re-checked at `9bcd5cf`.

All three round-1 findings are closed, and the larger rewrite is architecturally coherent. No new stale claim,
wrong decision number or overbroad clause found.

## F1 (duplicate H1) - fixed
`docs/adr/0006-confirm-stays-human-only.md:1` now reads "Confirm stays human-only (no write without a human
Confirm)" - distinct from ADR 0007's H1, and matching both its filename and `docs/state.md`'s name. The three ADR
titles are now mutually distinguishable, and ADR 0008's "decision 4 of ADR 0006" can no longer be misapplied
because 0006 is uniquely titled and 0007's decision 4 carries its own pointer.

## F2 ("all of ADR 0007 stands") - fixed
ADR 0008 now says ADR 0007 "is untouched except where it restates this invariant", names the Status clause and
decision 4, confines the narrowing to granted pairs, keeps the rest explicit, and notes decision 5 depends on the
`actor_type='agent'` migration. ADR 0007 carries the reciprocal Status pointer and annotates decision 4.

## F3 (present-tense supersession) - fixed
ADR 0006 and `docs/state.md` both read "on acceptance", consistent with ADR 0008 being PROPOSED.

## New-claims audit against code - all TRUE
`_FALLBACK_PROPOSAL` is a module dict and `LAST_VIA` a module global (the cross-worker gap is real); the execute
branch re-reads `body.action`/`body.args` and re-derives; **no** `AI_AUTONOMY` or grant table exists anywhere in
`apps/` or `infra/`; all staff `audit()` call sites hardcode `"staff"`; the four CMS/product handlers carry only a
route `Depends` and none is in `TOOL_ROLES`, so "no current hole" is correct; `ChatIn.action`/`args` carry no
length constraint; the `staff_users.role` CHECK admits no `agent`; the `audit_log` CHECK admits only
staff/system/customer. Every to-build item is marked as such.

## Coherence of the rewrite
Preconditions do not conflict with the Decision list - each restates or extends a decision (1->7, 2->8, 3->9,
6->6, 7->4) and 4, 5, 8 are additive obligations. Decision 11 and the Preconditions are two gates that must both
hold, stated jointly in open question 3. Decision 9 is consistent with decisions 4 and 6 and with ADR 0006's
untouched decisions: the agent still holds an identity/role for the walls and the audit marker, while *execution*
is authorised by a grant; the staff-side rule keeps `TOOL_ROLES` authoritative, so a grant never widens a role.

## Noted, non-blocking
Open question 1 was phrased as decided yet listed as open (now reworded to "Confirm..."); and decision 4's
per-(identity, action) caps sit alongside ADR 0006 decision 5's untouched per-identity `AGENT_DAILY_CAP` - they
coexist, and a one-line note that they are **cumulative rather than alternatives** removes a future stumble (added).
