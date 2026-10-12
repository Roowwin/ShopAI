# backoffice listing studio J5: split listing editor with AI description drafts (restyle, keep function)

## Context
Job 5, the last of the owner's Midnight Emerald redesign. J1 (dark token layer + chrome, `4b12890`),
J2 (Command Center dashboard, `b78ad59`), J3 (asset workbench slide-over + bulk bar, `7270547`) and J4
(the intake engine, `3abea3f`) are all landed on `phase12-backoffice`. The palette, the
`surface-glass`/`shadow-glow` primitives, `nav.ts`, and J3's panel/selection idioms are in the tree.

READ FIRST: `factory/rounds/job-20261012-214540-3397-round-{1,2,3}/` (J4 — the standard, and the two
rounds where the *fix* was the defect), the memory file
`promoting-a-cosmetic-flag-to-a-guard-creates-a-brick.md`, and the four-dimension notes in
`token-palette-inversion-needs-a-fill-ink-sweep.md`.

**The owner's binding decision for this job, same as J4: restyle and keep function.** This page has a
WORKING AI description draft and a WORKING save-to-product. Both must behave exactly as they do now.
Wrap them; do not replace them.

## What the page actually is (verified before this spec was written — build on it, and correct it if wrong)
`apps/backoffice/app/admin/ai/listings/page.tsx` is one small page: it loads categories, the operator
picks a product, `POST /staff/ai/description-draft` with `{ product_id }` returns
`{ title, description, keywords[] }`, and a separate action saves with
`POST /staff/products/{pid}/listing` posting `{ title, description }`.

Two facts that decide this job's honesty, both already established:
1. **`description-draft` takes only `product_id`.** There is no tone/style/length parameter anywhere
   in the repo (J4's builder grepped the whole backoffice looking for one). The brief's "tone
   switcher" therefore has NO backing.
2. **The save drops `keywords`.** The draft returns them; the save posts title and description only.
   So the page currently displays a field it then discards.

## Deliverable
1. **Verify the grain, then say what it is.** Read the page and the three handlers it calls. Report
   the real shape (what is fetched, what the draft returns, what the save writes, whether the save
   overwrites a live listing) and the master-detail mapping you chose for the split layout. Do not
   invent a shape the API cannot fill — if a briefed panel has no data behind it, say so and render
   the nearest honest thing (J3's and J4's precedent).
2. **The split studio.** Product context on one side, the generated copy on the other, using the
   page's existing data and the app's existing primitives. The two working controls (generate, save)
   keep their request expressions, their guard conditions and their message strings **verbatim**;
   they may be restyled and re-positioned, not re-wired. Every target >= 36px, keyboard operability
   with J3's `e.target !== e.currentTarget` guard on any row that is also a button, `ring-inset`
   where a focus cue sits inside an ancestor's `overflow-hidden` or scroll box.
3. **The tone control — the trap of this job.** It is briefed and it CANNOT work: the endpoint takes
   no tone. Shipping a switcher that changes nothing is this job's version of J2's fabricated
   sparkline — a control that looks functional and is inert. So: either do not render it, or render
   it as an explicit, labelled absence ("the draft endpoint takes no tone parameter, so this control
   is not wired"). Do NOT send a tone to an endpoint that ignores it, and do NOT pretend. Say in the
   report which you chose and why.
4. **`keywords` — do not silently imply they are saved.** The draft returns them and the save drops
   them. Either label them honestly where they are shown (e.g. as not part of what is saved), or stop
   showing them as if they were — and report plainly which, plus whether the save SHOULD carry them
   (an observation for the owner, not a change: you may not add a field to the request).
5. **Nothing else moves.** No route added, no backend change (no new endpoint, no new parameter, no
   migration), the AI wall and the role walls untouched, and J1-J4's surfaces are not edited. No new
   dependency. Motion uses the `duration`/`ease` tokens through CSS TRANSITIONS ONLY, with the
   reduced-motion pair rendering the finished state.

## Acceptance
- **The four-dimension audit, run and reported** (a list per dimension; every NEW fill+ink pair with
  its COMPUTED ratio, 4.5:1 body / 3:1 large and UI; ancestor fills included; literals grep; and the
  framework/UA pair re-checked in the BUILT stylesheet — `color-scheme` and the ring-offset band are
  already correct at this base, so confirm the new markup reinvents neither). A "studio" split view is
  exactly where a nested panel fill hides a failing pair. Any pair under its bar is a stated
  exception or a fix.
- **The complement test** on the built stylesheet: every class selector it emits, minus every token
  written in non-comment code, each remainder accounted for by grepping the BUILT css. A BARE UTILITY
  NOUN in comment prose emits a real dead rule — this phase has now hit it three times (`shadow`,
  `invisible`, `grow`, and J4's own `outline`), so expect it and check the words you write.
- **Build**: `tsc --noEmit && npx next build` green with the REAL exit status (redirect to a file,
  read `$?`, NEVER a `| tail` — a piped tail reported a green build on a TS2304 failure earlier in
  this phase), reported with the route count.
- **Gate**: the exact pytest count after `docker compose build api`. Expect **125 passed / 3
  deselected**, unchanged, since no backend file changes. NOTE: the in-container node ids are
  `tests/…`, not `apps/backend/tests/…` (the api image is `WORKDIR /app`).
- **What can and cannot be verified from outside.** The admin page SHELL is served to an
  unauthenticated request (`https://admin.rfo.localhost/admin/…` returns 200 with the full markup —
  the auth gate is on the `/staff/*` data calls), so the prerendered page at
  `.next/server/app/admin/ai/listings.html` is real evidence that your markup shipped: check your new
  strings there, count them with PYTHON (`grep -c` counts lines, and the RSC flight payload
  duplicates every match). What remains unverifiable without a session: the in-browser render, the
  draft round trip and the save. Say that plainly rather than implying otherwise.
- **The function-preservation statement**: for each of the two existing flows, what you claim and the
  evidence — the request expressions, guards and message strings compared against base, plus a note
  on anything you deliberately changed and why.

## Allowed surfaces
`apps/backoffice/app/admin/ai/**`, `apps/backoffice/app/components/**` (a shared component only if it
is genuinely reused), and `apps/backoffice/app/globals.css` / `apps/backoffice/tailwind.config.ts`
only if a new visual primitive is genuinely needed — say why. Anything else = CHANGES.

## Constraints
- Work only on branch factory/<job-id>; LF/no-BOM (verify the STAGED blob with `git show :<path>` and
  `blob.count(b'\r')`, never `grep -c $'\r'`); gates AFTER `docker compose build api`; never touch
  .env, secrets/, infra/, factory/*. No new dependency, no secrets in code or messages.
- ADR 0006 stands: the save is a real mutation and any confirmation on it stays a human step. If the
  page has no confirmation today, report that as a risk — do not silently add one, and do not remove
  one.
