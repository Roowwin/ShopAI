# backoffice J6: collapsible grouped sidebar + omnichannel hub (design-only preview pages)

## Context
Jobs J1-J5 of the Midnight Emerald redesign are landed on `phase12-backoffice`
(`4b12890`, `b78ad59`, `7270547`, `3abea3f`, `b6b7033`). This job follows the owner's
"Navigation Overhaul & Omnichannel Hub" brief.

READ FIRST: `factory/rounds/job-20261012-222552-9119-round-1/decision.md` (J5's record, which states in
its own words what fast lane does and does not cover), the three J4 round directories, and the memory
files `promoting-a-cosmetic-flag-to-a-guard-creates-a-brick.md` and
`token-palette-inversion-needs-a-fill-ink-sweep.md`.

**THIS JOB RUNS IN FAST LANE: no architect/security/performance review round will run.** The gates
that will be run are `docker compose build api` + `pytest -q` (a BACKEND regression check that has
returned 125/3 for every job this phase) and `tsc --noEmit && npx next build` (which proves only that
it compiles and prerenders). **Neither gate exercises a single pixel or interaction of what you
build.** Your self-report is therefore the only quality signal for the UI — write it as if a reviewer
will read it, because the orchestrator will, and it will check your claims against the artifacts.

## Deliverable 1 — the sidebar, regrouped into collapsible categories (real work, real routes)
`apps/backoffice/app/components/nav.ts` is the ONE taxonomy: `layout.tsx`'s sidebar and
`CommandPalette.tsx` both render it through `flatNav()`. Its file comment states its own rule —
**every entry must have a page behind it** — and a second copy of the list is how the chrome grows a
404. Keep that structure: the grouping change belongs in `nav.ts`, and both surfaces must follow.

1. Replace the six flat groups with the brief's seven categories, using the brief's mapping:
   Command Center (Dashboard); Inventory & Logistics (Lots & Intake, Asset Workbench, AI Listing
   Studio); Commerce (Orders, Customers, Audit); Storefront (CMS, Newsletter); AI Intelligence
   (Assistant, Agents); Omnichannel (eBay Hub, Amazon Hub, FB Marketplace); System (Security).
2. **`Account (User profile)` is named in the brief and has NO page behind it** (`/admin/account`
   does not exist — verified). Do not add a 404 link to the chrome. Omit it and say so in the report.
   Same rule for anything else you cannot map to a real file under `apps/backoffice/app/admin/`.
   The three Omnichannel entries are the exception: this job creates their pages.
3. Each category is a **collapsible disclosure**: an inline SVG icon (hand-rolled `path` data — see
   the constraint on dependencies), a label, and a chevron/twist that reflects state. The active
   route's category is open and its item carries the emerald active treatment — **the active state
   glows emerald**, using the existing `shadow-glow*` primitives, not a raw hue.
4. It must behave: `aria-expanded` on the disclosure, the panel associated with it, keyboard operable
   throughout, Escape where a fly-out is used, and a visible focus cue that is not clipped by any
   ancestor's `overflow-hidden` (this phase has been bitten twice — use `ring-inset` inside a
   scroller). Collapsed/expanded state persists as the sidebar's own collapse already does
   (`localStorage`, read behind try/catch in a mount effect). The icon-only sidebar mode already
   exists (`md:w-14`) — decide and state how groups read in that mode rather than leaving them broken.
5. Motion uses the `duration`/`ease` tokens through CSS transitions only, with the reduced-motion
   pair rendering the finished state.

## Deliverable 2 — the Omnichannel hub: three pages, honestly labelled
Create `/admin/channels/ebay`, `/admin/channels/amazon`, `/admin/channels/facebook`, each an
integration-dashboard-shaped page in the Midnight Emerald language: a connection status, sync metric
cards, a cross-platform status grid, and the "push to all marketplaces" control.

**THE FACT THAT DECIDES THIS JOB'S SHAPE: there is no integration.**
`grep -rniE "ebay|amazon|facebook|marketplace|channel" apps/backend/app` returns **ZERO hits** across
every Python file. There is no integration, no credentials, no channel concept, no per-product channel
state, and no sync job. Every figure and status the brief describes would be invented.

So the required shape is:
- **The default state is the TRUE state**: each page renders **Not connected / not configured** for its
  channel, and says plainly that no integration exists in this build. That is not a defeat — a
  well-designed "not connected" dashboard is exactly what a real integration product ships first.
