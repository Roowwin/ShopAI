# decision job-20261012-222552-9119

MODE: FAST LANE — the owner authorised self-approval on automated gates only (2026-10-12).
**No architect, security or performance round ran for this job.** There are no three-lens verdict
files in this round directory, and this record does not pretend otherwise.

DECISION: APPROVE (on the automated gates below, per the fast-lane authorisation — not as the result
of a review round)

COMMITS: `84c8102` (the split studio) and `8b74726` (a comment-accuracy fix + an empty-keyword state),
branch `factory/job-20261012-222552-9119`.
DIFF: 3 files, all inside the spec's allowed surface —
`apps/backoffice/app/admin/ai/listings/{page,ProductContext,GeneratedCopy}.tsx`. No `package.json`,
no `apps/backend/**`, no `globals.css`, no `tailwind.config.ts`, no other route.

## Gates — re-run by the orchestrator against HEAD, not taken from the builder's report
- `docker compose build api` → **BUILD_API_EXIT=0**
- `pytest -q` with the three deselects → **125 passed, 3 deselected** (PYTEST_EXIT=0)
- `npx tsc --noEmit && npx next build` (worktree mounted over `/app`) → **NEXT_EXIT=0**, 18 routes

## Verified independently by the orchestrator
- **Function preservation:** both handlers' request expressions, guards and message strings are 1/1
  base vs HEAD; the two `apiFetch` calls are verbatim; both button labels and both `disabled`
  expressions are unchanged (`Generate draft`, `Approve &amp; publish`).
- **The two fabrication traps:** the tone control is a named absence ("Tone control — Not drawn, and
  not wired."), and no tone is ever sent; `keywords` are labelled "suggested, not published".
- **Built artifact:** sheet `a53dee089d903018.css` (32,308 B) with `.lowercase`, `.grow`, `.shadow`,
  `.invisible`, `.outline` all absent; prerendered page 16,141 B carrying the new headings, with zero
  `[0-9]+%` matches.

## What this record does NOT cover
The frontend behaviour is covered by the builder's self-audit plus the orchestrator's artifact checks
above, and by nothing else. **The gates exercise neither the draft round trip nor the publish** —
`pytest` is a backend regression check (125/3 in every job this phase) and `next build` proves only
that it compiles and prerenders. The in-browser render, the draft and the publish remain unverified
without an authenticated session.

## Known risks carried, NOT fixed (pre-existing at base; the job's keep-function constraint fences them)
1. **The publish press targets the picker's CURRENT product, not the product the draft was written
   for.** Generate for A, move the picker to B, press publish → B's live title and description are
   overwritten with A's copy, with an audit row asserting it. Two clicks, pre-existing, now stated in
   the panel's own copy. This is the item most worth a follow-up job.
2. Neither handler clears `busy` in a `finally`, so a throw leaves both buttons disabled until reload
   — the same defect family J4 needed two rounds to close. Identical at base.
3. The publish press has no confirmation step. ADR 0006 says a confirmation on a real mutation stays
   a human step; none exists today and this job added none and removed none, per the spec.
