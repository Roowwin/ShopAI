# feedback - job-20261011-183034-2184 round 1 -> round 2

Builder: the authorisation half is closed and structurally right, and two reviewers proved it by mutation rather
than accepting your evidence. Your pre-fix evidence was excellent - reverting only the two source files made the
escalation tests fail with `{"type":"executed","action":"test",...}` / `assert 200 == 403`, i.e. the write really
landed. Gate 47 passed. Two things block, both on the nginx half, and **the second is my spec's error, not yours.**

## REQUIRED 1 - the nginx edit is in a generated file (spec surface amended)
`infra/nginx/conf.d/rfo.conf` is a **rendered artifact**. The nginx entrypoint runs
`20-envsubst-on-templates.sh`, regenerating `/etc/nginx/conf.d/rfo.conf` from
`infra/nginx/templates/rfo.conf.template` at **every container start**, writing into the bind-mounted repo dir.

Consequences: your committed change is a **no-op live** today (the running container still has the old unrated
block), and the next `docker compose up` / `restart nginx` **erases it**. Two reviewers confirmed independently -
one proved `render(templates/rfo.conf.template, .env) == host infra/nginx/conf.d/rfo.conf` byte-for-byte, and
reproduced the overwrite on a throwaway container. The repo's own tracked `nginx-log.txt` records the envsubst
line at each start.

Fix: apply the identical two edits to **`infra/nginx/templates/rfo.conf.template`**, then re-render conf.d so the
two agree. `infra/nginx/templates/` was not on the allowed-surface list - that was my omission, so **the spec is
amended to include it**. House convention agrees the template is the source: `5fad303` changed the template and
`6e15ff2` was "re-rendered conf after template changes".

Irony worth noting in your report: this is the same two-copies-drift failure this job exists to remove, one layer
over.

## REQUIRED 2 - raise the chat body cap (my spec's error)
`client_max_body_size 2k` is tighter than the API's own contract. `ChatIn.message` allows **2000 characters**
(`staff_ai.py:63`) - the 900 figure I put in the spec is the *storefront's* (`store_assistant.py:32`), so my
premise was wrong. Pydantic counts characters; nginx counts bytes. Measured: 2000-char ASCII plain = 2014 B;
**the same message on a Confirm turn = 2055 B -> 413**; execute + args = 2091 B; 2000 CJK chars = 6014 B.

The concrete break: `confirm()` re-sends the *identical* text with `execute:true`, so a long message that
proposes successfully fails the moment the user clicks Confirm, and non-ASCII fails on first send.

Fix: raise the cap on `^/staff/ai/chat$` to **16k** (2000 chars x 4 B worst-case UTF-8 + envelope + args). Do NOT
lower `ChatIn` to 900 - ADR 0006/0007 put the agent rail on this route, so the cap should accommodate the
contract, not the other way round. Keep the 2k-equivalent **off** the general `^/staff/ai/` block (your trap
handling was correct - `intake-draft`'s multipart upload must stay uncapped).

## Verified correct - do NOT change
The single-source-of-truth mechanism (allow-list points at the same constant objects the routes use; pinned by an
`is` check AND a frozen literal, so re-widening either side fails CI), the first-statement in-body guards on all
seven dispatch targets, the unchanged role sets on every converted route, the non-vacuous escalation and 422
tests, and the docstring correction ("canary, not coverage") - all independently confirmed by mutation.

## Recorded, not required
- For these seven routes `Depends` is now the weaker twin: editing it alone is a dead edit because the body guard
  wins. Fail-closed, so harmless - just worth a one-line comment so a future reader does not "fix" the wrong one.
- Nothing pins `TOOL_ROLES[action]` to the function the chat actually dispatches to (`CHAT_ACTION_DOORS` is
  hand-written), so a dispatch retarget would not be caught. Recorded.
- Your nginx report should state the throttle status code honestly: the chat route answers **503**, not 429,
  because there is no `limit_req_status` in `infra/nginx/`. Do not describe it as a 429.

## When done
Re-run the gate with the worktree-mount recipe, re-validate the template (`nginx -t` against a rendered copy of
your template, then confirm `render(template) == conf.d`), re-do the 413/422 probes at the new cap, commit, and
report. Leave the live edge on the base config as before. Do not merge or push.
