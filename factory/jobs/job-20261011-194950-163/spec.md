# backend+backoffice: agent identity rail (role agent, rotatable print-once token, rotation UI) - implements ADR 0007

## Context
Implements **ADR 0007** (agent identity), which has been design-signed-off but has **zero code**. This delivers the
first three of its five follow-up jobs: the identity class + walls, the `actor_type='agent'` audit capability, and
the backoffice rotation UI. The rehearsal extension and the live walkthrough are the autonomy job's, not this one.

It is also the piece ADR 0008 depends on: its Precondition 3 is this job's role widening, and decision 5's
`actor_type='agent'` marker needs the CHECK change here.

**Scope boundary - read this first.** ADR 0008 authorises autonomy as a *design* and gates *enabling* behind eight
preconditions. This job delivers the identity plumbing only. It must **not** implement the grant-scoped
authorisation branch, the autonomy caps, the audit call-site changes, or any auto-execute path. An agent created
here can authenticate and speak the chat door exactly as a staff token does today - i.e. it can propose, and it can
execute only what a human confirms.

## Verified facts (do not re-derive, and do not guess)
- The Postgres CHECK constraints are auto-named. Verified against the live DB:
  `staff_users_role_check` (admits admin, manager, technician, warehouse, sales),
  `audit_log_actor_type_check` (admits staff, system, customer),
  `refresh_tokens_identity_type_check` (admits staff, customer).
  A wrong name fails the whole migration. Use `DROP CONSTRAINT IF EXISTS <exact name>` and re-`ADD` including
  **every original value plus `agent`** - dropping an original value would silently break existing rows.
- The latest migration is `0009_newsletter` and the DB is at `0009_newsletter`, so this job's migration is
  **`0010_agent_identity`**.
- `agent_tokens` does not exist yet.

## Deliverable

### 1. `apps/backend/alembic/versions/0010_agent_identity.py` (new) - **alembic IS in scope for this job**
The house spec normally forbids `alembic`; this job is the exception, and only for this one new numbered file.
- Widen the three CHECKs above to admit `agent`, preserving every existing value.
- Add `agent_tokens`: `id` (identity), `staff_id` (FK staff_users), `token_hash` (TEXT, UNIQUE, NOT NULL),
  `name` (TEXT, NOT NULL), `scopes` (TEXT[], default empty), `expires_at` (TIMESTAMPTZ, NOT NULL),
  `revoked_at` (TIMESTAMPTZ, NULL), `created_at` (TIMESTAMPTZ, default now()).
- Provide a `downgrade()` that drops the table and restores the three original CHECKs.
- **Apply it and prove it**: run the migration against the dev DB (the `migrate` service is behind the `tools`
  profile), then show the resulting constraint definitions from `pg_constraint` and that `agent_tokens` exists.
  Then confirm the downgrade restores the originals, and re-apply. A migration nobody ran is not delivered.

### 2. Identity + walls (`app/api/v1/deps.py`)
- `get_agent`: decodes a token with `typ == "agent"`, loads the agent identity, requires it active and unrevoked,
  returns it.
- **The wall (ADR 0007 decision 7): agent tokens are a third class valid ONLY on the assistant surface.** Use a
  distinct JWT `typ` - never a staff token carrying `role='agent'`, or `get_staff` would accept it everywhere.
  `get_staff` must keep decoding `typ="staff"` so an agent token is **401 on every `/staff/*` route**.
- Agent tokens must be rejected on the store (`/store/*`) wall too.

### 3. Token lifecycle (`app/api/v1/staff_agents.py`, new) - `require_roles("admin")`
- `GET /staff/agents` - list identities (name, created, expires, revoked, last-used if cheap; never the token).
- `POST /staff/agents` - create, returning the **plaintext token exactly once**. Store only a hash (SHA-256, the
  same treatment `refresh_tokens` uses) - never the plaintext.
- `POST /staff/agents/{id}/rotate` - new token, print-once, old one invalid.
- `POST /staff/agents/{id}/revoke` - sets `revoked_at`; the token stops authenticating immediately.
- Register the router in `app/main.py`.

### 4. Backoffice `app/admin/agents/page.tsx` + a nav link
List / create / rotate / revoke, with a **print-once** affordance that makes plain that the secret is shown once and
cannot be retrieved again. Use the design-system primitives (`Card`, `Table` with its required `label`, `Button`,
`Badge`, `Heading`, `Select`) and `lib/ui.ts` tone maps; guard with `useMe()` + `requireRole(me, ["admin"])` and
fail closed. Add the link to `app/admin/layout.tsx` - and it must resolve (no 404).

### 5. Tests - `apps/backend/tests/test_agent_identity.py` (new)
- **The wall, per route**: an agent token is **401 on every entry in `STAFF_READS`** (import the tuple; do not
  re-list the routes) and on the store routes.
- Create returns a plaintext token that authenticates; the DB stores only a hash (assert the plaintext does not
  appear in the row).
- Rotate invalidates the old token; revoke invalidates the current one.
- A non-admin staff role gets 403 on the agent-management routes.
- The `actor_type='agent'` value is now accepted by the CHECK (insert one audit row with it and read it back).
Add `GET /staff/agents` to `STAFF_READS` (it returns an object; **not** to `READ_WALLS`, whose admin leg asserts
`r.json() == []`).

## Acceptance
- `docker compose build api` then the gate green - report the count before and after, run from the **root tree**
  with the worktree mounted (the api image bakes the main tree and a worktree has no `.env`):
  `MSYS_NO_PATHCONV=1 docker compose run --rm -v "<worktree>/apps/backend:/app" api pytest -q`
- The migration applied, its resulting constraint definitions quoted from `pg_constraint`, downgrade + re-apply
  shown.
- **The wall proven live**: with an agent token, show 401 on a `/staff/*` route and on a `/store/*` route; and
  show the same agent token authenticating on the assistant surface.
- Backoffice `npx tsc --noEmit && npx next build` green (git-bash needs `MSYS_NO_PATHCONV=1`), and every nav link
  resolving.
- **Closed-world check if you write comments in `app/**` or `lib/**`** - a bare utility word in a comment emits a
  real CSS rule (this has cost four findings in this program). Avoid bare `ring`, `hidden`, `inline`, `fixed`,
  `grid`, `block`, `table`, `border`, `shadow`, `rounded` in prose; then strip comments, rebuild, and diff.
- Allowed surfaces: `apps/backend/alembic/versions/0010_agent_identity.py` (new),
  `apps/backend/app/api/v1/{staff_agents.py,deps.py}`, `apps/backend/app/main.py`, `apps/backend/tests/**`,
  `apps/backoffice/app/admin/{agents/page.tsx,layout.tsx}`, `apps/backoffice/app/components/**`. Anything else =
  **CHANGES**.

## Constraints
- Work only on branch `factory/<job-id>` (worktree provided) - LF / no BOM; PS 5.1 write rules
- Do NOT touch: `.env`, `secrets/`, `infra/`, `factory/*`, `apps/storefront/**`,
  `apps/backoffice/app/admin/assistant/page.tsx`, `app/admin/page.tsx`. Do not touch **any migration other than
  your new `0010`**.
- Do **not** build the grant-scoped authorisation branch, autonomy caps, audit call-site changes, or any
  auto-execute path - those are gated by ADR 0008's preconditions and belong to the autonomy job.
- The backoffice runs `next dev`; NEW route directories can need `docker compose restart backoffice` - record it.
