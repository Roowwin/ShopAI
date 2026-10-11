# autonomy: persisted proposals + grant-gated agent execute (ADR 0008 preconditions 1+2+9; inert without enabled grants)

## Context
ADR 0008 adopted (docs/adr/0008*). Job 12 shipped autonomy_grants (0011, inert) + bounds. The agent door stays propose-only; in PRODUCTION nothing changes because no grant can be enabled (no UI until job 14, no seeded grants) - tests exercise the machinery via fixture grants only.

## Deliverable
1. Server-side proposal record (Preconditions 1+2): each assistant PROPOSAL stores in Redis (TTL ~24h): autonomy:proposal:<id> holding {identity_type, identity_id, action (a TOOL_ROLES key), args VALIDATED the same way the execute handlers validate, decided_by (the deciding model id), created_at, consumed=false}; the proposal response gains an additive proposal_id field (clients unaffected).
2. The agent door execute path reshaped: execute turns REQUIRE body.proposal_id; client-supplied action/args in an execute turn = 422 (substitution closed). Gate chain per execution: valid agent auth -> proposal exists + not consumed + identity-scoped (its identity_id = this agent) + enabled grant exists for (agent, this agent, action) + cap check (autonomy cap key INCR on execution, floor-bounded refund when the handler provably wrote nothing, over-cap = the turn returns as a PROPOSAL not a refusal and writes nothing) + the proposal's decided_by is NOT the fallback model (refused - read server-side, cross-worker safe). On success: proposal consumed (single-use), audit row carries actor_type=agent with meta.autonomy = {grant_id, identity name}. Staff-role human-confirm execution is UNTOUCHED (staff grants are not creatable here; the model admits the type only).
3. In-body _require_role guards extended per decision 9 (role OR - only for identity_type=agent - a valid enabled grant), so plain-function dispatch cannot bypass; CMS/product handlers stay untouched (their promotion obligation is a later job - they are not dispatchable today).
4. The REFUND boundary: pinned in a test or proven unreachable with the reason recorded in code (handlers that commit internally - the ADRs accepted floor-bounded overshoot with the note).

## Acceptance
- New tests: identity-mismatch refused; replay (consumed) refused; no-grant -> propose-path (never silent); over-cap -> proposal + zero writes; fallback-model proposal -> execute refused cross-process (delete the Redis record simulating a worker change and prove the refusal); args-substitution -> 422; a granted execution writes exactly one asset change + one audit row with actor_type=agent + meta.autonomy; all 78 existing tests stay green.
- Gate: report the exact new count; 3 deselects unchanged. NO backoffice UI, NO storefront.

## Allowed surfaces
app/api/v1/staff_agents.py, app/api/v1/staff_ai.py, app/api/v1/staff_ops.py (audit-meta param + _require_role extension only), alembic NONE (no migration), tests. Anything else = CHANGES. ADR 0008 decisions 4/7/8/9 are the binding text - read them first.

## Constraints
- Work only on branch factory/<job-id>; LF/no-BOM; gates AFTER docker compose build api; do not touch .env, secrets/, infra/nginx/certs/, factory/*.