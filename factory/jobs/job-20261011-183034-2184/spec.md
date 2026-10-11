# backend: one source of truth for chat tool roles + restore the chat door rate limit

## Context
Job job-20261011-181836-7704 consolidated the two staff chat doors onto `POST /staff/ai/chat` and, in doing so, the security review found two problems that the consolidation exposed but did not create. Both are walls around the surface the coming autonomy rail will speak, so they are fixed before it is built.

**1. The chat allow-list is more permissive than the doors it dispatches into.**
`staff_ai.py:280,286` calls `staff_ops.set_status(...)` (and its siblings) as **plain functions**, so those routes' `Depends(require_roles(...))` never evaluates. The effective gate is chat's own `TOOL_ROLES` (`staff_ai.py:70-79`), which for two actions disagrees with the door it calls (`staff_ops.py:128` `require_roles("admin","manager","warehouse")`):

| chat action | chat `TOOL_ROLES` today | underlying door |
|---|---|---|
| `test` -> `set_status("tested")` | admin, manager, warehouse, **technician** | admin, manager, warehouse |
| `list` -> `set_status("listed")` | admin, manager, **sales** | admin, manager, warehouse |

Net effect today: a **technician can drive `received->tested`** and a **sales user can list a unit through chat** - making it publicly buyable - while the direct endpoint would 403 them.

**Owner decision (binding for this job): align DOWN to the direct endpoint.** The two surfaces become one shared value set to the door's stricter tuple. This **deliberately removes** chat-initiated `test` from technicians and chat-initiated `list` from sales. Nothing that is not already possible via some route becomes possible. State this capability reduction explicitly in the report - it is intended, not incidental.

**2. The chat door lost its edge rate limit.**
`/staff/assistant` used to match the generic `location ~ ^/staff/ { limit_req zone=staff burst=20 nodelay; }` (`infra/nginx/conf.d/rfo.conf:58`). `/staff/ai/` matches an **earlier** block (`:57`) that carries the long proxy timeouts but **no `limit_req`**. So every repointed caller - and ADR 0006/0007, which now name `/staff/ai/chat` as the door the agent rail will speak - sits on an unrated path, exactly where ADR 0006 decision 5 promises "agent-specific rate limits on the chat route".

## Deliverable
1. **One source of truth for action -> roles.** In `staff_ops.py`, define named module-level role tuples for every action the chat tool set can dispatch (`create_lot`, `scan_in`, `grade`, `price`, `move`, and the status transitions behind `test`/`list`/`activate_lot`). Use them in the route `Depends(require_roles(*CONST))` **and** have `staff_ai.TOOL_ROLES` derive from those same constants (import them) instead of its own literals. After this, the two cannot drift without failing the test in item 4a.
2. **Close the bypass structurally.** Add an in-body role guard to each `staff_ops` function the chat dispatches to (a small shared helper, e.g. `_require_role(staff, ROLES_X)`), so the check holds however the function is invoked. Keep the route `Depends(...)` as well - belt and braces, and it preserves the 403 for the HTTP door.
3. **Apply the alignment.** `TOOL_ROLES["test"]` and `TOOL_ROLES["list"]` become the status-transition tuple (`admin, manager, warehouse`).
4. **Tests** (hermetic, house pattern; the chat door calls a live model, so pin determinism by sending `execute`+`action`+`args`, which short-circuits the model block):
   - (a) **Pin the equality**: for every chat action, assert `TOOL_ROLES[action] == the corresponding `staff_ops` role tuple`. This is the drift alarm - it must fail if anyone re-widens one side.
   - (b) **The two closed escalations**: a technician gets 403 + zero `(lots, assets, audit_log)` deltas on chat `test`; a sales user gets the same on chat `list`. Include **pre-fix evidence** (run the new test against the un-mutated-but-unfixed code, or mutate `TOOL_ROLES` back) showing it fails without the change.
   - (c) **Pin the action-scoped contract**: `POST /staff/ai/chat` with `execute:true` and (i) no `action`, (ii) an unknown action -> **422**, and nothing written. Nothing currently covers this, and it is the property that motivated the consolidation.
   - (d) Correct the docstring overstatement added in the previous job: `tests/test_assistant.py` currently claims "two legs, and both are load-bearing". The **propose** leg is structurally guaranteed (every return site on a non-execute path is `answer`/`proposed`, with no write), so it is a **canary**, not coverage. Say so.
5. **Restore the rate limit** in `infra/nginx/conf.d/rfo.conf`, mirroring the public-assistant precedent at `:55`. Add, **before** the existing `^/staff/ai/` block (regex locations match in order, first wins):
   ```
   location ~ ^/staff/ai/chat$ { limit_req zone=staff burst=20 nodelay; client_max_body_size 2k; proxy_read_timeout 190s; proxy_send_timeout 190s; proxy_pass http://$up_api; }
   ```
   and add `limit_req zone=staff burst=20 nodelay;` to the existing `^/staff/ai/` block, keeping its 190s timeouts.
   **TRAP - do not add `client_max_body_size` to the general `^/staff/ai/` block.** That block also serves `POST /staff/ai/intake-draft`, which takes a **multipart image upload**; a 2k cap there would break the vision intake flow. The cap belongs only on the chat route.

Nothing else. No schema change, no migration, no change to the chat's write semantics.

## Acceptance
- `docker compose build api` then `docker compose run --rm api pytest -q` green. Report the count before and after.
- Pre-fix evidence for 4b (the escalation tests fail without the alignment).
- The 4c 422 assertions, quoting what the endpoint returns.
- A `TOOL_ROLES` before/after table, with the two removed role entries named explicitly.
- nginx: `nginx -t` output, a reload, then before/after status codes for `/staff/ai/chat` and for the four page-load endpoints the assistant UI calls (`/staff/ai/status`, `/briefing`, `/suggestions`, `/activity`). State the zone and burst used, and argue explicitly why a normal page load (5 requests) cannot trip it. Confirm `intake-draft` is unaffected by the body-size decision.
- Allowed surfaces: `apps/backend/app/api/v1/staff_ops.py`, `apps/backend/app/api/v1/staff_ai.py`, `apps/backend/tests/**`, `infra/nginx/conf.d/rfo.conf`. The house do-not-touch list names `infra/nginx/certs/` - **certs only**; `infra/nginx/conf.d/rfo.conf` is in scope here. Anything else = **CHANGES**.

## Constraints
- Work only on branch `factory/<job-id>` (worktree provided) - LF / no BOM; PS 5.1 write rules
- Run the gate by mounting your worktree, since the api image bakes the MAIN tree:
  `MSYS_NO_PATHCONV=1 docker compose run --rm -v "<worktree>/apps/backend:/app" api pytest -q`
  Report the exact command. Also run `docker compose build api` to confirm it builds.
- Do NOT touch: `.env`, `secrets/`, `infra/nginx/certs/`, `alembic`, `factory/*`
- Changing `staff_ops` role constants touches live authorization: keep existing role sets otherwise identical, and say in the report which callers you re-verified.
