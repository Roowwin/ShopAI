# autonomy: env kill switch + grants surface + promotion guards (ADR 0008 preconditions 4+6; still inert until deliberately enabled)

## Context
ADR 0008 adopted; job 12 = grants table (0011, inert); job 13 = persisted proposals + grant-gated execute (machine proven, 91/3→94/94 observed). Production remains inert because no grant can be created/enabled — THIS job adds the two kill switches and the admin-only grants surface that make enabling a deliberate act. ADR 0008 decision 6: env AI_AUTONOMY (default false) AND per-grant enabled must BOTH hold.

## Deliverable
1. ENV switch: AI_AUTONOMY (default false) read at execution time in the agent gate (staff_ai); false -> every execute turn degrades to proposal (refusal-free, never silent). Passed through compose (docker-compose.yml: one env interpolation line for the api service) and documented in .env.example (NOT .env). Changing it needs a restart (documented in .env.example comment).
2. Grants surface (staff_agents.py + apps/backoffice/app/admin/agents/page.tsx): GET /staff/agents/{id}/grants (rows + today usage via the cap key), POST /staff/agents/{id}/grants {action, daily_cap} - admin-only, AUDITED (agent/grant_create), action must be in GUARDED_ACTIONS (else 422); action_class is SERVER-DERIVED from a fixed map (price/list -> outward; everything else -> inventory) - never client-supplied (ADR 0008 decision 2/3); daily_cap sane bounds (1..100). PATCH /staff/agents/{grant_id} {enabled | daily_cap} (audited: grant_updated). DELETE /staff/agents/{grant_id} (audited: grant_revoked). Backoffice: extend the existing agents page with a grants panel per identity (list/create/enable-disable/revoke, print-once discipline for nothing new here); admin-only, fail-closed like the rest of the page.
3. Promotion guards (Precondition 4): the four CMS/product handlers that carry only a route Depends today (cms_put_home, approve_listing, create_product, cms_edit_product) gain in-body role guards via _require_role(staff, roles, action_name, db=None) - role-only paths: their action names are NOT in GUARDED_ACTIONS, so the grant branch refuses automatically (documented in the guard call). Report any OTHER Depend-only handlers found (fix if in allowed files; list otherwise).
4. audit_feed/actor_type (Precondition 8): MEASURED - EXPLAIN the overview feed with agent rows present; add a partial index ONLY if the plan says so (else document the measurement + the decision not to).

## Acceptance
- Tests: switch-off -> every execute returns a proposal; grants CRUD walls (401 unauth / 403 non-admin / 200 admin) + server-derived action_class (client-sent class ignored/rejected); promotion guards: an agent-less unauthed POST to each of the four handlers -> 401/403 as before via in-body; usage readback sane.
- Gate: report exact count; 3 deselects unchanged. Production still inert (no enabled grants; env absent = false).

## Allowed surfaces
app/api/v1/staff_agents.py, app/api/v1/staff_ai.py (switch read only), app/api/v1/staff_ops.py (guards only), docker-compose.yml (the ONE env line), .env.example, apps/backoffice/app/admin/agents/page.tsx (+layout nav if needed), alembic ONLY IF the index measurement says so, tests. Anything else = CHANGES.

## Constraints
- Work only on branch factory/<job-id>; LF/no-BOM; gates AFTER docker compose build api; never touch .env, secrets/, infra/nginx/certs/ (the nginx template/conf.d are NOT needed here - the edge caps already exist); factory/*.