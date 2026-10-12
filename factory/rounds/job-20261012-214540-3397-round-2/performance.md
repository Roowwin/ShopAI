VERDICT: PASS

Round-2 rework reviewed as `git -C <worktree> diff e7735ba..49cbea7` (132 insertions / 39 deletions across the
same 4 files; the job diff 7270547..HEAD is unchanged at 5 files). Both inherited findings are closed by my own
simulation of the exact code, not by the builder's report; nothing new is added that this deployment can reach.
One residual risk (R1) is stated in full below — it is the only path where the new door does not reopen, and it
needs a 2xx response whose body is not JSON, which no component of this stack produces.

## F2 — CLOSED. Re-verified by simulation over 205 and 1000 appends

- Dep expression is now `const tail = events.length > 0 ? events[events.length - 1].seq : -1;`
  (ValidationStream.tsx:60) with the effect dep `[tail, pending]` (ValidationStream.tsx:64). `EVENT_CAP = 200`
  is still the literal at page.tsx:36; the only retention rule is `next.slice(next.length - EVENT_CAP)`
  (page.tsx:84).
- I transcribed the reducer and the dep check verbatim and ran 205 appends (separate renders). Output:
  `append 1: len=1 tail=1 (prevTail=-1) depChanged=true` / `append 200: len=200 tail=200 (prevTail=199)
  depChanged=true` / `append 201: len=200 tail=201 (prevTail=200) depChanged=true` / `append 205: len=200
  tail=205 (prevTail=204) depChanged=true` → **scroll-effect fires 205 of 205 appends**; at n=1000,
  **1000 of 1000**. The old failure point (append 201, where `events.length` stopped changing) now changes the
  dep: the counter is uncapped while the list is capped.
- Empty-list case: `tail` evaluates to `-1` for `[]`, then the first append moves it to `1` — the mount render
  also runs the effect once on an empty box (`scrollTop = scrollHeight` = 0), which is harmless.
- Cap still bounds retained memory at every write path: `grep -n setEvents` over the four files returns exactly
  two lines — the `useState` at page.tsx:65 and the single updater inside `log` at page.tsx:82. At n=205 the
  retained window is `seq 6..205` (exactly 200 records); at n=1000 it is `801..1000`. Keys stay unique because
  `seq` is monotonic and the slice keeps the newest.

## F1 — CLOSED. Single-flight and the door verified by simulation

- Harness transcribed from page.tsx:148-193 + DropZone.tsx:55-61, with a fake `apiFetch`:
  - 5 drops in a row while the first call is out → **requests=1, keepPhoto=1, aiBusy=false, pending=null**, one
    draft. `keepPhoto` never runs twice, so the photo shown is always the photo of the in-flight call — the
    mismatched photo/draft pair F1 described is unreachable.
  - two calls in the same tick → **requests=1**. The guard `if (draftLive.current !== 0) { return; }`
    (page.tsx:154) is synchronous, sits before the first await (:168), and uses a ref, so it is not subject to
    React batching; `draftLive.current = me` (:156) lands before any await.
- Door reopens on the paths the stack can take (each simulated): rejected request with a JSON detail
  (page.tsx:187, `.catch(() => ({}))`) → `aiBusy=false, pending=null, err` set; `apiFetch` throwing — which is
  how the 401 path arrives, `lib/api.ts:17-27` does `location.href="/"` then `throw` (page.tsx:167-171 catches
  it) → `aiBusy=false, pending=null, err="the draft request could not be sent"`. No state is written before the
  early return at :154, so a refused re-entry leaves nothing stale; and because `keepPhoto` (:158) is after the
  guard, a refused photo cannot rebind the preview.
- Door at the widget too: `if (!f || busy) { return; }` (DropZone.tsx:56), `disabled={busy}` (DropZone.tsx:107),
  plus `if (!busy && !over)` on drag-over (:68) so the zone does not invite a drop it will refuse.

## Everything the round-1 review measured clean, re-checked on the rework

- Timers: still exactly one `requestAnimationFrame` (AiReview.tsx:62) cancelled in its cleanup (:63); the
  rework did not touch that effect (only the comment, the `reading` prop and the new `: reading ?` branch).
  `addEventListener` = 0 in the four files AND 0 in the built route chunk.
- Object URL: created only at page.tsx:95 inside `keepPhoto`, which is called only from aiDraft:158 (once per
  accepted photo); revoked on replace (:94) and on unmount (:91, `[]` deps).
- Dep arrays, no per-render re-subscribe: `[tail, pending]` (:64) and `[draft]` (AiReview.tsx:64) are
  primitives/identity, not newly-created objects; `load` is `useCallback(…, [])` (page.tsx:100) so the mount
  fetch still fires once (`useEffect(() => { load(); }, [load])`, :104); unmount revoke `[]` (:91).
- `apiFetch` still replays at most once (lib/api.ts:8-15, one re-fetch after a successful refresh); the new
  try/catch adds no retry and no second request. try/catch inside an already-async function costs nothing
  measurable.
