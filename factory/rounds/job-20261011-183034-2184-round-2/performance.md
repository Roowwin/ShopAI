VERDICT: PASS

Job job-20261011-183034-2184 round 2. Delta reviewed: `8bb3fde..50d7869` (3 files: `staff_ops.py` comment, `conf.d/rfo.conf`, `templates/rfo.conf.template`).

## 1. Cap fix - 16k is sufficient for the real contract; two pathological cases named
`client_max_body_size 16k` is on `location ~ ^/staff/ai/chat$` only; the general `^/staff/ai/` block stays uncapped and inherits the vhost's 25m, so `intake-draft` is safe. Regex order unchanged.
Arithmetic vs `ChatIn.message = 2000` chars: 2000 x 4 B/char worst-case UTF-8 = 8000 B, + JSON envelope (~60 B) + action/args (~200 B) = **~8.3 kB < 16384 B**, i.e. ~2x headroom. Every round-1 failing case now clears (plain 2014 B, execute+args 2091 B, 2000 CJK 6014 B, 2000 emoji ~8000 B).
**Pathological cases that can still exceed 16k** (named; both non-blocking because neither is reachable from the shipped UI and neither is a regression - before this job the route had no cap at all):
- (a) A client emitting `\uXXXX` escapes for non-ASCII (not browsers - `JSON.stringify` emits raw UTF-8, but an agent/CLI client typically escapes): non-BMP emoji become surrogate pairs at 12 B/char, so 2000 chars = **24 kB -> 413** while the schema still accepts it.
- (b) `args: dict | None` and `action: str | None` carry **no length constraint**, so an execute turn with a large `args` payload is schema-valid and can exceed 16k. Not reachable from the UI (`args` only ever come from the server's own proposal), **but the forthcoming agent rail speaks this door**. Optional hardening: bound `action`/`args`, or state the edge cap in the ADR.
Carried to the autonomy job's spec.

## 2. Rate limit unchanged - and now in the file that actually renders
Both files carry `limit_req zone=staff burst=20 nodelay` on the chat and general `^/staff/ai/` blocks; the generic `^/staff/` block is untouched. Zone definition unchanged (`$binary_remote_addr zone=staff rate=10r/s`). No new `limit_req` anywhere in the delta.
The more important half: round 1 patched only `conf.d/rfo.conf`, the *rendered artifact*. The entrypoint envsubst-renders the templates over `conf.d`, so the template is the live source - round 1's rate limit and cap would have been silently wiped on the next nginx container start. The two files now agree, so the fix survives a redeploy.

## 3. 503, not 429 - still true
No `limit_req_status` directive exists anywhere in `infra/nginx/`; nginx's default 503 applies, and the delta introduced none.

## 4. No new latency or query cost
The only non-nginx change is a 3-line comment block in `staff_ops.py`. No code, no route, no query, no dependency change.

Round-1 findings 3 (intake-draft uncapped), 4 (in-body guards add no DB round trip) and 5 (test cost negligible) are unaffected and remain PASS.
