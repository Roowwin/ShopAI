# ADR 0006: authorized-agent rail (Hermes-class agents)

## Context
The staff AI co-pilot performs inventory ops behind a human Confirm (proposal -> TOOL_ROLES check -> audited). The two-zone model is proven live: staff tokens are refused on store endpoints, customer tokens on staff write doors (7/7, job-8 walls). AI-engine isolation (ai.* views, shell-triple privilege wall) bounds the assistant's DB reach. External agent harnesses exist and can be launched (ollama launch hermes). Unauthenticated reuse of staff credentials for agents would be a backdoor (standing rule), and append-only audit/ledgers make every action permanent.

## Decision
1. Agent = first-class identity class: role "agent" (service principal), named per instance (e.g. hermes-ops-1), created/rotated/revoked only by an admin in the backoffice. No self-service.
2. Credentials: rotatable, revocable, expiring scoped token (distinct from staff password+TOTP; autonomous use makes TOTP impractical). Stored like staff secrets; rotation prints-once.
3. Same door, zero new attack surface: agents speak the EXISTING /staff/ai/chat protocol under the agent identity. No new endpoints for agent actions.
4. INVARIANT UNCHANGED: no write executes without a human Confirm. Read-only ops may run without confirm within caps.
5. Caps: per-identity AGENT_DAILY_CAP env (compose passthrough, analog of CHAT_DAILY_CAP) + rate limits on the chat route for agent identities.
6. Audit: every agent call marked actor type=agent with the identity name; rehearsal scorecards run against the agent identity BEFORE production use (extend scripts/rehearse_day.py: same invariants, report-only content).
7. Walls unchanged: agent tokens are a third class valid ONLY on the assistant/chat surface. Never store endpoints. Never raw SQL beyond ai.* views.
8. Out of scope (future ADRs): unattended multi-step execution chains; agent actions in the store (customer) zone.

## Consequences
+ Agents become auditable operators without credential sharing or new surfaces.
+ The Confirm line stays human - automation proposes, people dispose.
- Identity machinery + caps to build (follow-up factory jobs: identity+wall changes, caps/audit marker, backoffice rotation UI, rehearsal extension).
- Heavy agent days may throttle against caps (by design; raise deliberately).

## Status
ACCEPTED (owner-authored; recorded as binding in `docs/state.md`).

**Decision 4 is superseded for granted (identity, action) pairs by ADR 0008 (scoped autonomous execution).**
Every other decision here stands, and the human Confirm remains the default and the fallback for anything not
granted - an ungranted rail behaves exactly as this ADR describes.

## Open question for the owner
Confirm the invariant as stated: an agent may PROPOSE anything its role allows, but no WRITE executes without a human Confirm - including after weeks of observed good behavior. (The alternative - scoped auto-execute allowlists for low-risk ops - would require its own ADR with its own rehearsal evidence.)

**Answered.** The owner chose the alternative. ADR 0008 is that ADR: it scopes the supersession to explicitly
granted pairs, keeps the Confirm line for everything else, and carries the rehearsal gate this question required.