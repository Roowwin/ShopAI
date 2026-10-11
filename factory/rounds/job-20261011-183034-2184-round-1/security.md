VERDICT: CHANGES

Job job-20261011-183034-2184 (one source of truth for chat tool roles + restore the chat door rate limit). Commit reviewed: 8bb3fde.

## The auth half IS genuinely closed - proven adversarially, not asserted
- Every dispatch target of `staff_ai.chat` is guarded in-body: the eight chat actions map to seven `staff_ops` functions, each guarded by `_require_role` at `staff_ops.py:91,105,122,146,168,187,246`. No target missed.
- A technician is refused `test` at `staff_ai.py:259` **and** again at `staff_ops.py:168`; sales likewise for `list`. Both refusals precede any DB access (`_resolve_asset` is at `staff_ai.py:280`; the guards are function-first), so the deltas are zero, not merely zero-committed.
- **Mutation-proven non-vacuous** (temporary pytest plugins; no repo files edited):
  - pre-fix simulation (allow-list re-widened **and** `_require_role` no-op'd) -> both escalation tests FAIL with `/staff/ai/chat 200` - the write lands. The tests discriminate the pre-fix code.
  - no-op `_require_role` alone -> `test_ops_handlers_guard_their_own_body` fails (handler runs past the guard with `db=None`) -> the guard is pinned.
  - revert `TOOL_ROLES` alone -> `test_chat_tool_roles_derive_from_ops_doors` fails -> re-widening is pinned.
  - Caveat on coverage shape: the drift alarm lives in `test_chat_tool_roles.py:55-65`, **not** the single test the spec named. The two `test_assistant.py` escalation tests alone would not catch a re-widened allow-list, because the body guard backstops. Coverage is complete as a set, split across files - say so rather than implying one test does it all.
- No permission gain anywhere: every `require_roles` tuple in `staff_ops.py` is value-identical before/after; only `TOOL_ROLES["test"]` (technician removed) and `["list"]` (sales removed) narrowed. `TOOL_ROLES` values are the same tuple objects the routes use (`is`-pinned).
- HTTP doors intact: `Depends(require_roles(*CONST))` still on all seven write routes; `_require_role` **raises** 403 (same status/detail as `deps.py`), never returns; refusals stay 403 (no 403->500/200 flip). Full gate green on the worktree mount: 47 passed.
- Trap respected: no `client_max_body_size` on the general `^/staff/ai/` block, so the multipart `/staff/ai/intake-draft` path is unaffected; the 2k cap is only on `^/staff/ai/chat$`, and the vhost's 25m still applies above.
- Main tree clean: `git status --porcelain` shows no modification under `infra/`; the builder's boundary slip was corrected (md5 back to base, live edge reloaded onto the base config).

## BLOCKING - the nginx half is a no-op live and will not survive an nginx restart
`infra/nginx/conf.d/rfo.conf:61-62` is correct in the commit, but that file is a **rendered artifact, not the source**. `docker-compose.yml` mounts `./infra/nginx/templates`, and the stock `nginx:*-alpine` image's `/docker-entrypoint.d/20-envsubst-on-templates.sh` regenerates `/etc/nginx/conf.d/rfo.conf` from `rfo.conf.template` at **every container start**, writing into the bind-mounted repo dir. Verified three ways:
- `infra/nginx/templates/rfo.conf.template:57` still has the **unrated** block, and this job touched nothing under `infra/nginx/templates/` (empty `git diff --stat`).
- Reproduced in isolation with a throwaway container: the entrypoint logged *"Running envsubst on .../rfo.conf.template to /etc/nginx/conf.d/rfo.conf"* and wrote a file whose only `ai/` line is the old unrated one.
- The live container right now returns only the base unrated block, so the next `docker compose restart nginx` reverts the committed edit entirely. House convention agrees the template is the source (`5fad303` changed the template; `6e15ff2` was "re-rendered conf after template changes").

Required: make the same change in `infra/nginx/templates/rfo.conf.template`. That file is outside the job's declared allowed surface, so **the spec is amended for it**.

## BLOCKING - the 2k body cap rejects legitimate requests
`ChatIn.message` is `max_length=2000` (`staff_ai.py:63`) - **not** 900. 900 is the *storefront's* value (`store_assistant.py:32`); the spec conflated the two. Pydantic counts characters, nginx counts bytes. Measured JSON body sizes:
- 2000-char ASCII plain = **2014 B** (fits, 34 B headroom)
- **the same message on a Confirm turn** (`execute:true, action, args`) = **2055 B -> 413**
- execute + args (`create_lot` with warehouse/notes) = 2091 B -> 413
- 2000 CJK chars = 6014 B

Concrete broken flow: `confirm()` re-sends the *identical* message text with `execute:true` (`page.tsx:126-130`), so a message that proposes successfully at 2014 B will 413 the moment the user clicks Confirm. Non-ASCII messages 413 on the *first* send. The composer has no client-side cap.

Required: raise the chat cap to 16k (2000 chars x 4 B worst-case UTF-8 + envelope + args). Note the fix direction: ADR 0006/0007 put the agent rail on this route, so raising is right rather than lowering `ChatIn` to 900.

## Non-blocking
- The new zero-delta assertions use **global** `(lots, assets, audit_log)` counts against the shared dev DB, so they false-fail under a concurrent run (observed 846 -> 847 lots plus a spurious `401 account unavailable` when another suite ran alongside). Serial gate runs pass. Robustness, not a hole.
- Adjacent, out of scope, does not reopen the closed hole: `POST /store/reservations` and `POST /store/reservations/{rid}/release` are unauthenticated and flip `listed <-> reserved`; `reserve` requires `status == "listed"`, so neither can reach the graded->listed escalation. Worth a look when the autonomy rail lands.
