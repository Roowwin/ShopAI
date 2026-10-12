# backoffice J7: Hyper-Overview on /admin — glass pulse cards, pipeline map, action tiles, donut + stacked bars

## Context
J1-J6 are landed on `phase12-backoffice`. This job follows the owner's "Dashboard 2.0 Hyper-Overview"
brief. **FAST LANE: no architect/security/performance review round will run.** The gates are
`docker compose build api` + `pytest -q` (a backend regression check that has returned 125/3 for every
job this phase) and `tsc --noEmit && npx next build`. Neither exercises a pixel or an interaction of
what you build, so your self-report is the only quality signal for the UI. Write it to be checked.

READ FIRST: `factory/rounds/job-20261012-203438-4770-round-*/` (J2 — it built the Command Center this
brief partly describes, and it discovered the sparkline problem you are about to meet again);
`factory/rounds/job-20261012-225359-3714-round-1/decision.md` (J6 — what fast lane does and does not
cover); the memory files `token-palette-inversion-needs-a-fill-ink-sweep.md` and
`promoting-a-cosmetic-flag-to-a-guard-creates-a-brick.md`.

## Deliverable 1 — establish the grain BEFORE designing (this decides the job)
Read `/admin` (`app/admin/page.tsx`) and the payload it loads (`GET /staff/overview`,
`apps/backend/app/api/v1/staff_overview.py`). Then state in your report:

- **`/admin` is not a data list.** It already renders `StatRow`, `AttentionList`, `AuditFeed` and three
  `Breakdown` **tables**. The three tables are the "data lists" the brief means; the rest is already
  componentised.
- **`/admin/dashboard` already IS a Command Center** (J2): pipeline map, KPI glass cards, attention
  feed. So **do NOT hand-roll a second pipeline map, donut, bar chart or sparkline.** Reuse what is in
  the tree: `app/admin/dashboard/charts.tsx` (`StatusDonut`, `GradeBars`, `Sparkline`),
  `pipeline.tsx`, `kpi.tsx`, `attention.tsx`, and the `app/components/dashboard/*` set
  (`AuditFeed`, `AttentionList`, `StatRow`, `tokens`). If reuse needs a component moved or a prop
  widened, do it and say so — a second implementation of the same widget is the failure mode here.
- **Report the overlap as an owner decision, with a recommendation:** two dashboards with the same
  widgets is a design smell. Say plainly which page you think should own which, and do not resolve it
  by deleting the other page.
- **THE SPARKLINE HAS NO SERIES — again.** The payload carries `stock_value.at_cost_cents`,
  `orders.revenue_paid_cents_30d`, `orders.aov_cents` and `newsletter.total`: all **single figures**.
  The only seven-day value is `revenue_last_7d_cents`, a scalar (and `revenue_7d` as an attention
  threshold). There is no series anywhere in the payload. J2 met this and did the right thing; do the
  same — reuse `Sparkline` with `series={null}` and its existing explicit unavailable state. **Do not
  synthesise a trend line.** This is the briefed element that needs backend data; say so as J2 did.

## Deliverable 2 — Financial Pulse: four glass cards
Revenue (30 days), Stock value (at list), AOV and Newsletter subscribers as four high-contrast glass
cards: `bg-surface-glass` + `backdrop-blur-md`, an emerald hairline, `shadow-glow-sm` rather than a
light-mode shadow. Every figure comes from the payload field it names; no conversion, no rounding you
invented, no "~". Where a denominator is not in the payload (e.g. cost-known vs listed units for the
stock figure), render what is there and label it honestly rather than computing across fields.

