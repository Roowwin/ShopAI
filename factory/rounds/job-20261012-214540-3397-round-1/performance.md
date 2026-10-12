VERDICT: CHANGES

Reviewed the exact diff `git -C <worktree> diff 7270547..HEAD` = 4 code files + spec (AiReview.tsx 149 L,
DropZone.tsx 106 L, ValidationStream.tsx 94 L, page.tsx 287 L; 636 L total). Numbers below are from the
built artifact in the worktree, not from the builder's report.

## Verified clean (measured, not assumed)

- **The 200-line cap IS bounded, and enforced at every write path — because there is exactly one.**
  `EVENT_CAP = 200` literal at page.tsx:36; reducer at page.tsx:71-74 (`next.slice(next.length - EVENT_CAP)`).
  `grep -n "setEvents" *.tsx` returns only two lines: the `useState` declaration (page.tsx:59) and the slice
  (page.tsx:71). No other component, handler or effect touches `events`. Max retained = 200 records.
- **No timer, no forever loop.** `grep -n "setInterval|setTimeout|requestAnimationFrame" *.tsx` → one hit,
  AiReview.tsx:55, a `requestAnimationFrame` that is cancelled in the effect's cleanup (AiReview.tsx:56).
  There is no interval at all, so nothing "runs forever regardless of whether a call is in flight".
- **No listener to leak.** `addEventListener` appears zero times in all four files; the drop
  handlers are React props (`onDragOver`/`onDragLeave`/`onDrop`, DropZone.tsx:61-63), removed with the node.
- **The object URL is NOT re-created per render and does not leak.** One creation site only:
  page.tsx:84 inside `keepPhoto`. Revoked on replace (page.tsx:83) and on unmount (page.tsx:80, `[]` deps).
  The URL lives in a ref + state, never in the render body, so no flicker and no per-render alloc.
- **Effect dependency arrays are correct, none re-subscribes per render.** `[draft]` (AiReview.tsx:57),
  `[events.length, pending]` (ValidationStream.tsx:55), `[load]` (page.tsx:93) with `load` = `useCallback([])`
  (page.tsx:89-92), unmount revoke `[]` (page.tsx:80). The mount fetch therefore fires **once** — no
  fetch-on-a-loop, which is the classic bug here and it is absent.
- **No implicit retry / no duplicated request from the client stack.** `lib/api.ts apiFetch` replays a request
  at most once, only on 401 after `/staff/auth/refresh` succeeds; there is no retry loop and `cache: "no-store"`
  is pre-existing. Each of the three handlers awaits exactly one `apiFetch`.
