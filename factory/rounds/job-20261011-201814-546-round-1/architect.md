VERDICT: PASS

Reviewed `727a0b5` (5 files, all within the allowed surfaces). I rebuilt the job branch in docker from an isolated
temp copy mounting the `rfo_backoffice_modules` volume (repo untouched) and served it, so the claims below are
measured, not read.

1. Sidebar - correct. `layout.tsx:37-54` defines `GROUPS` with exactly six groups / 12 items in the owner's order;
   every heading uses the same primitive (`<p className={cn(kickerClass, "px-2 pb-1")}>`) so it is one consistent
   style. Served HTML confirms order Overview / Catalogue / Commerce / Storefront / AI / Account and the twelve
   labels in order. No empty group. All 12 routes return 200; control `/admin/does-not-exist-xyz` returns 404
   (non-vacuous). `/admin/agents` is present (agent-identity merged).

2. Active state / Sign out - holds. Rule `pathname === l.href || pathname.startsWith(l.href + "/")` + `aria-current`
   preserved verbatim; Sign out keeps `try/finally { router.replace("/") }`.

3. Narrow width - usable at 375px. Toggle emits `min-h-[44px] min-w-[44px]` +
   `aria-expanded`/`aria-controls="admin-nav"`/`aria-label`; nav is `hidden` by default and `md:flex` at >=md, so the
   content column takes full width instead of being squeezed. Markup-level judgement, not a screenshot.

4. Cleanups. (a) assets page discloses 50/50/20 caps; constants match the API exactly (`staff_views.py:294-311`
   LIMIT 50/50/20). (b) `customers/[id]/page.tsx:66,70` - `<h1>` email derives from `cleared`
   (checked && allowed && c && data), not `c` alone. (c) `linkClass` at `lib/ui.ts:82`, used at the three in-scope
   sites. (d) `app/admin/page.tsx` comment is prose now; no lowercase `table` token remains there.

5. No behaviour change. The two touched pages differ only by className swaps, the caps constants/notes and the
   `cleared` gate - no fetch, guard or copy change beyond the nav. `tsc --noEmit` exit 0; `next build` exit 0.

Carried (not blockers, but real):
- `linkClass` is only 3 of 9. Six hand-rolled `text-brand-700 hover:underline` sites remain: assets/page.tsx:72,
  customers/page.tsx:85, orders/page.tsx:144, orders/[id]/page.tsx:58,83,101 - all in files the spec's Allowed
  surfaces exclude ("Anything else = CHANGES"). The partial is the spec-compliant outcome and the worker documented
  the gap in its own ui.ts comment. Read literally, item 4(c) ("confirm none remain") fails, and the design-system
  "no hand-rolled class strings" rule does not yet fully hold. Widen surfaces in a follow-up to close it.
- The dead `.table` rule is NOT gone: the rebuilt CSS still contains `.table{display:table}`. Cause is two
  out-of-scope prose sites, not page.tsx: audit/page.tsx:13 ("the audit table is append-only") and
  orders/page.tsx:88 ("the dashboard's table uses"). The spec anticipated this - the rule drops only when every
  source is removed.
- Dashboard is `aria-current="page"` on every admin route: href `/admin` + the prefix rule matches `/admin/...`, so
  `/admin/orders` serves TWO aria-current="page" (Dashboard + Orders). This is the pre-existing rule faithfully
  preserved (not a regression), but a genuine defect the mandated rule causes.
- Minor: the audit cap note renders in a bare `<div>` outside the AuditFeed Card while the movements/reservations
  notes sit inside theirs; the layout now calls `useMe()` so each admin page issues a second `/staff/me` (pages
  already call it - not a page-fetch change); sub-topic links are 36px targets (spec only required >=44px for the
  toggle, so compliant); `Button`'s `onDark` variant is now unused (out of scope, documented).

Key files: apps/backoffice/app/admin/layout.tsx, apps/backoffice/app/admin/assets/[id]/page.tsx,
apps/backoffice/app/admin/customers/[id]/page.tsx, apps/backoffice/app/admin/page.tsx, apps/backoffice/lib/ui.ts,
apps/backend/app/api/v1/staff_views.py.