- Re-render cost unchanged: worst case ≈200 log `<li>` + ≤50 lot rows; the rework's only new per-render work is
  an O(1) `tail` read. No `transition-all` anywhere in the built sheet (0 occurrences); the new paint is
  `disabled:opacity-50` / `disabled:pointer-events-none`, both compositor/paint-cheap.
- Built artifact (worktree `.next`, which does contain round-2 code — the round-2-only string "the draft
  request could not be sent" is present in the route chunk, grep=1): CSS `bde54a820760053a.css` = **32,262 B**,
  454 rule blocks (round 1: 32,160 B / 453), with both new variants present —
  `.disabled\:opacity-50:disabled{opacity:.5}` and `.disabled\:pointer-events-none:disabled{pointer-events:none}`;
  dead-rule complement still clean (`.grow` 0, `.invisible` 0, bare `.shadow` 0 — the 6 `shadow` hits are the
  app's own pre-existing `.shadow-glow*` tokens). Route chunk `page-0d1d4e09efa25c84.js` = **22,323 B**
  (round 1: 21,269 B → +1,054 B for the rework). First-load `/admin/intake/page` = **373,236 B** across 5
  chunks vs `/admin/assets` 376,973 B and `/admin/dashboard` 372,767 B (`/_not-found` 353,583 B); 346,952 B of
  it is the two shared React/Next chunks every route loads. Large-dep signature in the route chunk = 0 matches;
  `git diff --name-only 7270547..HEAD` lists no `package.json`/lockfile → no new dependency.

## Residual risk (stated, not required)

**R1 — the one path where the new door stays shut: a 2xx whose body is not valid JSON leaves the drop zone
dead for the session, with no in-page recovery.** `page.tsx:182` `const d: Draft = await r.json();` is the only
unguarded read in the function (its sibling at `:187` and every other json read in the file carry
`.catch(() => ({}))`), and it sits outside the new try/catch, which wraps only the header phase (`:168`). My
simulation of that exact path prints `rejection escapes aiDraft: SyntaxError: Unexpected token '<'` and then
`state after: {"aiBusy":true,"pending":"/staff/ai/intake-draft",...}` — `draftLive` is reset to 0 at `:175` but
`setAiBusy(false)`/`setPending(null)` at `:191-192` never run, so `take()` refuses and the input is `disabled`
while AiReview says "Reading the photo now" forever. This is new *consequence*, not new code: in round 1 the
same throw left `aiBusy` set but the flag was advisory (no `disabled`, no busy check), so another photo
recovered it; round 2 made the door binding without guarding this read.
Honest reachability: low. It needs a 200 body that is not JSON. FastAPI always returns JSON for
`POST /staff/ai/intake-draft` (`staff_ai.py:61` returns a dict; every failure is 422/502 JSON), nginx has no
`error_page`/`proxy_intercept_errors` rewrite on the api server, and with default `proxy_buffering` on (the
`^/staff/ai/` block sets only `proxy_read_timeout 190s`, no buffering off) a mid-stream upstream failure becomes
502/504 rather than a truncated 200 — so no component of this stack produces it today. It requires an
intermediary (proxy/extension) substituting a body, or a body truncated after the headers. One line closes it,
if a future round touches this function: `const d: Draft = await r.json().catch(() => ({}));` (or clear
`aiBusy`/`pending` in a `finally`). Recorded rather than required, and it does not affect the closure of F1.

- **R2 (dead but harmless):** with the door holding at `page.tsx:154`, the supersession check
  `if (draftLive.current !== me) { return; }` at `:174` is unreachable — `draftLive` can only hold `me` or 0 at
  that point. If it ever did fire with `draftLive === 0` it would skip only cleanup the door already re-opened.
  No cost, no stale state; noted so the claim in its comment is read correctly.
- **R3 (cosmetic):** a photo dropped while a call is out is refused *silently* (`DropZone.tsx:56`) — unlike a
  non-photo it writes no line and shows no message; the zone's own "Reading the photo..." heading is the only
  signal. Acceptable, but the record's honesty rule would prefer one line.
- **R4 (out of scope, unchanged):** `Scan` (`page.tsx:286`) and `Create lot` (`page.tsx:272`) are still
  unguarded, as the round-1 feedback explicitly ruled; a draft finishing while a scan-in is out also clears the
  single-slot `pending` marker early (`page.tsx:191`) — a display-only effect on the "waiting on" line.
- **R5 (harmless):** on the 401 path `apiFetch` navigates to "/" and throws; the new catch then writes
  `setErr`/`setPending`/`setAiBusy` on a page being torn down. Navigation wins; nothing is observable.

## Not verified, stated plainly

I did not run docker (per instruction), so there is no live-route check and no backend gate from me; every
number above is from the worktree's existing build output and from code run locally (`node` simulations). The
build predates commit 49cbea7 by ~40 s (chunk/CSS 22:09:12, html 22:09:18, commit 22:09:58) but contains
round-2-only strings, and the worktree is clean against HEAD, so it is the round-2 tree. I edited no file other
than this verdict.
