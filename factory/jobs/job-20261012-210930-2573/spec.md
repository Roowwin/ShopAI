# backoffice asset workbench J3: lot slide-over panel and bulk action bar

## Context
Job 3 of the owner's Midnight Emerald redesign. J1 (the dark token layer + chrome) and J2 (the Command
Center dashboard) have both landed; `phase12-backoffice` carries the palette, the `surface-glass` /
`shadow-glow` primitives, the `nav.ts` chrome and a dashboard that shows how this app is now styled.
This job is the brief's item 5: master-detail on the workbench, opening a slide-over from the right,
with a bulk action bar that appears only when rows are selected.

READ FIRST: the memory file `token-palette-inversion-needs-a-fill-ink-sweep.md`, and the J2 round files
(`factory/rounds/job-20261012-203438-4770-round-*/`) for the standard. Two traps have now cost this
phase four review rounds between them and both are cheap to avoid up front:

- **The four dimensions of colour auditing.** (1) literals that bypass tokens; (2) token values that
  flip under a role the page did not mean; (3) fills that live on ANCESTOR elements - a pair can pass on
  a card and fail on a row's hover fill; (4) colour from the framework's base layer and the user agent.
  Enumerate and COMPUTE, in that order, including the composited grounds.
- **The comment trap.** Tailwind's extractor takes whitespace-delimited runs as candidates, so a BARE
  UTILITY NOUN in prose emits a real rule (`shadow`, `invisible` and `grow` each did in J2, while
  `box-shadow`'s hyphen made it one candidate matching nothing). J2's closing test is the one that
  catches all of these by construction, and it is the method required here: take every class selector
  the built stylesheet emits, subtract every token written in non-comment code, and account for each
  remainder - a dead class with no emitter, or an emitter that is prose.

## Deliverable
1. **Verify the grain before building it.** The brief says "the main screen is a table of Lots", but
   `/admin/assets` and `/admin/intake` exist and job 6b's workbench is the assets table; the payloads
   may not carry a lot in the shape the brief assumes. Read the page and the endpoint and state, in the
   report, what the current grain actually is and which master-detail mapping you chose (a lot opening
   its assets, an asset opening its units, or something else the data supports). Do not invent a shape
   the API cannot fill; if the briefed table does not exist, say so and build the nearest honest thing.
2. **The slide-over.** A right-hand panel (`fixed inset-y-0 right-0`, the width the app uses) over the
   workbench, opening from a row and showing that row's detail - the data its master row summarises,
   through the existing endpoints. Keyboard and pointer: Escape closes, a backdrop click closes, an
   explicit close control closes; focus moves into the panel on open and returns to the row that opened
   it, because a panel that strands focus is the failure J1's palette had to be taught. Motion uses the
   app's `duration` / `ease` tokens through CSS TRANSITIONS ONLY - no new dependency, no animation
   library - and the reduced-motion pair makes the panel appear without travel.
3. **The bulk action bar.** A floating toolbar at the panel's foot, rendered ONLY while rows are
   selected (checkbox per row; every target >= 36px, the app's pointer-first control height). The three
   actions the brief names - Bulk Grade A, Set Price, Push to Store - wired to the EXISTING endpoints
   job 6b built. No new endpoint, no new parameter, no migration.
   These are real mutations, so: each action takes an explicit confirm step before it fires (ADR 0006:
   confirm stays human-only), and a partial failure must not read as success - report what the API does
   per item, whether a partial failure is possible, and how the UI says so. An honest error surface is
   an acceptance item, not a nicety.
4. **Nothing else moves**: no route added, no backend change, the AI wall and the role walls untouched,
   and `ui/Stat`, the dashboard and the other ops pages are not touched.

## Acceptance
- **The four-dimension audit, run and reported** (a table or list per dimension, with every fill+ink
  pair's computed ratio, 4.5:1 body / 3:1 large and UI), the complement test for dead rules from the
  built stylesheet, and any pair below its bar named as a stated exception or fixed. The new panel and
  bar are the risky surfaces: a footer bar inside a panel has an ancestor fill, and a selected row's
  fill is a new ground.
- **Build**: `tsc --noEmit && npx next build` green, REAL exit status (redirect to a file, read `$?`,
  never a `| tail`), with the route count.
- **Gate**: report the exact pytest count after `docker compose build api` - expect **125 passed / 3
  deselected**, unchanged, since no backend file changes.
- **What only a browser can carry**: the slide's feel, the transition at both motion settings, and the
  bar's appearance on selection are stated as unverified rather than implied; the workbench is behind
  auth, so no served-markup check can read the panel either.
- **The API honesty statement** from Deliverable 3: per action, what it calls, what a partial failure
  does, and how the reader learns about it.

## Allowed surfaces
`apps/backoffice/app/admin/assets/**`, `apps/backoffice/app/components/**` (a shared panel or selection
component only if it is genuinely reused), and `apps/backoffice/app/globals.css` /
`apps/backoffice/tailwind.config.ts` only if a new visual primitive is genuinely needed - say why.
Anything else = CHANGES.

## Constraints
- Work only on branch factory/<job-id>; LF/no-BOM (verify the bytes); gates AFTER `docker compose build
  api`; never touch .env, secrets/, infra/, factory/*.