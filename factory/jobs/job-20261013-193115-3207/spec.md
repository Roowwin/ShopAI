# The Management Suite: Import Center drop, Staff Team manager, System Config

## Context
Read docs/PROJECT_CONTEXT.md standing rules and `factory/jobs/job-20261013-173930-5445/spec.md`
for the house spec voice. Three admin surfaces are in scope. Two of them have NO backend today:

* **Product Import** already exists end to end (`staff_imports.py`; `app/admin/product-import/
  ProductImportPanel.tsx`) but its first step is a bare `<input type="file">`. The brief names a
  **CSV Drop**, and the flow's four stages (Drop -> Column Mapping -> Preview -> Result Report)
  are drawn as three. No server change is needed here.
* **Team** has no API at all. `staff_users` is raw SQL with no ORM model, and the only creation
  path is the CLI `app/bootstrap_staff.py`. `GET /staff/agents` (`staff_agents.py`) is the
  admin-only router to copy for shape.
* **System Config** has no API. `site_settings` holds only the CMS `'home'` key. GST is HARDCODED
  at `store_ops.py:23` (`TAX = {"AU": ("AU_GST", 1000), "NZ": ("NZ_GST", 1500)}`) and pinned by
  `order_tax_lines.rate_bp CHECK (rate_bp IN (1000,1500))` (`0001_initial.py:256`). API keys live
  only in the environment (`services/ai.py:36` reads `AI_CLOUD_ENDPOINT/API_KEY/TEXT_MODEL` via
  `os.getenv`).

Do not rebuild anything that exists: reuse `require_roles`, `services/audit.audit`, `security.
hash_password`, the `Table/Stat/Button/Input/Select/Badge` primitives, `useMe`/`requireRole`,
`apiFetch`, `lib/ui` tones and `lib/format` formatters. The nav taxonomy is `app/components/nav.ts`
ONLY - every entry there must have a page behind it.

## Deliverable

### A. Migration `apps/backend/alembic/versions/0017_management_suite.py` (down_revision `0016_price_intelligence`)
* `app_settings(key TEXT PRIMARY KEY, value JSONB NOT NULL DEFAULT '{}'::jsonb, is_secret BOOLEAN
  NOT NULL DEFAULT false, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by BIGINT)`.
  **`updated_by` carries NO foreign key** - an FK on a "who did it" column breaks the
  `DELETE FROM staff_users WHERE email LIKE 'pytest-%'` teardown and takes the whole gate down.
  Write it bare, like `stock_movements.actor_staff_id`.
* Relax the `order_tax_lines.rate_bp` CHECK from `IN (1000,1500)` to `BETWEEN 0 AND 5000`
  (0-50% in basis points) so a CONFIGURED rate is recordable. Drop by its conventional generated
  name with `IF EXISTS`; downgrade restores the original two-value CHECK.
* Seed the `tax_rates` row with the current defaults (AU 1000 bp, NZ 1500 bp) so the DB is the
  source of truth rather than an empty table with Python fallbacks.
* Idempotent (`IF NOT EXISTS`), reversible, LF/no-BOM. No explicit GRANTs - default privileges are
  wired by `infra/.../01-roles.sh` and every other migration relies on that too.

### B. `apps/backend/app/services/app_settings.py` (new)
The one place that reads and writes `app_settings`.
* `TAX_DEFAULTS` - the two jurisdictions, their `AU_GST`/`NZ_GST` names, labels and default bp,
  matching `store_ops.TAX` so a missing row is not a behaviour change.
* `async def get_tax_rates(db) -> dict` - merges the stored row over `TAX_DEFAULTS`.
* `API_KEY_SPECS` - the named keys the platform understands, each with a label, the env var it
  maps to, what it DRIVES, and whether it is a secret. At minimum the three cloud-AI keys
  (`AI_CLOUD_ENDPOINT`, `AI_CLOUD_API_KEY`, `AI_CLOUD_TEXT_MODEL`) and `PAYMENT_WEBHOOK_SECRET`.
* `async def get_api_keys(db) -> dict`, `async def save_api_keys(db, values, staff_id)`.
* `def apply_api_keys(cfg)` - writes the recognised values into `os.environ` for THIS process, so a
  saved key reaches the code that reads it (`_cloud_text_cfg` reads `os.getenv` per request). It
  sets only the keys present and never clears an unset one.
* `def mask(value)` - `""` when unset, otherwise the last four characters prefixed with a count,
  never the whole secret.

### C. `apps/backend/app/api/v1/staff_admin.py` (new router, `prefix="/staff"`, `tags=["staff-admin"]`)
Register in `app/main.py`. Every route `require_roles("admin")` AND an in-body `_require_admin`
guard, because `staff_ai.chat` dispatches into routers as PLAIN FUNCTION calls and `Depends` never
evaluates there (`staff_ops._require_role` is the precedent). Everything audited.

* `GET /staff/team` - `{total, roles[], members[]}`. Named columns only: id, public_id, email,
  display_name, role, status, totp_enabled, created_at. **Never** a password hash, never
  `totp_secret`. `roles` is the five assignable staff roles.
