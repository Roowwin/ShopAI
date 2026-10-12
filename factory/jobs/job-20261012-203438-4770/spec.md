# backoffice Command Center J2: pipeline map, KPI glass cards with sparklines, attention feed

## Context
Job 2 of the owner's Midnight Emerald redesign. **Job 1 has landed** (merge `4b12890` on
`phase12-backoffice`): the backoffice is dark, and the token layer now carries everything this job
needs - the ground ladder (`surface` cards / `surface-muted` band / `surface-sunken` page), the `ink-*`
text scale, `brand`/`accent`, the `status.*` and `grade.*` triples, `surface-glass`, `shadow-glow` /
`shadow-glow-sm`, and `ink-inverse` for text on a bright fill. The chrome is new too: the taxonomy lives
in `app/components/nav.ts` and the sidebar and the `Cmd/Ctrl+K` palette both render it.

READ FIRST, before writing any code: the memory file
`token-palette-inversion-needs-a-fill-ink-sweep.md`. It records the four dimensions of colour auditing
that J1 needed one review round each to discover (literals that bypass tokens; token values that flip
under a role the page did not mean; fills living on ancestor elements; colour from the framework's base
layer and the user agent), the method (enumerate and COMPUTE every fill+ink pair against the tokens),
and the role rules (`ink-*` is a text scale and must never be a fill; the ground ladder keeps its
direction - `sunken` is the page, because the root layout paints the body with it). This job adds new
surfaces to that palette, which is exactly the situation each of those dimensions was discovered in.
Build against them; do not make the reviewers find them again.

The surfaces this job extends already exist on `/admin/dashboard`: `Stat` tiles, an SVG `StatusDonut`
and `GradeBars` (in `charts.tsx`), and an `alerts` array. This is a restyle-and-extend job, not a
rebuild: the brief's three pieces hang off data the page already fetches.

## Deliverable
1. **The pipeline map.** The four lifecycle stages - Received -> Tested -> Graded -> Listed - as
   connected nodes, driven by the SAME overview payload the page already loads (the donut implies
   per-status counts; use them, do not add an endpoint). A node that holds stock reads emerald; a node
   with a backlog reads as a warning. If a stage's count is not in the payload, say so in the report and
   render what is there rather than inventing the missing number.
2. **KPI glass cards.** The existing `Stat` tiles take the glass treatment - `bg-surface-glass/…` with
   `backdrop-blur-md`, an emerald hairline, and `shadow-glow-sm` rather than a light-mode shadow - and
   the Revenue and Inventory cards carry a mini-sparkline (hand-rolled SVG, the `charts.tsx` precedent;
   no new dependency).
   **The sparkline is the one piece whose data does not exist yet**: the payload carries
   `revenue_last_7d_cents` as a single figure, not a series. Do NOT draw a fabricated trend line - a
   mock that looks like data is the worst outcome here. Either find a real series in the payload, or
   render the card with an explicit "7-day trend not available" state and report it as the one briefed
   element that needs backend data. Say which, plainly.
3. **The attention feed.** The existing `alerts` array becomes a vertical timeline: Critical and
   Warning entries distinguished by the `danger.*` and `accent.*` tokens with a restrained glow, and
   nothing invented - if the array is empty, the feed says so.
4. **Housekeeping that this job inherits:** every colour through a token (no raw Tailwind hue, no
   literal white/black), nothing added that the four-dimension sweep has not been run against.

## Acceptance
- **The four-dimension audit, run by the builder and reported:**
  (a) enumerate every fill+ink pair this job adds and COMPUTE the contrast (4.5:1 body, 3:1 large and UI);
  (b) repeat with each element's ANCESTOR fills - the cards sit on the page and the feed rows may gain a
  hover fill, which is how J1's r3 defect hid;
  (c) grep for literals (`bg-white`, `text-black`, raw hues, `shadow-*` tuned for a light page);
  (d) check the two framework/UA colours: the focus ring's offset band and `color-scheme` are already
  correct at this base - confirm the new markup does not reintroduce a per-element override, and verify
  in the BUILT stylesheet rather than by reasoning.
  Any pair under its bar is a CHANGES unless the report names it as a stated exception.
- **Build**: `tsc --noEmit && npx next build` green, reported with the REAL exit status (redirect to a
  file and read `$?`; never let a `| tail` own it), plus the route count.
- **Gate**: report the exact pytest count after `docker compose build api` - expect **125 passed / 3
  deselected**, unchanged, since this job touches no backend file.
- **Served markup, honestly scoped**: `/admin/dashboard` is behind auth, so an outside check cannot read
  it. Verify what can be verified from outside (that the app serves, and that the built CSS carries any
  new utility) and say plainly which parts of the claim only a browser or a logged-in session can carry.
- No new dependency (`package.json` untouched), no backend change, no other route, no storefront change.

## Allowed surfaces
`apps/backoffice/app/admin/dashboard/**`, `apps/backoffice/app/components/**` (a sparkline or feed
component if it is genuinely shared), `apps/backoffice/app/globals.css` and
`apps/backoffice/tailwind.config.ts` only if a new visual primitive is genuinely needed - and say why.
Anything else = CHANGES.

## Constraints
- Work only on branch factory/<job-id>; LF/no-BOM; gates AFTER `docker compose build api`; never touch
  .env, secrets/, infra/, factory/*.
- The API is read-only for this job: no new endpoint, no new parameter, no migration.