- **Re-render cost is bounded and trivial at this scale.** An append calls `setEvents` on the page component,
  so the whole page subtree re-renders (nothing is `React.memo`'d). Worst case per render ≈ 200 log `<li>` +
  ≤50 lot rows (`/staff/lots?limit=50`, page.tsx:90) + the review panel. No measured concern; noted so the
  absence of memoisation is a deliberate reading, not an oversight. `raw` (page.tsx:175-180) is rebuilt per
  render but no child is memoised, so the new array identity costs nothing.
- **Payload/bundle is sane; no new dependency.** All four files import only `@/lib/api`,
  `@/app/components/ui`, `@/lib/ui`. `git diff --name-only 7270547..HEAD` contains no `package.json` /
  lockfile. Route chunk `.next/static/chunks/app/admin/intake/page-8bbe14b8e97ab127.js` = 21,269 B, in line
  with siblings (`/admin/assets` 26,060 B, `/admin/dashboard` 15,120 B + 6,734 B). First-load total from
  `.next/app-build-manifest.json` = 372,182 B across 5 chunks, mid-pack vs `/admin/assets` 376,973 B and
  `/admin/dashboard` 372,767 B — and 366 kB of that is the two shared React/Next chunks (173,019 +
  173,933) that **every** route loads, including `/_not-found`. No large dependency signature
  (`lodash|moment|chart|recharts|d3|axios|swr`) in the route chunk: 0 matches. CSS 32,160 B / 453 rules.
- **No layout-thrashing classes added.** The new paint is `transition-colors` / `transition-opacity`
  (DropZone.tsx:66, AiReview.tsx:114), both compositor/paint-cheap; no `transition-all`, no width/height
  animation. The scroll box is a fixed `max-h-72` (ValidationStream.tsx:67) — it cannot grow the page.

## Findings

**F1 — the AI path's new `busy` state is advisory, not a guard: a second photo during an in-flight draft
runs a concurrent request and can pair a mismatched photo with a mismatched draft.**
`file:line` — DropZone.tsx:80-91 (the `<input type="file">` carries no `disabled`), DropZone.tsx:35-40
(`take()` has no busy check, and the drop handler at :52-56 calls it unconditionally), DropZone.tsx:25/30/71
(`busy` is received and used **only** for the heading string), page.tsx:137-157 (`aiDraft` has no
re-entrancy guard; :138 `setDraft(null)`, :155-156 clear `pending`/`aiBusy` unconditionally after the await).
Evidence: `grep -n "disabled" apps/backoffice/app/admin/intake/*.tsx` → **no matches (exit 1)** across all
four files; `grep -n "busy"` → only DropZone.tsx:25, :30, :71 (text) and page.tsx:197 (the prop pass).
Observable: drop photo B while photo A is still being read. Both requests are in flight; whichever *returns*
last wins `draft`, so the AI review panel can render `photo.url` = B (AiReview.tsx:74-79) beside
`draft.brand/model/serial_visible` = A (AiReview.tsx:120-139) — two sides of a panel whose stated contract
(AiReview.tsx:7-21) is "both sides are the record itself". Worse, the first completion clears `pending`
while the second is still out, so ValidationStream shows no "waiting on" marker (ValidationStream.tsx:81-86)
and DropZone stops saying "Reading the photo...", while a call is genuinely in flight. `Prefill scan-in`
(AiReview.tsx:138) then writes A's `serial_visible` into the scan-in field (page.tsx:168) while the operator
is looking at photo B — a wrong serial heading into a real scan-in.
This is a pre-existing hole (base `aiDraft` at 7270547 also had no guard and the file input was never
disabled — see `git show 7270547:apps/backoffice/app/admin/intake/page.tsx`), but this job is what ADDED the
`busy` state, plumbed it into the child that could enforce it, and added the side-by-side panel that makes a
mismatched pair read as one record. Fix is inside the job's own allowed surfaces and does not change any
flow's behaviour: early-return in `take()` when `busy` (and/or `disabled={busy}` on the input at
DropZone.tsx:80-91), plus a re-entrancy guard in `aiDraft`.

**F2 — the auto-follow tail silently stops following at exactly the line where it starts to matter: the
scroll effect depends on `events.length`, which the cap clamps.**
`file:line` — ValidationStream.tsx:52-55 (`}, [events.length, pending]`) against page.tsx:36 (`EVENT_CAP = 200`)
and page.tsx:71-74 (the slice keeps `length` at 200).
Evidence/observable — a simulation of the exact reducer + the exact dep check (`node`, 205 synthetic appends)
prints:
```
append 200: length=200 depChanged=true  tailSeq=200
append 201: length=200 depChanged=false tailSeq=201
append 205: length=200 depChanged=false tailSeq=205
scroll-effect fires over 205 appends: 200 of 205
```
So from the 201st record on, the dependency never changes on an append; the panel appends the newest line
but does not scroll to it. It is masked whenever the same render also changes `pending` (e.g. the
setPending(null) + log pair in `createLot`/`scanIn`), and visible on the pure-log appends that leave
`pending` untouched — `onSheet` (page.tsx:161-163), the two pre-flight refusals (page.tsx:116-117) — and on
`log("AI", "Draft back: ...")` when no `pending` flip lands in the same batch. Dep on the last event's
identity instead, e.g. `events[events.length - 1]?.seq` or an append counter, which is what the module
already carries for exactly this purpose (page.tsx:62,70 `seq`).

## Residual risk (stated, NOT required — pre-existing, and outside this job's "keep function" mandate)

- `Scan` (page.tsx:242) and `Create lot` (page.tsx:228) have the same unguarded-button wiring, so a second
  press while a request is out issues a duplicate `POST /staff/assets/scan-in` or a second `POST /staff/lots`
  (the latter creates a second lot). Base has identical wiring — `git show
  7270547:.../page.tsx | grep -n "Button"` shows no `disabled` — so this job neither introduced nor worsened
  it; flagging it for the architect rather than requiring it here.
- If `apiFetch` throws (its 401 path does `location.href = "/"`), page.tsx:155-156 are skipped and `pending`/
  `aiBusy` stay set. The base had the same no-`finally` shape for `aiBusy`; the throw path navigates away,
  so the stuck state is not reachable on screen. Noted for completeness, not a blocker.

## Scope note

I edited no file other than this verdict. I did not run docker; all artifact sizes are from the existing
build output in the worktree, and the first-load comparison is computed from
`.next/app-build-manifest.json` of that same build so the routes are apples-to-apples.