* `PATCH /staff/team/{member_id}/role` `{role}` - validate against the five; **refuse changing your
  OWN role** (self-demotion locks the caller out mid-session); **refuse demoting the LAST admin**.
  Audited before/after.
* `PATCH /staff/team/{member_id}/status` `{status: active|suspended}` - same self and last-admin
  guards. Suspending a member must also revoke their refresh tokens (a suspended account whose
  refresh cookie still mints access tokens is not suspended).
* `POST /staff/team/{member_id}/password-reset` - mint a fresh random password, store only its
  `hash_password` in `staff_passwords`, **revoke every refresh token for that member**, audit the
  act with the password ABSENT from the audit payload, and return the plaintext exactly once.
  Refuse resetting your own password through this door.

### D. `apps/backend/app/api/v1/staff_admin.py` - the config half
* `GET /staff/settings` - `{tax_rates: {AU:{...},NZ:{...}}, api_keys:[{name,label,drives,secret,
  configured,preview,env_var}], system:{app_env, ai_provider, ai_text_model, ai_vision_model,
  ai_endpoint, payment_provider, public_chat_enabled}, updated_at}`. Secrets are `preview` only -
  the plaintext is never returned by a read.
* `PUT /staff/settings/tax` `{AU?: int, NZ?: int}` - basis points, `ge=0 le=5000`, at least one
  field; audited with before/after.
* `PUT /staff/settings/api-keys` `{keys: {NAME: value}}` - only names in `API_KEY_SPECS`; an empty
  string CLEARS that key; applies via `apply_api_keys`; audited with every value REDACTED (record
  which keys changed, never what they became).
* `store_ops.py` checkout reads the configured rate: `_tax_cents` keeps the half-up arithmetic but
  takes the bp from the loaded rates, and `OrderTaxLine.rate_bp` records the configured value. The
  default path must be byte-identical to today when nothing is configured.

### E. `apps/backend/tests/test_management_suite.py` (new)
Against the live DB, `client` fixture, the `pytest-<uuid>@test.rfo` + `bootstrap` idiom from
`test_staff_read_walls.py`, with a `finally` cleanup. Prove:
* the team list needs admin (401 no credential, 403 for a sales staff token, 200 admin) and leaks
  no hash/secret (assert the serialised body contains no `password_hash`, no `totp_secret`);
* a role change persists and is audited; a self-role-change is refused; demoting the last admin is
  refused (make the caller the only admin, or assert the guard directly);
* a password reset returns a plaintext ONCE that actually logs in, the old password no longer
  does, and no audit row contains the new password;
* suspending revokes the member's refresh tokens;
* a tax-rate change is READ BACK by the settings GET and is USED by checkout - configure AU to
  1250, run a real reserve+checkout, assert the order's tax equals 12.5% and the tax line records
  1250; restore the default in a `finally`;
* an api-key write stores, masks on read, and is redacted in the audit row.

### F. Backoffice
* `app/admin/product-import/ProductImportPanel.tsx` - step 1 becomes a real DRAG-AND-DROP sheet
  target (drag-over paint, drop handoff, keyboard-reachable real `<input type=file>` inside it,
  refusal message for a non-sheet, `busy` shut door), modelled on `app/admin/intake/DropZone.tsx`.
  Draw the brief's four stages explicitly and 1:1: **1 Drop the sheet** / **2 Column mapping**
  (columns matched, columns not used, translations) / **3 Preview** (counts, issues, the row grid)
  / **4 Result report** (the committed summary). Server counts stay server counts.
* `app/admin/team/page.tsx` (new) - the Team page: member table (email, name, role, status, MFA,
  created), a per-row role `<Select>` that PATCHes on change with optimistic update + rollback,
  a suspend/reactivate action, and a "Reset password" action whose one-time password is shown in
  the amber notice with a "shown once" warning. Admin-only via `useMe`/`requireRole`.
* `app/admin/settings/page.tsx` (new) - System Config: tax rates per jurisdiction (percent in,
  basis points to the API), API keys with masked read-only preview and a write field per key
  driving them, and a read-only system block. Admin-only.
* `app/components/nav.ts` - add `/admin/team` and `/admin/settings` to the existing `system`
  group. No new icon (the group already draws one).

## Acceptance
* Gate: `docker compose run --rm api pytest -q` with the accepted 3 deselects, BEFORE and AFTER
  counts reported so a delta is attributable. NO NEW FAILURES.
* Backoffice: `npx tsc --noEmit && npx next build` exits 0 with the new routes in the route list.
  Report the exit code from a NON-piped run - a piped build reports `tail`'s status, not the
  build's.
* The migration applies clean AND downgrades clean (`alembic upgrade head` then `downgrade -1`).
* Report which tree the api image was built from (`docker compose build api` from the worktree).
* Every claim above is backed by a command and its output, not by inspection.

## Constraints
- Work only on branch `factory/<job-id>` (git worktree provided).
- LF / no BOM. Files written by Python or the editor defaults - never Set-Content/Out-File.
- Do NOT touch: `.env`, `secrets/`, `infra/nginx/certs/`, the storefront, or any existing test.
- No new dependencies, frontend or backend.
- The 3 accepted deselects stay deselected; do not "fix" them here.
