VERDICT: PASS

Job job-20261011-181836-7704 (consolidate the two staff chat doors). Commit reviewed: 98f99cc.

## 1. No authorisation wall weakened or lost
- The deleted file exposed exactly two doors: `GET /staff/assistant/whoami` and `POST /staff/assistant` (`_snapshot`/`_resolve_*` were module-private). Nothing else imported it.
- The old whoami WAS behind a dependency (`Depends(require_roles("admin","manager","technician","warehouse","sales"))`); the new one is the same guard at `staff_ai.py:298-299`. No downgrade.
- `POST /staff/assistant` is gone (`main.py:10,44-45`). Its function survives on `POST /staff/ai/chat` with the same 5-role guard, plus protections the deleted door lacked: `CHAT_DAILY_CAP` and the fallback-model execute guard. Net strengthening.
- Tests still pin the walls: the read sweep keeps the whoami door and asserts 401 for every entry; `test_zone_walls_hold` still asserts 401 for a customer bearer and for no credential.

## 2. Capability widening - real divergence, PRE-EXISTING, not introduced here
`TOOL_ROLES` (`staff_ai.py:70-79`) and its call sites are untouched by the diff. Most gates match the underlying `staff_ops` doors, but TWO do not:

| chat action | chat `TOOL_ROLES` | underlying `staff_ops` door |
|---|---|---|
| `test` -> `set_status("tested")` | admin, manager, warehouse, **technician** | `staff_ops.py:128` admin, manager, warehouse |
| `list` -> `set_status("listed")` | admin, manager, **sales** | `staff_ops.py:128` admin, manager, warehouse |

**Mechanism:** `staff_ai.py:280,286` calls `staff_ops.set_status(...)` **directly**, so that function's `Depends(require_roles(...))` never evaluates - the effective gate is chat's `TOOL_ROLES`. A technician can therefore drive `received->tested` and a **sales user can list a unit** (making it publicly buyable) through chat while being refused at the direct endpoint.

Both divergences pre-date this job (base `staff_ai.py` is identical apart from whoami; the deleted door had the same `list` mismatch), and `/staff/ai/chat` was already registered and reachable by all five roles - so this diff adds no new attacker capability. It only routes the repointed population onto the survivor. **Escalated to the program as its own required job before the autonomy work**, since an autonomy grant on `list` would inherit the too-permissive allow-list.

## 3. Human-Confirm invariant holds; raw-SQL path gone
- All writes are in the execute branch only; the propose branch contains only reads and memory writes. `execute:false` cannot write.
- The deleted door's `_snapshot` (raw SQL via `get_db` against base tables) and its `_resolve_*` twins are unreachable. The surviving snapshot reads the `ai.*` views via `get_ai_db`. Base-table raw SQL survives only in narrow resolvers - not model context.
- Deliberate semantic change, correctly documented: the deleted door re-decided at execute time; the survivor takes client-supplied `action`+`args`. `execute:true` remains the human Confirm on both. ADR 0006 decision 4's invariant text is untouched (only decision 3's path wording changed).

## 4. Modified tests - no assertion removed, but one is now vacuous
- `test_daily_ops.py` is path-only; both zone-wall loops and the proposal-safety assertions (`type != "executed"`, `after == before`) are intact.
- `test_staff_read_walls.py` is one tuple entry; the sweep body is untouched.
- `test_assistant.py` changed request paths/shapes; assertions identical. `test_assistant_executes_scan_in` is strengthened (execute path now model-free).
- **However:** `test_role_claim_cannot_escalate` now passes on the role gate alone and its message never reaches the model, so the model-resists-role-claim intent is no longer exercised. See the architect verdict, which demonstrates the test can now pass with `TOOL_ROLES` removed - escalated as blocking.

## 5. whoami payload exposure - unchanged in class
`{user, role, can_do, note}` with a static note; identical keys to the deleted route. No internal ids, no tokens. `can_do` widens per the caller's own role and the same role+tool set is already returned by `/staff/ai/status` and `/suggestions`.

Diff hygiene: only allowed surfaces touched; the two byte-identical ADR-0006 duplicates were edited identically and left duplicated, as specified.
