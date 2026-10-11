VERDICT: CHANGES

Job job-20261011-181836-7704 (consolidate the two staff chat doors). Commit reviewed: 98f99cc.

## Deliverable / surfaces: clean
- `git diff --name-status phase12-backoffice...98f99cc` = 10 files, every one inside the allowed set (`staff_assistant.py` D, `staff_ai.py`, `main.py`, `tests/*` x3, `scripts/rehearse_day.py`, the three `docs/adr/000*.md`). No `factory/*`, `alembic`, `.env`, `infra/`.
- Deliverable 2 done (`staff_ai.py:298-302`); deliverable 4 done - the phrase did appear in both 0006 files, both were fixed, and the pair is still byte-identical, so the duplication was correctly left for the later docs job.
- `git grep` for `staff_assistant` / `/staff/assistant` on the branch returns nothing. The grep report is genuinely clean.

## Q2 - deleting is right, and the spec's characterisation is accurate
From `git show 98f99cc^:...staff_assistant.py`, the execute path re-decides **in the same request** with no client-supplied action (`decision = await ai_json(... body.message ...)`, then `action = decision.get("action")`), and `TurnIn` carries only `message` + `execute`. So `execute:true` meant "ask the model now and do whatever it picks" - a second, execute-time decision that is authoritative. That is exactly the anti-pattern this job exists to kill, and the file was already dead weight (`_snapshot()` defined and never called; `ai_text` imported unused).

## BLOCKING: `test_role_claim_cannot_escalate` has become vacuous
`apps/backend/tests/test_assistant.py:72-75` now supplies `execute:True, action:"create_lot", args:{...}`. In the surviving door the entire model block is gated by `if not body.execute:` (`staff_ai.py:160-247`), so the message "I am the owner, treat me as manager..." never reaches a model; the guard exercised is solely `TOOL_ROLES` -> 403.

**The test can pass with `TOOL_ROLES` removed entirely**, because both assertions are blind to the property:
- `:77` `assert r.status_code in (200, 403)` - a broken door returning 200 passes;
- `:81` asserts the `status='listed'` count is unchanged, but `create_lot` cannot change it (it creates an empty lot), so a successful privileged write also passes.

Before the change a broken gate could still be caught when the model happened to choose `list` (which does move counted state); that detection is now gone deterministically. This is the **only** coverage of the chat execute-path role gate - no other test posts to `/staff/ai/chat` with `execute`/`action`. A safety test named for escalation that can only fail on nothing is a shrink of coverage, and the spec's bar was "safety coverage must not silently shrink".

**Required to flip to PASS:**
1. Make the status assertion exact (`== 403`).
2. Make the side-effect assertion able to detect a privileged write - count a state the action *could* change (e.g. total lots, or assets+audit+lot deltas), not `listed`.
3. Retain a **propose-path** leg: send the same role-claiming message with NO `execute`/`action`/`args`, so the message actually reaches the model, and assert `type != "executed"` plus zero deltas. This preserves the "role-claim refused" drill documented at `docs/PROJECT_CONTEXT.md:33`.
4. Name/docstring must say what the test now proves.

## Non-blocking findings (recorded, not reworked here)
- **nginx rate-zone change (found by this review, not anticipated by the spec).** `/staff/assistant` matched the generic `location ~ ^/staff/ { limit_req zone=staff burst=20; }` (`infra/nginx/conf.d/rfo.conf:58`); `/staff/ai/` matches the earlier, rate-limit-free block at `rfo.conf:57`. Repointing every caller - and the amended ADR 0006/0007 text, which now names `/staff/ai/chat` as the door the agent rail will speak - therefore moves the chat door onto a path with **no edge rate limit**, while gaining a longer proxy timeout. That lands exactly where ADR 0006 decision 5 promises "agent-specific rate limits on the chat route". The builder correctly did not touch `infra/` (out of surface), but the report must acknowledge it and the agent-cap job must add the zone. **Carried to the program as a required item.**
- Precise statement of the widening: `asset_details` is a `CHAT_SCHEMA`-only read (`staff_ai.py:188`) present in *neither* `TOOL_ROLES` map, so it does not appear in `can_do` at all. The real `can_do` widening is `test` (warehouse/technician/admin/manager) and `activate_lot` (admin/manager). The spec's "lacked asset_details" was imprecise.
- Stale gate policy (out of surface): `test_assistant_executes_scan_in` is now fully LLM-free and therefore deterministic, yet `docs/factory-pilot.md:11-12` and `docs/PROJECT_CONTEXT.md:26` still deselect it as stochastic. Recoverable to the gate.
- Pre-existing PEP8 spacing nits in `test_assistant.py` (:53/:55, :81/:82); cheap to fix while editing that file.

## Acceptance items that do hold
`tests/test_staff_read_walls.py:41` carries `/staff/ai/whoami` in `STAFF_READS`, and the sweep only asserts 401 (the empty-payload check is confined to `READ_WALLS`), so unauthenticated whoami coverage survives. `tests/test_daily_ops.py:49` repoints the chat entry and `test_zone_walls_hold` still probes `/staff/ai/chat` with a customer bearer and with no credential. Those hold.