## Deliverable 3 — Operational Hub
1. **The visual pipeline map** — Received -> Tested -> Graded -> Listed as connected nodes with glowing
   status bubbles, driven by the payload's OWN counts (`inventory.by_status`, `lots.by_status`). If a
   stage's count is not in the payload, say so in the report and render what is there rather than
   inventing the missing number (J2's precedent). Reuse J2's `pipeline.tsx` rather than redrawing it.
2. **Action Tiles** replacing `AttentionList` for `needs_attention[]`: glowing danger/amber borders and
   a direct CTA. Two rules that are not negotiable:
   - **Every CTA must point at a route that exists.** Verify each destination mechanically against
     `app/admin/**` (`page.tsx` present) — a CTA to a 404 is worse than no CTA.
   - **No CTA may perform a write.** This page's own module comment states it is read-only by
     construction ("A dashboard that also mutates is a dashboard whose every number is one click from
     stale"), and ADR 0006 keeps confirmations human. CTAs navigate; they do not mutate.
   - The real `kind` values include `pricing_pending`, `stuck`, `lots_stuck`, `grade_mix`,
     `category_mix`, `revenue_7d`, `team_activity` and `restock`. Map each to a destination you have
     verified, or leave that tile as a non-link and say which and why. Do not invent a destination that
     sounds plausible.

## Deliverable 4 — the distribution grid
- **Units by grade -> horizontal STACKED progress bars.** Note the brief says *stacked*: check what
  `GradeBars` actually renders before assuming it satisfies this. If it draws separate bars, compose
  the stacked bar honestly from the same `inventory.by_grade` data and say what you changed and why.
- **Units by status -> the visual donut.** Reuse `StatusDonut`.
- **The exact numbers must survive the conversion.** A donut or a stacked bar with unlabelled segments
  loses information the table carried: every segment keeps its count and its label visible (or
  otherwise reachable as text), and the whole-set total stays readable. This is an acceptance item, not
  a nicety — and if a legend/labels are what makes it work, that is a legitimate reason to keep a small
  table alongside rather than losing the numbers.
- `lots.by_status` is not named in the brief. Leave that table as it is, or convert it consistently —
  say which.

## Deliverable 5 — Recent Activity
The `audit_feed` stream becomes a condensed, icon-based feed: hand-rolled inline SVG per entity/action
type, from the REAL feed entries (never invented rows), and it says so when the feed is empty. Restyle
or reuse `AuditFeed` rather than writing a second feed.

## Deliverable 6 — nothing else moves
No backend change (no new endpoint, no new parameter, no migration), no new dependency (hand-rolled
SVG paths — do not add an icon or chart package), the AI wall and role walls untouched, and J1-J6's
surfaces otherwise unedited. `app/components/dashboard/tokens.ts` is the shared tone source — if you
need a new tone, add it there rather than inlining a colour.

## Acceptance
- **The grain statement** from Deliverable 1 first in your report, including the sparkline decision and
  the two-dashboard overlap with your recommendation.
- **Every figure traced to a payload field**, and every CTA destination verified against a real route.
- **Four-dimension colour audit, run and reported** with computed ratios (4.5:1 body / 3:1 large and
  UI): every NEW fill+ink pair, ancestor fills, the literals grep, and the framework/UA ring-offset +
  `color-scheme` read from the BUILT stylesheet. The new risky surfaces here are the glass cards (an
  alpha fill over the page ground — composite it, do not assume) and the glowing borders (a glow is not
  text: audit the tile's words on their own fill).
- **The complement test** on the built stylesheet, both directions. A bare utility noun in comment prose
  emits a real dead rule — this phase has hit it five times (`shadow`, `invisible`, `grow`, `outline`,
  `lowercase`), twice in builders' own prose. Watch the words you write.
- **Build**: `tsc --noEmit && npx next build` with the REAL exit status (redirect to a file, read `$?`;
  never a `| tail` — that reported a green build on a TS2304 failure earlier in this phase), reported
  with the route count (it should be unchanged: this job adds no route).
- **Gate**: the exact pytest count after `docker compose build api`; expect **125 passed / 3
  deselected** (in-container ids are `tests/…`).
- **Prerendered markup**: `/admin` is behind auth for DATA but its shell renders; check your new strings
  in `.next/server/app/admin.html` and count them with PYTHON (`grep -c` counts lines; the RSC flight
  payload duplicates every match).
- **Unverified, plainly**: the in-browser render, the glass/blur rendering, hover and focus behaviour,
  and the charts' appearance are unverified without a session. Say so rather than implying otherwise.

## Allowed surfaces
`apps/backoffice/app/admin/page.tsx`, `apps/backoffice/app/components/dashboard/**`,
`apps/backoffice/app/admin/dashboard/**` (only to widen or move a component for genuine reuse),
`apps/backoffice/app/globals.css` / `tailwind.config.ts` only if a genuinely new primitive is needed —
say why. Anything else = CHANGES.

## Constraints
- Work only on branch factory/<job-id>; LF/no-BOM (verify the STAGED blob with `git show :<path>` and
  `blob.count(b'\r')`; `grep -c $'\r'` is wrong — it expands to an empty pattern and matches every
  line); gates AFTER `docker compose build api`; never touch .env, secrets/, infra/, factory/*.
- Work with relative paths from inside the worktree; do not use `git -C`.
- Do NOT run `docker compose restart backoffice` — the running container serves the MAIN tree.
- ADR 0006: no action is automated, no confirmation added or removed, and this page stays read-only.
