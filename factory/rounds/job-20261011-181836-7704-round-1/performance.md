VERDICT: PASS

Job job-20261011-181836-7704 (consolidate the two staff chat doors). Commit reviewed: 98f99cc. Perf lens only (queries, N+1, latency).

## 1. `GET /staff/ai/whoami` - no DB work
Handler `staff_ai.py:298-302` has zero DB statements; the only DB touch is the shared auth dependency (one indexed lookup on `staff_users.public_id`, UNIQUE). Identical to the deleted route. `can_do` iterates 8 entries instead of 6 - O(1). Zero measurable delta.

## 2. The "raw SQL snapshot" premise was wrong: that code was dead
`_snapshot` in the deleted file was **never referenced**; the live `/staff/assistant` prompt called `ai_snapshot(ai_db)` - the same `ai.*` view snapshot the survivor uses. So this job removes dead code, not query cost; both doors were already view-based for the prompt.
What *was* live raw SQL over base tables (`_resolve_asset`/`_resolve_lot`) is not removed, it is moved: the survivor does the same lookups, covered by `uq_assets_serial` and `lots.lot_number UNIQUE`. No N+1; all single-row.

## 3. Per-turn cost on the survivor unchanged by this diff; what repointed callers now inherit
- Redis: ~4-6 extra round trips per turn (cap INCR/EXPIRE, memory LRANGE/RPUSH/LTRIM) - the deleted door touched Redis zero times.
- `CHAT_DAILY_CAP = 100` enforced for non-admin/manager, and the `INCR` sits **before** the clear-context shortcut and before the execute branch, so execute-only turns (no model at all) and clear-context calls also burn quota, and failed calls (403/422) are not refunded.
- **Latency hazard, now concentrated on the only door:** the deleted door opened with `await db.commit()  # release auth tx before long model call`; the survivor does not. `get_db` carries an already-open transaction from `get_staff`'s SELECT, and nothing commits before the model call (180s default client timeout). With pgbouncer in `PGBOUNCER_POOL_MODE=transaction`, pool_size=10/max_overflow=20, and `ALTER ROLE rfo_app SET idle_in_transaction_session_timeout='20s'`, any turn whose model call exceeds 20s pins its connection and can have the auth transaction killed server-side mid-turn. Pre-existing (the spec barred touching staff_ai's existing code), but every repointed caller now takes it. One-line follow-up: restore the deleted door's leading `await db.commit()`.
- Execute turns got cheaper: the action-scoped branch makes zero model calls where the deleted door re-decided with one.

## 4. `rehearse_day.py` - no increase in live model calls
`:91` probe still 401s at the dependency before any handler work. `:505`'s 3 turns make the same 3 `ai_json` calls; worst case +1 `ai_text` per turn when the model returns `action=none` with an empty answer.

## 5. Gate side note (coverage)
The repoints *lower* live model calls by 2, because two legs now send `execute+action+args` and never call the model. Side effect: `test_role_claim_cannot_escalate` no longer exercises the model's role-claim defence at all - flagged for the security/architect lenses (architect raised it as blocking).

No index regression, no new N+1, no added per-turn query, no added model call on the survivor's own chat path.
