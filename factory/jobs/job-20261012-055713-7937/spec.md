# rehearsal extension: ADR 0008 scorecard + AGENT_DAILY_CAP (ADR 0007 decision 5 closes here)

## Context
ADR 0008 adopted; preconditions 1-8 built (jobs 12-14); the rail is complete and inert. ADR 0008 decision 11: rehearsal evidence REQUIRED before the first grant is enabled - the scorecard must be run by the owner, pasted and archived. AGENT_DAILY_CAP (ADR 0007 d5) has no code counterpart yet; decision 4 says the per-action and per-identity caps are cumulative.

## Deliverable
1. AGENT_DAILY_CAP env (default absent = no identity cap; compose passthrough; .env.example) enforced cumulatively with the per-action caps: one INCR per agent EXECUTION against the identity's day-key, same floor-bounded semantics; over-cap -> degrade to proposal like the per-action cap.
2. scripts/rehearse_day.py extension: the ADR-0008 scorecard list, deterministic (armed fixtures; the model out of the loop): autonomy env off -> deltas zero; an armed inventory grant -> exactly one asset write + one audit row with actor_type=agent + meta.autonomy; per-action cap=1 -> second turn = proposal + the refund boundary held; inventory-only grant -> price/list refused + storefront unchanged; switch off -> proposal, zero deltas; the cross-worker fallback refusal (the Redis proposal record deleted between propose and execute); agent turn -> actor_type=agent with identity name; grant disabled -> next execute refused, prior state unchanged; identity cap exhausted -> proposal. Scorecard rows split check()/note() exactly as the existing runner does.
3. NOT run by the builder. The owner runs it post-approve and the pasted scorecard gets ARCHIVED as a round artifact (factory/rounds/...) - the ADR-0008 decision-11 gate.

## Acceptance
- Gate: report exact count; 3 deselects unchanged. Deterministic only - no LLM in the loop.
- Allowed surfaces: scripts/rehearse_day.py, app/api/v1/staff_ai.py (identity cap), tests, .env.example, docker-compose.yml (one passthrough line). Anything else = CHANGES.

## Constraints
- Work only on branch factory/<job-id>; LF/no-BOM; gates AFTER docker compose build api; do not touch .env, secrets/, infra/nginx/certs/, factory/*.