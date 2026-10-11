VERDICT: PASS

Job job-20261011-194950-163 (agent identity rail), commit `d864dae`.

## The migration is safe on a live table - measured, not reasoned
`ADD CONSTRAINT ... CHECK` in Postgres validates with a seq-scan of existing rows, **not a table rewrite**. On the
live dev DB (rolled-back transaction): the three-constraint trio committed in ~5 ms total, and the expensive one -
`audit_log` (11,618 rows, 3.0 MB) `ADD CONSTRAINT actor_type` - took **1.30 ms**. `staff_users` (14 rows) 0.46 ms;
`refresh_tokens` (41 rows) 0.41 ms. The lock is ACCESS EXCLUSIVE for the transaction only (~5 ms), so the live
window is negligible. Constraint names/definitions verified from `pg_constraint`: all three now read the full
original list with `'agent'` appended (superset, nothing dropped); `agent_tokens` exists (72 kB) with its pkey, the
UNIQUE `token_hash` and the `staff_id` index.

## `get_agent` - one indexed lookup, zero cost elsewhere
Its query is `WHERE t.id = :i` (PK) joined to `staff_users` on `s.id` (PK), plus one in-process `sha256` +
`hmac.compare_digest` (microseconds). `get_staff` is untouched; `get_agent` resolves only where declared, so routes
that do not use it pay nothing. The added imports are startup-only.

## Routes - no N+1, bounded work
`list` = 1 statement (single JOIN, ordered by PK); `create` = 2 (INSERT..RETURNING id, then UPDATE token_hash - two
round trips because the JWT embeds the DB-assigned id); `rotate` = 2; `revoke` = 1-2. All single-row, no loops, no
per-row queries. `create`/`rotate` write exactly one row; the hash is `hashlib.sha256` and the JWT is local HMAC -
no external call. Agent chat reuses `staff_ai.chat` by direct call, so its cost equals a staff chat.
Minor note (not blocking): `list` has no `LIMIT` - unbounded in SQL, but the table grows only through manual admin
creation, so it stays tiny. No `last_used_at` column, deliberately (avoids a write per auth request).

## Page - cheap, no refetch loop
2 fetches on mount (`useMe` -> `/staff/me`, then the page -> `/staff/agents`); each create/rotate/revoke triggers
exactly one list refetch. Effect deps `[checked, allowed, load]` with `load` a `useCallback([])` - stable, no
re-fire. Buttons disabled while `busy`, so no duplicate writes. Bundle (production build): `/admin/agents` =
**2.23 kB page / 107 kB First Load JS**, identical to the admin-layout baseline; shared chunk 103 kB; build and
type-check green. No bundle regression.

## Environment note
The earlier in-container build overwrote the main tree's `.next` used by `next dev`; the reviewer ran
`docker compose restart backoffice` to restore it. No repo files were edited.
