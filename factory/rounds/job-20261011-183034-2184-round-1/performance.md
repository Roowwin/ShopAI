VERDICT: CHANGES

Job job-20261011-183034-2184 (one source of truth for chat tool roles + restore the chat door rate limit). Commit reviewed: 8bb3fde. Latency / queries / rate-limit impact only.

## 1. The rate limit - measured, NOT a per-user regression
- Definition: `limit_req_zone $binary_remote_addr zone=staff:10m rate=10r/s`; rate comes from `RATE_LIMIT_STAFF_RPS=10`. Key = **client IP**; `burst=20 nodelay` on both new blocks.
- Page load: `assistant/page.tsx:86-89` fires **4** requests (`/status`, `/briefing`, `/suggestions`, `/activity`), each awaited sequentially, plus the shell's `/staff/me` = **~5**. Against burst 20 refilling at 10 r/s that uses 25% of the bucket and drains in <0.5 s. **Cannot trip.**
- Chat turns: 1 POST + 2 side reloads = **3** per turn, and the UI serialises turns (`if (!message || busy) return;`) with a model call in the path, so turns are seconds apart. **Cannot trip.**
- Empirically confirmed on the live stack (same zone/burst, base conf, one IP): 30 parallel curls at a `^/staff/` route -> **25 reached the app (401), 5 -> 503**.
- **Correction to carry:** rejections are **503, not 429** - there is no `limit_req_status` anywhere in `infra/nginx/`, so nginx's default applies. The UI renders it as "error: 503" and cannot distinguish throttling from an outage; `r.ok` false also silently drops the side-panel refresh. Pre-existing edge-wide house style; recorded, not changed.
- Residual notes (not blocking): the key is per-IP, so several staff behind one office NAT share the 20, and this change adds the AI page's 5-6 requests to that shared bucket (previously `^/staff/ai/*` was exempt). Also, because `nodelay` never delays, a saturated window makes the 25m `intake-draft` upload fail with 503 rather than wait. Both are pre-existing properties of `zone=staff`, now extended.

## 2. BLOCKING - `client_max_body_size 2k` on `/staff/ai/chat` is a functional bug
`ChatIn.message` is `max_length=2000` (`staff_ai.py:63`), **not** 900 - 900 is the storefront's (`store_assistant.py:32`), so the spec's premise was wrong. Pydantic counts characters; nginx counts bytes. Measured:
- 2000-char ASCII plain = 2014 B (34 B headroom)
- the same message with `execute:true, action, args` = **2055 B -> 413**
- execute + args = 2091 B -> 413
- 2000 CJK chars = 6014 B; only ~677 3-byte chars fit before 413 while the schema still accepts 2000.
The broken flow is specific: `confirm()` re-sends the identical text with `execute:true`, so a long message that proposes fine will 413 on Confirm; non-ASCII 413s on first send; no client-side cap.
Fix: raise the chat cap to ~8-16k (covers 2000 chars x 4 B + args), or lower `ChatIn` to 900 to match the storefront. Given ADR 0006/0007 put the agent rail on this route, raising is the right call.

## 3. `intake-draft` correctly protected - PASS
`location ~ ^/staff/ai/chat$` is anchored and sits **before** `^/staff/ai/`; `/staff/ai/intake-draft` cannot match the chat regex, so it takes the general block, which carries no `client_max_body_size` and inherits the vhost's `25m`. App-level image cap is 6 MB. The spec's trap was avoided.

## 4. In-body role guards add no per-request cost - PASS
`_require_role` is a tuple membership test on the `staff` dict already loaded by `get_staff` (one query). No new DB round trip; on the HTTP door the same comparison simply runs twice. In every handler the in-body guard is the **first** statement, ahead of the first `db.get`/`db.execute`, so the deny path is strictly *cheaper* than before. `require_roles(*ROLES_X)` passes the same tuple objects - dependency and query counts unchanged.

## 5. Test cost - negligible
`test_chat_tool_roles.py` is hermetic (two dicts plus plain handler calls with `db=None`; no DB, no identities). `test_assistant.py` grows 6 -> 9 tests, each minting identities; `_counts()` issues 3 `SELECT count(*)` per call. Net ~4 extra staff identities and ~8 extra count queries per run - nothing that moves the gate's runtime materially.

No other latency or query regressions in the diff; no files outside the allowed surfaces touched.
