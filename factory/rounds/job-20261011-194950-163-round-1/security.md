VERDICT: CHANGES

Job job-20261011-194950-163 (agent identity rail), commit `d864dae` reviewed from a pristine `git archive HEAD`
copy, because the worktree was being edited concurrently while this review ran.

## BLOCKING - the agent door is NOT propose-only; an agent performs autonomous writes
`agent_chat` delegates `staff={"id": agent["staff_id"], "role": agent["role"]}` - the **sponsor's** role - and
`create_agent` binds `staff_id` to the **creating admin's own id** (`INSERT ... staff_id = staff["id"]`, no sponsor
parameter). Every `TOOL_ROLES` tuple contains `admin`, so every agent carries the full admin tool set, `list` and
`price` included. An agent can supply `execute=true` itself, and no server-side confirm exists - so the file's own
"a write still needs the human Confirm" is false for a machine credential.

**Proven live against pristine HEAD:** an agent token, **with no prior proposal**, POSTed
`{execute:true, action:"create_lot", args:{warehouse:"ZZ-PROBE-..."}}` ->
`200 {"type":"executed","action":"create_lot","results":[{"lot_number":"LOT-2026-01402","lot_id":1430}]}` - the lot
row really landed. `grade` on a nonexistent serial returns 422 (not 403), i.e. it passes both the role gate and the
`_FALLBACK_PROPOSAL` gate.

Secondary to the same cause: **the agent door has no role allow-list at all** (no `require_roles`), unlike
`/staff/ai/chat`. Effective reach is whatever the sponsor holds; and since the sponsor is always the creating admin,
an agent is *stronger* than a least-privilege staff token and **cannot be created least-privilege**.

The in-flight (uncommitted) worktree already contains the fix - 403 propose-only + an `AGENT_ROLE` - which matches
the architect's REQUIRED 1. Committed and proven, this clears.

## The wall - PASS, exhaustively
Enumerated every documented path/method from `app.openapi()` (**61 route-method pairs**) and ran a **differential**
sweep: anonymous vs agent vs customer vs staff.
- Agent vs anonymous differ on **exactly one** route: `POST /staff/agents/chat` (agent 200, anon 401) - the intended
  door. Every other pair is identical, so an agent bearer confers **nothing** an anonymous caller lacks.
- All 42 `/staff/*` pairs are **401** to an agent bearer, including `POST /staff/ai/chat` and all `staff_ops`.
- `/store/*`: authenticated routes 401; the 200s are the public storefront and return 200 to no credential at all.
  `/store/checkout` is *stricter* for an agent (401) than for anonymous (422).
- Mirror direction: a staff token on `/staff/agents/chat` -> **401**; forged `customer`/`store`/`mfa_challenge` typ
  and a hand-minted `staff`-typ-with-`role="agent"` JWT -> all 401. `get_agent` is called by exactly one route, so
  there is no second door.

## PASS
- **Token secrecy**: `token_hash` is `sha256(token).hexdigest()` (verified equal; the plaintext appears nowhere in
  the row). Plaintext leaves only in the create/rotate responses; the insert's temporary placeholder is overwritten
  in the same transaction, so no plaintext ever reaches the DB. `GET /staff/agents` selects named columns only -
  response keys are `active, created_at, email, expires_at, id, name, revoked_at, scopes`. Hash compare is
  `hmac.compare_digest`, appropriate for a signed high-entropy JWT (no brute-force surface).
- **CHECKs**: verified live from `pg_constraint`; exactly one constraint each, no stale duplicates; every original
  value survives in all three; `agent_tokens` has the columns/FK/UNIQUE/index specified.
- **Lifecycle**: rotate invalidates the old token immediately with the stored hash changing (no grace window, no
  caching - `get_agent` re-reads per request); revoke is sticky (rotate on a revoked identity -> 409); expired row
  -> 401 even for a JWT-valid token (row expiry is authoritative); deactivating the sponsor -> 401; deleting the row
  -> 401. No window found.
- **Creation admin-only**: create/rotate/revoke all `require_roles("admin")`; sales -> 403 on all four; agent token
  -> 401. No self-service path.
- **Scope discipline**: no grant branch, no autonomy caps, no audit call-site changes. `scopes` is stored and read
  but never enforced (reserved, as specified).

## Residuals (non-blocking, recorded)
1. **Agent chat memory, the daily cap and `_FALLBACK_PROPOSAL` are keyed on the SPONSOR's staff id.** Proven: a
   human turn took the admin's `turns` 0->1, then an agent turn took it 1->2 - so a machine identity reads and
   writes the sponsor's conversation memory and can inject text into the human's assistant context. Same bucket for
   the quota, and `privileged` comes from the sponsor's role, so an admin-sponsored agent is cap-exempt. ADR 0008's
   territory.
2. **Rotate resets to a fixed 90-day TTL**, discarding the identity's original `ttl_days` (created with 3 days ->
   rotated to 89).
3. Audit attribution: an agent-executed write logs `actor_type='staff'` with the sponsor's id - indistinguishable
   from the admin's own action.
4. Edge: `^/staff/agents/chat$` inherits the generic block's 25m cap and 60s timeout (already being fixed).
5. `staff_users.role` now admits `'agent'`; nothing inserts such a row, but a future admin UI taking a role from a
   dropdown could mint a staff-class token carrying `role='agent'` - the exact anti-pattern the spec warns about.
6. Worktree hygiene at review time: 4 files modified but **uncommitted** on the branch.

## Environment caveat for whoever reads a gate result
Concurrent gate runs sabotage each other: every suite's cleanup deletes `staff_users WHERE email LIKE 'pytest-%'`,
so two overlapping runs produce a moving set of unrelated failures (8, then 5+1 error, then clean observed). A clean
worktree run was **58 passed / 0 deselected**, a later clean run **61**. Do not read a red gate while a second run
is in flight.