- **The populated dashboard lives behind an explicit preview toggle**, labelled in the UI as sample
  data (e.g. "Preview the connected state — sample data"). The one-click preview is what makes this
  demo-able; the label is what keeps it honest. A visitor must never be able to mistake the sample
  metrics for live telemetry, and the toggle state must be visible in the page text, not only in a
  button's pressed styling.
- **No invented number may appear as live.** "142 items live" / "Last synced: 2 mins ago" are fine
  ONLY inside the labelled preview. Outside it, render the honest empty state. The cross-platform grid
  (`[Storefront: Live] [eBay: Live] [Amazon: Draft]`) is sample data too — label it, and do not imply
  per-channel state is tracked anywhere, because it is not.
- **The "Push to All Marketplaces" control must not be an inert glowing button.** A control that looks
  live, glows, and does nothing when pressed is the worst thing this job could ship. Make it visibly
  unavailable with the reason stated (no integration is connected), or render it as a named absence —
  and say which you chose.
- Keep any real data real: if you can show anything genuinely true (e.g. this product is live on the
  storefront, from an existing endpoint), label it as what it is and keep it visually distinct from
  the sample region.

## Deliverable 3 — nothing else moves
No backend change (no new endpoint, no new parameter, no migration), no new dependency, the AI wall
and role walls untouched, J1-J5's surfaces otherwise unedited, and every existing nav entry keeps its
`href` and label so no route becomes unreachable from the chrome.

## Acceptance
- **The honesty statement, up front in your report:** exactly which values on the channel pages are
  real, which are sample, and where the UI says so. This is the first thing the orchestrator will
  check against the built HTML.
- **The four-dimension colour audit, run and reported**, with every NEW fill+ink pair's computed ratio
  (4.5:1 body / 3:1 large and UI). New surfaces here are risky in a specific way: a **status dot or
  glow is not text** — audit the status *words* on their fill, not just the indicator, and check the
  pair on the sidebar's own ground as well as the page's. Include ancestor fills, the literals grep,
  and the framework/UA ring-offset + `color-scheme` confirmed in the BUILT stylesheet.
- **The complement test** on the built stylesheet, both directions. A BARE UTILITY NOUN in comment
  prose emits a real dead rule — this phase has hit it four times (`shadow`, `invisible`, `grow`,
  `outline`), twice in builders' own prose. Expect it and check the words you write.
- **Build**: `tsc --noEmit && npx next build` green with the REAL exit status (redirect to a file, read
  `$?`; never a `| tail` — that reported a green build on a TS2304 failure earlier in this phase),
  reported with the route count (it should rise by 3).
- **Gate**: the exact pytest count after `docker compose build api`. Expect **125 passed / 3
  deselected** (in-container ids are `tests/…`, not `apps/backend/tests/…`).
- **Route reachability**: the three new pages and every pre-existing nav entry must have a real
  `page.tsx`; state that you checked it mechanically, not by reading the list.
- **Prerendered markup**: the three new routes are server-rendered — check your strings in
  `.next/server/app/admin/channels/*.html` and count them with PYTHON (`grep -c` counts lines, and the
  RSC flight payload duplicates every match). Also confirm the sidebar's new categories appear in a
  prerendered admin page.
- **What stays unverified**: the in-browser render, the disclosure's interaction, focus behaviour and
  the preview toggle's behaviour are unverified without a session — say so plainly.

## Allowed surfaces
`apps/backoffice/app/admin/channels/**` (new), `apps/backoffice/app/components/nav.ts`, `layout.tsx`
and `CommandPalette.tsx` (the taxonomy's two consumers), a new sidebar component under
`app/components/**`, and `globals.css` / `tailwind.config.ts` only if a genuinely new primitive or
token pair is needed — say why. Anything else = CHANGES.

## Constraints
- Work only on branch factory/<job-id>; LF/no-BOM (verify the STAGED blob with `git show :<path>` and
  `blob.count(b'\r')`, never `grep -c $'\r'`); gates AFTER `docker compose build api`; never touch
  .env, secrets/, infra/, factory/*. No secrets in code or messages.
- **No new dependency.** "Lucide-style inline SVGs" means hand-rolled `path` data in the component —
  the app has no icon package and must not gain one. `package.json` must not change.
- Do NOT run `docker compose restart backoffice` (the running container serves the MAIN tree, so it
  would not show your work). The orchestrator restarts it at landing so the new routes are served.
- ADR 0006: no action is automated and no confirmation is added or removed.
