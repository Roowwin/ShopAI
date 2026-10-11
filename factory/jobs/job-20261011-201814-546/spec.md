# backoffice: vertical grouped sidebar nav (main + sub topics) + J6 review cleanups

## Context
The admin nav is a horizontal top bar (`apps/backoffice/app/admin/layout.tsx`), which has now outgrown itself: it
carries Home, Intake, Assets, Orders, Customers, Audit, Assistant, AI Listings, CMS, Newsletter, Security and
Agents, wrapping on a narrow window. The owner wants a **vertical sidebar grouping main topics with their
sub-topics** under them, so the portal reads as sections rather than a list.

This job also carries four small cleanups recorded by the J6 review, because it touches the same files and they
would otherwise be filed and forgotten.

## Deliverable

### 1. The vertical sidebar (`app/admin/layout.tsx`)
Replace the horizontal bar with a **grouped vertical sidebar** beside the content. Exact grouping (the owner's
choice):

| main topic | sub-topics |
|---|---|
| **Overview** | Dashboard (`/admin`) |
| **Catalogue** | Lots & intake (`/admin/intake`) · Assets (`/admin/assets`) |
| **Commerce** | Orders (`/admin/orders`) · Customers (`/admin/customers`) · Audit (`/admin/audit`) |
| **Storefront** | CMS (`/admin/cms`) · Newsletter (`/admin/newsletter`) |
| **AI** | Assistant (`/admin/assistant`) · AI listings (`/admin/ai/listings`) · Agents (`/admin/agents`) |
| **Account** | Security (`/admin/security`) |

Requirements:
- Each main topic is a visible group heading (the `text-eyebrow` kicker style the design system already has, or
  `Heading level="h3"` - pick one and be consistent); sub-topics are links beneath it.
- The current page is marked with the existing active-state rule (`=== href || startsWith(href + "/")`) and
  `aria-current="page"`. Do not regress the active state or the Sign out control.
- The identity (email + role) and **Sign out** move into the sidebar footer; Sign out must keep its
  `try/finally` navigation so a failed POST cannot leave a dead button.
- **Every link must resolve.** All 12 entries must return 200 (not 404) - verify each; `/admin/agents` exists
  only if the agent-identity job has merged, so check it is actually present before linking it and say so.
- **Narrow width must not break**: below `md` the sidebar collapses (a toggle button with a ≥44px target and an
  `aria-expanded`/`aria-label`) or stacks above the content. A sidebar that squeezes the content to nothing at
  375px is a failure.
- Use the design-system primitives and `lib/ui.ts` tones; do not hand-roll class strings. No `className`
  override that fights a primitive's own property (there is no tailwind-merge).

### 2. The four cleanups from the J6 review
1. **`app/admin/assets/[id]/page.tsx` does not disclose its sub-list caps** (movements 50, reservations 50, audit
   20), so a unit with more than 50 movements silently shows 50. The customer page already discloses its
   truncation - make the asset page say so too.
2. **`app/admin/customers/[id]/page.tsx` renders `{c ? c.email : ...}` in its `<h1>` outside the gate block.**
   Not exploitable today (`c` derives from gated `data`), but the placement is the kind that becomes a leak if
   that state is ever seeded another way. Move it inside the gate, or derive it only from data the gate has
   already cleared.
3. **`text-brand-700 hover:underline` is repeated 9 times** across the six ops pages. `lib/ui.ts` is in scope and
   already exports `kickerClass` as precedent: add a `linkClass` there and use it, so the design system's
   "no hand-rolled class strings" rule holds.
4. **A comment in `app/admin/page.tsx` emits a dead `.table` rule.** Tailwind scans source text, so a bare
   utility word in comment prose emits a real CSS rule - this has cost four findings in this program. Reword that
   comment (prose only, no class-shaped or bare-utility spelling). Note the word also legitimately occurs as a
   class and as a literal `<table>` tag, so the emitted rule is incidental rather than newly caused - fix the
   comment anyway, since the rule only persists because every source of it must be removed to drop it.

## Acceptance
- `npx tsc --noEmit && npx next build` green:
  `docker run --rm -v "<worktree>/apps/backoffice:/app" -v rfo_backoffice_modules:/app/node_modules -w /app node:20-alpine sh -c "npx tsc --noEmit && npx next build"`
  (git-bash needs `MSYS_NO_PATHCONV=1` or `-w /app` is mangled into a Windows path.)
- **Every nav entry resolves**: serve the built app (`next start`) and curl all 12 routes plus a control for a
  nonexistent path, reporting the status codes. A control that also returns 200 means the check is vacuous.
- The sidebar group headings and the sub-topic links are present in the served markup, in the order above, with
  `aria-current` on the current page.
- The narrow-width behaviour is shown at markup level (the toggle or the stacking classes are emitted) - say
  plainly that this is not a browser screenshot.
- **Closed-world check**, because this job writes comments in scanned source: strip comments from a copy of
  `app/**` + `lib/**`, rebuild, and diff the emitted rule set against a comment-free build. Report whether the
  `.table` rule is now gone, and whether any new one appeared.
- Gate no-regression: `docker compose build api` + `docker compose run --rm api pytest -q` (nothing backend
  changes). Report the count.
- Allowed surfaces: `apps/backoffice/app/admin/layout.tsx`, `apps/backoffice/app/admin/page.tsx` (its comment
  only), `apps/backoffice/app/admin/{assets,customers}/[id]/page.tsx`, `apps/backoffice/lib/ui.ts`,
  `apps/backoffice/app/components/**`. Anything else = **CHANGES**.

## Constraints
- Work only on branch `factory/<job-id>` (worktree provided) - LF / no BOM; PS 5.1 write rules
- Do NOT touch: `.env`, `secrets/`, `infra/`, `alembic`, `factory/*`, `apps/backend/**`, `apps/storefront/**`,
  `apps/backoffice/app/admin/assistant/page.tsx`
- Do not change any page's data fetching, guard or copy - this is navigation and the four cleanups.
- The backoffice runs `next dev`; this job adds no new route directory, so a restart should not be needed -
  except that the container serves the main tree, so verify against a build from your worktree.
