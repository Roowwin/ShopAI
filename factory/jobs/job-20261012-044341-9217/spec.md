# autonomy groundwork: grants model + chat bounds (ADR 0008 preconditions 3+5; inert by default)

## Context
ADR 0008 ADOPTED-AS-DESIGN (docs/adr/0008*, acceptance recorded). NOTHING is enabled; propose-only stands everywhere; the backoffice grants UI is a later job, so no production path can create or enable a grant. This job builds two preconditions only.

## Deliverable
1. Migration 0011_autonomy_grants (additive; downgrade verbatim-restores): table autonomy_grants (id identity PK, identity_type TEXT NOT NULL CHECK IN (agent, staff_user), identity_id BIGINT NOT NULL, action TEXT NOT NULL, action_class TEXT NOT NULL CHECK IN (inventory, outward), daily_cap INT NOT NULL, enabled BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (identity_type, identity_id, action)).
2. ChatIn bounds: action max length 40; args validated at dispatch with a serialized-JSON ceiling of 4000 chars (422 on breach). Both tested.
3. NO wiring: the agent door behavior is UNCHANGED - agent execute=true still refuses 403 propose-only (asserted in the existing test). The grants lookup, execute branch, kill switches, UI and audit markers are later jobs. The migration ships inert.

## Acceptance
- Migration applied cleanly, downgrade restores, re-upgrade clean (owner runs the tools-profile verify).
- New tests: table/unique-shape fixture checks; bounds 422 cases; agent-door propose-only regression test still green.
- Gate: report the exact new count; the 3 deselects unchanged. Storefront untouched (state it).

## Allowed surfaces
alembic/versions/0011*, apps/backend/app/api/v1/staff_ai.py (bounds only - the schema and validators), tests. Anything else = CHANGES.

## Constraints
- Work only on branch factory/<job-id>; LF/no-BOM; gates AFTER docker compose build api; do not touch .env, secrets/, infra/nginx/certs/, alembic 0001-0010, factory/*.