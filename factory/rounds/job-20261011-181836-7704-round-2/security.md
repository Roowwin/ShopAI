VERDICT: PASS

Round 2 re-check of job job-20261011-181836-7704. Delta reviewed: `98f99cc..ff64267` - one file, one hunk, inside the allowed surface. `TOOL_ROLES` untouched vs `8d6bd51`.

## No other assertion weakened
The delta is one hunk; the full file was read at `ff64267`. `test_assistant_proposes_without_writing`, `test_assistant_executes_scan_in`, `test_whoami` (incl. the no-token 401), `test_chat_clears_context` and `test_chat_suggestions_shape` are byte-identical to `98f99cc`. Only `test_role_claim_cannot_escalate` changed, and only upward in strictness.

## The `== 403` leg is a real gate
Only two 403 sources exist in the door: the fallback guard (`staff_ai.py:252-253`) and the TOOL_ROLES gate (`:254-255`). The fallback guard cannot fire here - it requires `_FALLBACK_PROPOSAL.pop(sid)` truthy, only set on a *propose* call, and the execute leg runs first on a fresh per-test staff id. Route-level `require_roles` includes technician, so it passes. A 403 here is therefore uniquely `role not in TOOL_ROLES["create_lot"]`. Widening the allow-list (or deleting the check) makes the door fall through to `staff_ops.create_lot` and return 200 - the assert fails. The builder's mutation produced exactly that 200.
Second, independent detector: `:106` asserts the `(lots, assets, audit_log)` triple is unchanged; create_lot inserts a lot row and an audit row, so a leaked execute fails this leg even if the status code were tolerated. The round-1 defect is genuinely fixed.

## Propose leg cannot write, and 502 cannot mask a write
Every write lives in the execute branch (`:249-295`); the propose branch contains only `_resolve_*` reads and a Redis memory push. The 502 tolerance covers only 502, raised from the `AIError` handlers before any handler could run. Critically `:117`'s counter assertion is **unconditional** - it sits after the if/else - so a 502 must still show a zero DB delta. A 403/422/500 fails outright.
Coverage caveat (not a weakening): with the model unreachable the leg degrades to proving only "502 wrote nothing"; its stronger property is model-dependent, and the model-free execute leg carries the load. Honestly documented.

## No assertion can pass for the wrong reason
`:105` unique-403 argument above; a bad token would be 401 (fails). `:106`/`:117` global counts: `lots`/`assets`/`audit_log` are append-only, other suites' cleanup deletes identities only, and the suite is single-threaded, so no concurrent mutation can net a real write to zero. `:116`'s `type != "executed"` would pass a 200 lacking `"type"`, but the unconditional counter assert covers any write. No 429 risk: the cap is `n > 100` only for non-privileged roles and each run uses a fresh staff id.

## Correction to the builder's claim about the leftover dev-DB row
The builder justified leaving `LOT-2026-00700` (id 728, status `intake`, 0 assets) by saying it is invisible in the UI because briefing/suggestions filter `units > 0`. **That is partly wrong:** `ai_snapshot` (`staff_ai.py:388`, `ORDER BY lot_number DESC LIMIT 8`) has **no** such filter, so the empty lot now appears in the model's `recent_lots` context, and it also shows in the admin/manager-gated `GET /staff/lots`.
**Impact: none** on authorization, data exposure or the Confirm invariant - the exposed value is a generated lot number plus `units: 0`; no serials, prices, cost, or ids beyond a monotonic lot number; the snapshot's only reader is an authenticated staff chat.
**Recorded as a deliberate deviation.** Do not clean it ad hoc: `audit_log` is append-only by design, so deleting the lot would orphan/contradict the ledger, and `alembic` is on this job's do-not-touch list. Hand to whichever job owns data hygiene - the natural fix is a reset/seeder sweep of empty intake lots, not surgery in a code branch.
Also noted: the mutation test was good practice (it is the evidence the assertion can fail) but should have run against a throwaway/transactional fixture rather than the shared dev DB.
