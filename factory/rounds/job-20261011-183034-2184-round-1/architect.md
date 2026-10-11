VERDICT: CHANGES

Job job-20261011-183034-2184. Commit reviewed: 8bb3fde. (The nginx blocker is evidenced in full in `security.md`; this records the independent confirmation plus the structural verdict.)

## BLOCKER - the nginx half is written into a GENERATED file
Independently confirmed, with additional evidence beyond the security lens:
- The job edited only `infra/nginx/conf.d/rfo.conf`; the runtime source of truth is `infra/nginx/templates/rfo.conf.template`, which the entrypoint renders over conf.d on **every container start**.
- `docker-compose.yml` mounts both `/etc/nginx/templates` and `/etc/nginx/conf.d`; the repo's tracked `nginx-log.txt` records `20-envsubst-on-templates.sh: Running envsubst on /etc/nginx/templates/rfo.conf.template to /etc/nginx/conf.d/rfo.conf` at each start; the running container's conf.d still has the OLD unrated block.
- **`render(templates/rfo.conf.template, .env) == host infra/nginx/conf.d/rfo.conf` byte-for-byte** - proving conf.d is a derived artifact.
- Experiment on a throwaway container with temp copies (no repo file touched): running just the entrypoint under the compose bind-mount **removed the new block from the bind-mounted host copy**.
- Consequence: the next `docker compose up`/`restart nginx` drops both edits; the live edge has no `limit_req` on the chat door today; and the acceptance evidence (nginx -t / reload / before-after codes) **cannot be reproduced from a clean start**. The commit also breaks the `conf.d == render(template)` invariant that `6e15ff2` exists to maintain.

Fix: apply the identical two edits to `infra/nginx/templates/rfo.conf.template`, then re-render conf.d. The template is outside the spec's allowed-surface list, so **the spec is amended**. Irony worth recording: this is the same two-copies-drift failure the job exists to remove, one layer over.

## Roles half - real and non-vacuous (verified by mutation)
1. **Source of truth is genuine, not a coincidence of values.** Constants at `staff_ops.py:30-39`; `staff_ai.py:76-83` assigns the constant *objects*, so `TOOL_ROLES["test"]` and `["list"]` both point at the same `ROLES_SET_STATUS` object; `test_chat_tool_roles.py:63-65` pins both derivation (`is door`) and value (frozen literal). Confirmed by mutation: re-hardcoding TOOL_ROLES for test/list -> `test_chat_tool_roles_derive_from_ops_doors` FAILS; widening `ROLES_SET_STATUS` to add technician -> **both** tests in that file FAIL (door-side widening is caught by the frozen literal, not only by the `is` check).
2. **Bypass closed structurally.** `_require_role` (`staff_ops.py:42-49`) is the **first statement** of every handler the chat dispatches into - `create_lot:91`, `activate_lot:105`, `scan_in:122`, `grade:146`, `set_status:168`, `move:187`, `set_price:246` - exactly the seven targets of `staff_ai.py:268/271/277/285/287/289/291/293`. Same status and detail string as `deps.require_roles` (403 "insufficient role"), so no status-code change for the HTTP door and no double-raise (Depends runs first; the body is never reached on denial). The guard sits before any DB access.
3. **No other caller's role set changed.** All seven converted routes carry tuples identical to their previous literals (checked mechanically against `phase12-backoffice`); the constants are read only by those routes, `staff_ai.TOOL_ROLES` and the new test. No third copy: the backoffice only renders the API's `can_do`. No dead constant.
4. **Tests hold up.** The drift table covers all eight chat actions. Escalation tests are non-vacuous: with a full pre-fix revert (literals back + `_require_role` calls removed) they FAIL on a real write (chat `test` returned 200 and moved audit rows). The 422 contract test is correct and action-scoped - removing the guard would 500 on `TOOL_ROLES[""]`, so it is not vacuous. The docstring correction is accurate: every non-execute return site is `answer`/`proposed`, the only non-execute write is Redis `_mem_push`, so "canary, not coverage" is the right description.
5. Gate green: 47 passed (baseline 42), 3/3 runs.

## Minor / residual (recorded, not required)
- **The `Depends` is now the weaker twin** for these seven routes: editing only the `Depends` is a silently dead edit because the body guard wins. Fail-closed, so harmless, but worth knowing.
- **Residual test gap:** nothing pins `TOOL_ROLES[action]` to the function the chat actually dispatches to - `CHAT_ACTION_DOORS` is hand-written, so a dispatch retarget would not be caught. The body guard keeps that fail-closed.
- The 2k body cap is tighter than the API's own contract (multi-byte text blows 2k at ~512 chars). Spec-prescribed, so not a builder defect - but recorded, and now being fixed.
- **Non-hermeticity:** in its first full-suite run two pre-existing live-model propose-leg counter assertions failed, not reproducible in 3 later full suites or 6 isolated runs (baseline passed 2/2 full + 8/8 isolated) - shared-DB/live-model interference, not introduced here. Note the new docstring calls the propose leg a "canary" while it is simultaneously the least hermetic test in the file.
