# backoffice: design system (tokens + primitives) and adopt across pages

## Context
The staff backoffice has **no design system**, exactly as the storefront did before its overhaul. Verified:
- `apps/backoffice/tailwind.config.ts` is `{ content: ["./app/**/*.{ts,tsx}"], theme: { extend: {} }, plugins: [] }` - an empty theme.
- `app/globals.css` is the three `@tailwind` directives only. No `:root`, no custom properties, no `@layer`.
- There is **no `components/` directory**. Three class strings are copy-pasted across pages:
  `"bg-slate-900 text-white rounded px-4 py-2"` (intake/security/assets/ai-listings), `"border rounded px-3 py-2"` (login/intake/assets/cms), `"bg-white rounded-xl shadow p-6"` (login/admin/security/intake/assets/ai-listings).
- Accent colours drift per file (slate-900 buttons, emerald-600 in cms, indigo-600 in assistant, amber-100 flashes), and the assistant page alone uses a different card idiom (`rounded-2xl ring-1 ring-slate-200 bg-white shadow-sm`), so the one "designed" page is stylistically inconsistent with the rest.

This job lays the foundation the dashboard (J5), the ops views (J6) and the agent UI (J8) will be built on. It is **presentation only** - no behaviour, no fetch, no copy change.

## Sourcing the primitives
The storefront already has this exact layer on the branch **`storefront-design-system`** (NOT on `phase12-backoffice`, so it will not be in your worktree). Read them from git, do not invent them:
```
git show storefront-design-system:apps/storefront/app/components/ui/Button.tsx
git show storefront-design-system:apps/storefront/app/components/ui/Card.tsx
git show storefront-design-system:apps/storefront/app/components/ui/Badge.tsx
git show storefront-design-system:apps/storefront/app/components/ui/Input.tsx
git show storefront-design-system:apps/storefront/app/components/ui/Heading.tsx
git show storefront-design-system:apps/storefront/app/components/ui/cn.ts
git show storefront-design-system:apps/storefront/app/components/ui/index.ts
git show storefront-design-system:apps/storefront/tailwind.config.ts
git show storefront-design-system:apps/storefront/app/globals.css
```
Mirror that architecture - CSS-variable tokens surfaced through `theme.extend` as `rgb(var(--x) / <alpha-value>)`, primitives as `Record<Variant,string>` maps with a 3-line `cn()` and **no** `class-variance-authority` / `tailwind-merge`, and single-valued props (not `className` overrides) for radius/padding, because without tailwind-merge two utilities for the same property resolve by stylesheet order rather than intent.

## Deliverable
1. **`tailwind.config.ts`** - tokens mirroring the storefront's (`brand`, `ink`, `surface`, `line`, `danger`, `grade.{a-d}`) **plus two admin-only groups** the storefront has no need for: `status.*` (the asset lifecycle: received, tested, in_repair, graded, listed, reserved, sold, shipped, returned, scrapped) and reuse of `grade.*` for the A-D chips. Add `borderRadius.card`/`control`, `fontSize.eyebrow`, `fontFamily.sans`.
   **Widen `content` to `["./app/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"]`** - `lib/ui.ts` (item 4) holds class strings, and this is exactly the trap that shipped a missing grade colour on the storefront.
2. **`app/globals.css`** - the `:root` channel-triple block in `@layer base`, mirroring the storefront's plus the `--status-*` values.
3. **`app/components/ui/`** - copy `cn`, `Button`, `Card`, `Badge`, `Input`, `Heading` from the storefront branch (same APIs; keep the header comment saying they are hand-mirrored and must be kept in sync). **Add two admin-specific primitives**: `Table` (thead/tbody wrappers with consistent row borders and a horizontal-scroll wrapper for narrow viewports) and `Stat` (label / value / optional sub-line) for the dashboard. Skip `ProductCard` and `Eyebrow` unless a page in scope actually needs them - say which you used, one line each.
4. **`lib/ui.ts`** - `status -> tone` and `grade -> tone` class-string maps, so no page re-derives a status colour inline. Plain literals (the widened glob covers it).
5. **Adopt across the pages in scope**: `app/admin/layout.tsx`, `app/admin/security/page.tsx`, `app/admin/intake/page.tsx`, `app/admin/assets/page.tsx`, `app/admin/cms/page.tsx`, `app/admin/ai/listings/page.tsx`, `app/admin/newsletter/page.tsx`, and `app/page.tsx` (login).
   **EXCLUDE `app/admin/page.tsx`** (J5 replaces it wholesale with the dashboard) and **EXCLUDE `app/admin/assistant/page.tsx`** (J8 reworks it). Note both exclusions in your report so it is clear they were deliberate, not missed.
6. **One deliberate divergence from the storefront, and say so in a comment**: the storefront's `Button` base carries `min-h-[44px]` because it is a **touch** surface. The backoffice is a **desktop, pointer-first internal tool**, so use a denser control height (~36px) rather than 44px. Flag it so a reviewer does not read it as inconsistency.

Nothing else. No new route, no behaviour change, no API change, no copy change.

## Acceptance
- `npx tsc --noEmit` **and** `npx next build` both green in the worktree. Since the api/backoffice containers bind-mount the MAIN tree and the host `apps/backoffice/node_modules` is an **empty directory**, run them by mounting your worktree over the populated named volume:
  ```
  docker run --rm -v "<worktree>/apps/backoffice:/app" -v rfo_backoffice_modules:/app/node_modules -w /app node:20-alpine sh -c "npx tsc --noEmit && npx next build"
  ```
  Report the exact command and its output. (A production build matters here: `next build` is what emits the CSS you can actually inspect.)
- **Purge check** (this is the storefront's Grade-D lesson): grep the built CSS for representative token classes and report counts, e.g.
  `Select-String -Path <worktree>/apps/backoffice/.next/static/css/*.css -Pattern 'bg-brand-600|ring-line|bg-status-listed|text-grade-a-ink' -AllMatches`
  A token that appears in your source but not in the built CSS means the glob missed a file.
- **Duplication evidence**: report the before/after count of the three copy-pasted idioms listed in Context, with the grep you used.
- **No page 500s**: every admin route still renders. The pages are auth-gated, so verify the SSR shell returns 200 and shows the page's own heading; the API doors refuse data without a session and that is expected.
- `docker compose build api` + the gate still green (nothing backend changed - this is a no-regression check). Report the count.
- Allowed surfaces: `apps/backoffice/**` only. Anything else = **CHANGES**.

## Constraints
- Work only on branch `factory/<job-id>` (worktree provided) - LF / no BOM; PS 5.1 write rules
- Do NOT touch: `.env`, `secrets/`, `infra/nginx/certs/`, `alembic`, `factory/*`, `apps/backend/**`
- The backoffice runs `next dev` in compose, so a NEW route directory can need `docker compose restart backoffice`; this job adds no route, but record it if you find otherwise.
