# backoffice: admin shell + hygiene (nav, sign-out, session guard, favicon, TS18048)

## Context
The staff backoffice (`apps/backoffice`, served at `admin.rfo.localhost`) has no working shell. Three concrete defects, all verified:

1. `app/admin/cms/page.tsx` and `app/admin/newsletter/page.tsx` **exist but are unreachable** - neither appears in `app/admin/layout.tsx`.
2. There is **no sign-out control** anywhere except `/admin` home, and no active-link state in the nav.
3. A pre-existing `TS18048` at `app/admin/assistant/page.tsx:125` (`'m.proposal' is possibly 'undefined'`) keeps `npx tsc --noEmit` red - and that is the CI check (`.github/workflows/ci.yml:22-25`), so `next build` cannot pass. `docs/state.md:29,31` records it as a known hygiene item.

This is job 1 of the phase12-backoffice program (dashboard + AI tool-execution rail). It changes no behaviour beyond the above: every later job builds on this shell.

## Deliverable
1. **Fix the type error** at `app/admin/assistant/page.tsx:125`. `m.proposal` is guarded at :124 but the narrowing is lost inside the `setMsgs` closure on :125. Hoist the narrowed value into a `const` before the closure (or use the already-narrowed locals). No behaviour change.
2. **`app/admin/layout.tsx`** - nav gains the two pages that exist but are unlinked: **CMS** and **Newsletter**. Add active-link styling from the current pathname, and a **Sign out** control calling the existing `logout()` in `lib/api.ts` which returns to `/`.
   - Do **not** add links to `/admin/orders`, `/admin/customers` or `/admin/audit` - those pages do not exist yet and would 404. They arrive in a later job.
3. **New `lib/session.ts`** - a `useMe()` hook (GET `/staff/me` via `apiFetch`, redirect to `/` on failure) and a `requireRole(me, roles)` helper. Replace the ad-hoc check at `app/admin/newsletter/page.tsx:38` with it, and add the equivalent gate to `app/admin/cms/page.tsx` (currently ungated). Both doors require `admin`/`manager` on the backend - verified: `staff_ops.py:264,275,290,297,313,335,348` (cms) and `staff_ops.py:375` (newsletter) all carry `require_roles("admin","manager")`.
   - Leave `intake`, `assets` and `assistant` gated only by "authenticated": their actions have mixed role requirements (e.g. `scan-in` allows `admin,manager,warehouse,technician`, `create lot` allows `warehouse`), so a page-level role gate would wrongly hide them. Their doors are already role-gated server-side.
4. **New `app/icon.svg`** - a favicon, in the same spirit as the storefront's mark (the backoffice has none).
5. **New `app/error.tsx`, `app/loading.tsx`, `app/admin/error.tsx`, `app/admin/loading.tsx`** - minimal, house-styled, no new dependencies.

Nothing else. **No new API endpoints, no backend change, no migration.** Allowed surfaces: `apps/backoffice/**` only.

## Acceptance
- **`cd apps/backoffice && npx tsc --noEmit` is GREEN.** This is the job's headline: report the exact command and its output.
  - Note: `apps/backoffice/node_modules` is an empty directory on the host (packages live in the compose named volume `rfo_backoffice_modules`), and this job runs in a **worktree**, which the compose bind-mount does not serve. Run tsc by mounting the worktree over the modules volume, e.g.
    `docker run --rm -v "<worktree>/apps/backoffice:/app" -v rfo_backoffice_modules:/app/node_modules -w /app node:20-alpine sh -c "npx tsc --noEmit"`
- A report table listing **every nav entry** → the page file that serves it → whether it was reachable before. This is how "CMS and Newsletter are now reachable" is evidenced rather than asserted.
- `docker compose build api` then `docker compose run --rm api pytest -q` still green (report the count). Nothing backend changed, so this is a no-regression check, not a new-test check.
- Sign-out verified: it returns to `/`, and a subsequent `/admin` load redirects to `/`.
- Allowed surfaces: `apps/backoffice/**`. Anything outside the backoffice = **CHANGES**.

## Constraints
- Work only on branch `factory/<job-id>` (worktree provided) - LF / no BOM; PS 5.1 write rules
- Run: `docker compose run --rm api pytest -q` (must be green)
- Do NOT touch: `.env`, `secrets/`, `infra/nginx/certs/`, `alembic`, `factory/*`, `apps/backend/**`
- Heads-up: new route directories under `app/` may not be picked up by `next dev` in the container (known bind-mount inotify gap) and may need `docker compose restart backoffice`. Record whether you needed it.
