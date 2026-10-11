# ADR 0007: authorized-agent rail (Hermes-class agents)

## Status
PROPOSED - builds on ADR 0006 (human-only Confirm): ADR 0006 gates EVERY proposal-to-execute path in this rail without exception.

**Scoped by ADR 0008 (scoped autonomous execution, PROPOSED).** For explicitly granted (identity, action) pairs,
"without exception" is narrowed in exactly the same way as ADR 0006 decision 4 - an **ungranted** rail is still
fully gated by the human Confirm. Decision 4 below is read subject to that scoping. Everything else here stands.

## Decision
1. Agent = first-class identity class: role "agent" (service principal), named per instance (e.g. hermes-ops-1), created/rotated/revoked by an admin in the backoffice only.
2. Credentials: rotatable, revocable, expiring scoped token - distinct from staff password+TOTP (autonomous use makes TOTP impractical). Stored like staff secrets; rotation prints once.
3. Same door, zero new attack surface: agents speak the EXISTING /staff/ai/chat protocol under the agent identity. No new endpoints.
4. INVARIANT (ADR 0006, binding): no write executes without a human Confirm. Read-only ops may run without confirm within caps. *(Superseded for explicitly granted pairs on acceptance of ADR 0008 - see Status.)*
5. Caps: per-identity AGENT_DAILY_CAP (compose passthrough; CHAT_DAILY_CAP analog) + agent-specific rate limits on the chat route.
6. Audit: every agent call marked actor type=agent with the identity name; scripts/rehearse_day.py extends to run agent-identity turns (same invariants; content report-only) BEFORE production use.
7. Walls unchanged: agent tokens = a third class valid ONLY on the assistant/chat surface. Never store endpoints. Never raw SQL beyond ai.* views.

## Consequences
+ Auditable machine operators without credential sharing or new surfaces.
+ Confirm line stays human - automation proposes, people dispose.
- Identity machinery + caps to build (factory jobs: identity+wall changes -> caps/audit marker -> backoffice rotation UI -> rehearsal extension).
- Heavy agent days throttle against caps (by design).

## Follow-up jobs (in order, each with the rehearsal gate)
1. Agent identity class + wall changes (+ tests)
2. AGENT_DAILY_CAP + actor_type=agent audit marker
3. Backoffice token rotation UI (print-once)
4. rehears_day.py agent-identity extension
5. Live Hermes walkthrough under its own identity - scorecard pasted and archived

## Sign-off (design)
Owner: ACCEPTED 2026-10-11 with ADR 0006 as binding precondition. Implementation sequenced per follow-up jobs.