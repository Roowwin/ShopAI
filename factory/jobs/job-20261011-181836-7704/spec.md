# backend: consolidate the two staff chat doors (delete /staff/assistant)

## Context
Two staff chat doors have drifted apart, and they must become one before the autonomy work builds on them.

- `app/api/v1/staff_ai.py` -> `POST /staff/ai/chat`. The superset: a 10-action `CHAT_SCHEMA` (`none, asset_details, activate_lot, create_lot, scan_in, test, grade, price, list, move`), Redis memory, `CHAT_DAILY_CAP`, a fallback-model execute guard, and an **action-scoped** execute (the client sends `{execute:true, action, args}` and the server executes exactly that).
- `app/api/v1/staff_assistant.py` -> `POST /staff/assistant`. A near-duplicate with a 6-action `DECISION_SCHEMA` (`none, create_lot, scan_in, grade, price, list, move`), its own `TOOL_ROLES`, a raw-SQL snapshot via `get_db` instead of the `ai.*` views, and an execute branch that **re-decides the action server-side**.

That server-side re-decide is why this job comes first: the autonomy rail must execute the action the model already decided, and must never re-derive one at execute time. Whichever door survives has to be the one with the action-scoped contract.

## Deliverable
1. `git rm app/api/v1/staff_assistant.py`, and drop its import + `include_router` from `app/main.py`.
2. Add `GET /staff/ai/whoami` to `staff_ai.py` returning the payload the deleted `/staff/assistant/whoami` returned (role + the tools that role may execute), so read-wall coverage is preserved rather than lost.
3. Repoint every caller. Known sites - **verify by grep, there may be more than these four**:
   - `tests/test_assistant.py` (`/staff/assistant` -> `/staff/ai/chat`; `/staff/assistant/whoami` -> `/staff/ai/whoami`)
   - `tests/test_daily_ops.py` (the chat entry in `STAFF_WRITE_DOORS`)
   - `tests/test_staff_read_walls.py` (the whoami entry)
   - `scripts/rehearse_day.py` (two paths, around :91 and :505)
4. Correct `docs/adr/0007-authorized-agent-rail.md` decision 3, which names `/staff/assistant` as "the EXISTING /staff/assistant chat protocol" - it must name `/staff/ai/chat`. Apply the same wording fix to the two ADR 0006 files **only if the phrase appears there**. The two 0006 files are byte-identical duplicates; do **not** resolve that duplication here - it belongs to a later docs job.

Nothing else. No new behaviour, no schema change, no migration, and no change to `staff_ai.py`'s existing routes beyond adding `whoami`.

## Acceptance
- `docker compose build api` then `docker compose run --rm api pytest -q` green. Report the count before and after.
- A grep report proving no remaining live reference to `/staff/assistant` or `staff_assistant` (report any intentional historical mention left in docs).
- **Safety coverage must not silently shrink.** `tests/test_staff_read_walls.py`'s unauthenticated sweep must still cover the whoami door (now `/staff/ai/whoami`), and `tests/test_daily_ops.py::test_zone_walls_hold` must still assert the chat door refuses non-staff callers. State explicitly in the report that both still hold.
- The two doors' tool sets differ: `staff_assistant` lacked `asset_details`, `activate_lot` and `test`. Repointing callers at the superset therefore **widens** what a caller can reach. Say so explicitly in the report - do not let it pass as a no-op.
- Allowed surfaces: `apps/backend/app/api/v1/staff_assistant.py` (delete), `apps/backend/app/api/v1/staff_ai.py`, `apps/backend/app/main.py`, `apps/backend/tests/**`, `apps/backend/scripts/rehearse_day.py`, `docs/adr/000*.md` (path wording only). Anything else = **CHANGES**.

## Constraints
- Work only on branch `factory/<job-id>` (worktree provided) - LF / no BOM; PS 5.1 write rules
- Run: `docker compose run --rm api pytest -q` (must be green). Build the api image first - it has **no source bind-mount**, so a gate run only exercises your code after `docker compose build api`
- Do NOT touch: `.env`, `secrets/`, `infra/nginx/certs/`, `alembic`, `factory/*`
