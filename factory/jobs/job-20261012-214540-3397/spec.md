# backoffice intake engine J4: drop zone, live validation stream, side-by-side AI review

## Context
Job 4 of the owner's Midnight Emerald redesign. J1 (dark token layer + chrome), J2 (the Command Center
dashboard) and J3 (the asset workbench slide-over + bulk bar) have landed; `phase12-backoffice` carries
the palette, the `surface-glass` / `shadow-glow` primitives, `nav.ts`, and the panel/selection
precedents J3 wrote. This is the brief's "Bulk Intake Engine".

READ FIRST: the memory file `token-palette-inversion-needs-a-fill-ink-sweep.md`, and the round files of
J2 and J3 (`factory/rounds/job-20261012-203438-4770-round-*/`,
`factory/rounds/job-20261012-210930-2573-round-*/`) for the standard. The four-dimension audit and the
complement test are acceptance items below, not advice - J1 took six rounds and J2 three to learn what
J3 was handed up front and what this job is handed the same way.

**The owner's binding decision for this job: restyle and keep function.** `/admin/intake` is a REAL
surface with a WORKING AI scan-in and WORKING description drafts. Those flows must keep working
exactly as they do now; this job wraps them in the new visual language and adds the briefed elements
around them as enhancements. Replacement is the failure mode.

## Deliverable
1. **Verify the grain before building it.** Read `/admin/intake`'s page and the endpoints it calls, and
   state in the report: what the page actually does today (which input it takes, what the scan-in
   returns, where a draft is written), and which briefed element each existing flow already satisfies.
   Then state which briefed elements have NO backing and say so plainly - do not build a shape the
   code cannot fill. This is the J3 precedent: report the real grain, then build the nearest honest
   thing.
2. **The drop zone.** The brief's cloud-upload zone, styled in the new language, driving the intake
   path that EXISTS. **The one trap here is the same one J2's sparkline was:** the brief assumes an
   XLSX/CSV parser, and no parser is in this repo. A drop target that swallows a file and then silently
   does nothing - or worse, renders a plausible row table from a file it never read - is a mock that
   looks like data and is the worst outcome in the brief. Either wire it to something real, or render
   an explicit "spreadsheet parsing is not wired yet - drop a photo to scan instead" state and report
   it as the one briefed element that needs backend work. Say which, plainly, in the report. The
   existing scan-in entry point must remain reachable and unchanged in behaviour.
3. **The live validation stream.** A terminal-style log of `[INFO]` / `[AI]` / `[WARN]` lines beside
   the intake flow. It is fed by REAL events from the flow that exists (the scan-in request lifecycle -
   started, what came back, what failed). If the flow only exposes one or two real events, the stream
   carries exactly those and says what it is waiting on; do NOT synthesise a fake "Analyzing SKU...
   47%" progression. A stream that invents its own lines is the same defect as a fabricated sparkline.
4. **The side-by-side AI review.** Raw input on one side, the AI-enhanced product card on the other,
   for the record the scan-in actually produced - with the existing draft/tone control wrapped rather
   than replaced. **The AI wall is untouched:** no new AI call, no new endpoint, no change to what the
   scan-in sends or where a draft is written. If a briefed column (the raw spreadsheet rows) has no
   data behind it, render the honest empty/label state and report it - do not fill it with invented
   rows.
5. **Nothing else moves**: no route added, no backend change (no new endpoint, no new parameter, no
   migration), the AI wall and the role walls untouched, and J1-J3's surfaces are not edited. Motion
   uses the `duration` / `ease` tokens through CSS TRANSITIONS ONLY - no new dependency, and the
   reduced-motion pair must still render the finished state.

## Acceptance
- **The four-dimension audit, run by the builder and reported** - a table or list per dimension:
  (a) enumerate every fill+ink pair this job adds and COMPUTE the ratio (4.5:1 body, 3:1 large and UI);
  (b) repeat with each element's ANCESTOR fills - the validation stream's log lines and the AI review
  columns are new grounds, and a "terminal" surface is exactly where a nested panel fill hides;
  (c) grep for literals and raw hues;
  (d) the framework/UA colours: `color-scheme` is already dark at this base and the ring-offset band is
  already fixed on `*, ::before, ::after` - confirm the new markup reinvents NEITHER, and verify in the
  BUILT stylesheet, never by reasoning. Any pair under its bar is a stated exception or a fix, and a
  comment quoting a ratio must be re-read against the new values.
- **The complement test** on the built stylesheet: every class selector it emits, minus every token
  written in non-comment code, with each remainder accounted for. A BARE UTILITY NOUN in comment prose
  emits a real rule (`shadow`, `invisible`, `grow` each did in J2); `box-shadow`'s hyphen made it one
  candidate matching nothing. Verify by grepping the built CSS for the emitted selector, not the source.
- **Build**: `tsc --noEmit && npx next build` green with the REAL exit status (redirect to a file, read
  `$?`, never a `| tail` - a piped tail reported a green build on a TS2304 failure earlier in this
  phase), reported with the route count.
- **Gate**: the exact pytest count after `docker compose build api` - expect **125 passed / 3
  deselected**, unchanged, since no backend file changes.
- **The function-preservation statement**: for each flow that existed before this job (scan-in, draft),
  what the report claims about it, and the evidence - `/admin/intake` is behind auth, so a served-markup
  check cannot read it; state plainly that the in-browser render and the scan-in round-trip are
  unverified by this gate rather than implying otherwise.
- No new dependency (`package.json` untouched), no backend change, no other route, no storefront change.

## Allowed surfaces
`apps/backoffice/app/admin/intake/**`, `apps/backoffice/app/components/**` (a shared stream/panel
component only if it is genuinely reused), and `apps/backoffice/app/globals.css` /
`apps/backoffice/tailwind.config.ts` only if a new visual primitive is genuinely needed - say why.
Anything else = CHANGES.

## Constraints
- Work only on branch factory/<job-id>; LF/no-BOM (verify the bytes with `blob.count(b'\r')` on the
  staged blob, not `grep -c $'\r'`); gates AFTER `docker compose build api`; never touch .env,
  secrets/, infra/, factory/*. No new dependency, no secrets in code or messages.
- ADR 0006 stands: any confirmation on a real mutation stays a human step.
