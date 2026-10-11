# fix: auth walls on staff READ endpoints + gitignore anchor

## Context
Job 7 surfaced it: GET /staff/assets, GET /staff/lots, GET /staff/movements have NO auth dependency (staff_ops.py ~120-140) - customer token or NO token returns 200 with serials, grades, statuses, locations. Store is live; unauthenticated serial reads exist. Also .gitignore line 39 (scripts/) matches nested dirs and forced git add -f for apps/backend/scripts files.

## Deliverable
1. Add the house auth dependency (require_roles("admin","manager") - matching sibling staff GETs) to the three named GETs - AND sweep: grep ALL GET routes under /staff/* in the backend for missing auth deps; fix every one found; list each in the report with file:line.
2. Tests (hermetic, house pattern): for each fixed door - unauth -> 401; customer bearer (register+login) -> 401/403; admin -> 200. Aim probes at nonexistent ids so a broken wall self-reports without data.
3. .gitignore: anchor the scripts/ rule to /scripts/ (root only) so nested scripts dirs stay tracked - this removes the git add -f requirement future builders hit.
Nothing else. No app source beyond the touched staff GETs + deps. No migrations.

## Acceptance
- New tests pass in the gate (report new count; 4 deselects unchanged).
- A sweep report listing every GET audited (gated or already-gated, file:line).
- Allowed surfaces: staff_ops.py, tests (+1 new or existing test file), .gitignore. Anything else = CHANGES.

## Constraints
- Work only on branch factory/<job-id>; LF/no-BOM; gates AFTER docker compose build api; do not touch .env, secrets/, infra/nginx/certs/, alembic, factory/*.