VERDICT: PASS

Re-verified from scratch against `git -C <worktree> diff 7270547..HEAD` (4 intake files + the job's own
spec) and the round-3-only diff `49cbea7..ef5f7c6`. HEAD = `ef5f7c6`; `git status --porcelain` is EMPTY,
so the tree I read is the tree I gated. Round 3 touched only `page.tsx` and `ValidationStream.tsx`, and
I did not inherit rounds 1-2: the walls and the new surfaces were re-run here. No finding rises to
CHANGES; residual risk stated at the end.

**1. The AI wall — untouched, no new network symbol, one origin**
- `git diff --name-only 7270547..HEAD -- apps/backend/` is EMPTY. No endpoint, parameter or migration.
- The four changed files match NONE of `fetch(` / `XMLHttpRequest` / `sendBeacon` / `WebSocket` /
  `EventSource` / `axios` / `navigator.` / `import(` / `https?://` (0 each; positive controls on the
  same command: `apiFetch` → 5, `import` → 18, `useEffect` → 7, so the sweeps are live).
- Built chunk `.next/static/chunks/app/admin/intake/page-1703ae56506e214d.js` (22,621 B, 22:16 — a NEW
  hash vs round 2's `page-0d1d4e09efa25c84.js`, and it carries the round-3 strings below, so it IS built
  from HEAD): exactly one external origin, `https://api.rfo.localhost` (the unchanged `lib/api.ts:1`
  default), 3 `/staff/ai/intake-draft`, 3 `/staff/assets/scan-in`, 4 `/staff/lots` (the 4th is the
  `?limit=50` list GET), and exactly 4 `fetch(` — the same 4 that the byte-identical `lib/api.ts`
  contains. No XMLHttpRequest/sendBeacon/WebSocket/EventSource/axios/navigator (0 each).

**2. The new error surfaces — constant literals, no internals, no markup**
- New branch `page.tsx:196-201` (`answer arrived but could not be read`): `setErr("the draft answer
  could not be read")` and the log literal `"Draft unreadable: the answer arrived, but it could not be
  read."` are BOTH constant string literals with nothing interpolated — no parser exception, no stack,
  no response body, no endpoint internals, no serial/blob. The parse is `await r.json().catch(() => null)`;
  the caught error is discarded and never named.
- The other refusal strings are also constant (`"the draft request could not be sent"`, `page.tsx:183`).
- The reworded visible string (`ValidationStream.tsx:101-105`, "Fed by this page's own calls, and by
  what it decides on its own - the refusals it makes, a request that could not be sent or read, and the
  prefill.") is ACCURATE, not merely longer: it now names the two error branches (not-sent / not-read)
  that the previous "Fed only by the calls this page makes" string omitted, which is exactly what the
  page writes into the record. No internal is added.
- Both new strings render as React text: 0 `dangerouslySetInnerHTML`/`innerHTML`/`eval(`/`Function(`/
  `document.write` in the four files and in the built chunk; the built HTML is produced by
  `grep -oF` against 19 Next.js `<script` tags and shows no injected markup. `... could not be read`
  present ×1 in the chunk and the reworded record string present ×1 in `intake.html` (21,555 B), so both
  are the built artifacts' own text.
- Pre-existing, NOT widened by this round: the `!r.ok` branch (`page.tsx:187-191`) renders the API's own
  `j.detail` verbatim. `git show 7270547:.../page.tsx` shows the base already did
  `setErr(j.detail ?? "AI draft failed")` — this round moved it inside the try and added an early
  `return`, changing no value's origin or destination. Trusted first-party endpoint; accepted in rounds
  1-2; it is the same string the panel showed before.

**3. The `try/finally` shape — no swallow, no misrouting, the 401 path still fires**
- The rework wrapped the whole body in `try { ... } finally { ... }` (`page.tsx:168-213`) with the
  reopen/clear block ONLY in the finally. Every `return` (superseded, not-sent, `!r.ok`, unreadable) and
  the success fall-through all pass through it, so the door can no longer be left shut on a 2xx whose
  body did not parse (the round-2 residual, now closed).
- The finally cannot swallow or mask: it contains no `return`/`throw`, only three state setters, so any
  exception thrown in the try still propagates after it runs. It cannot report a failure as success —
  `setDraft(d)` is reached only after the response is `ok` AND parsed AND non-null; every failure path
  `return`s before it.
- The `apiFetch` 401 path is preserved: `lib/api.ts:17-26` clears `rfo_access` and sets
  `location.href = "/"` BEFORE it throws. The inner `catch` (`page.tsx:174-176`) turns that throw into
  `r = null`, then the honest branch runs (`setErr("...could not be sent")`), and the finally clears the
  flags. The redirect still happens and the failure is reported out loud — an auth failure is neither
  hidden nor turned into success.
- Superseded path is correct and fail-closed: the guard is `if (draftLive.current !== me)` in both the
  body (`:179`) and the finally (`:208`), so a superseded call clears nothing — the newer call that owns
  the flags clears them on its own exit. Two concurrent calls are unreachable from the UI anyway
  (`DropZone` disabled while busy + the `draftLive.current !== 0` door at `:154`).

**4. ADR 0006 — unchanged; every write still under an operator press**
- The four files hold the same non-mutating effects as before (mount GET `load()`, object-URL unmount
  revoke, rAF fade, scroll-to-tail); round 3 added NO effect. Every POST still sits under `onClick`
  (`createLot`/`scanIn`) or the file-change/drop handler; `prefill` writes local fields only.
- The single-flight guard (`page.tsx:154`, a ref) is a re-entrancy control, not an authorization change:
  it gates only whether one client may launch a second identical request, narrows nothing about who may
  call the endpoint, and the server-side `require_roles` check is untouched (`apps/backend/**` not in the
  diff). No confirmation was removed or automated.

**5. Re-verified client surfaces and walls**
- 0 `console.*` in the four files AND in the built chunk (log/error/warn/info/debug counted 0).
- Object URL: created once in `keepPhoto` (`page.tsx:93-98`), previous revoked before the next, live one
  revoked on unmount (`:91`) from the ref at teardown. `blob:` → 0 in the chunk and the HTML; it appears
  only as `<img src>` — origin-scoped, not a credential.
- Secrets: the four files match none of `api[_-]?key`/`secret`/`password`/`Bearer`/`Authorization`/
  `access_token`/`rfo_access`. The chunk's 4 `rfo_access`, 2 `access_token`, 2 `Bearer` are the bundled
  `lib/api.ts` key NAMES and header construction (byte-for-byte the occurrences in `lib/api.ts:4,6,12,
  13,18,33`), and the built HTML has 0 of each — no credential value anywhere.
- No new dependency: `package.json`, all lockfiles, `.env*`, `secrets/`, `infra/` are untouched by the
  diff; the round-3 hunk adds no import (both files' imports resolve to `react` or in-repo paths).
- Walls unchanged: `lib/api.ts`, `app/admin/layout.tsx`, `lib/ui.ts`, `app/components/**` are all outside
  the diff → route guard, Bearer wall and server-side `require_roles` are exactly as before. CSS
  `bde54a820760053a.css`: 0 `url(`/`@import`/`data:`/`expression(`/`javascript:` — nothing that can carry
  an outbound ref. HTML renders only the honest empty states (`No photo yet` ×1, `No draft yet` ×1,
  `No intake call has been made yet` ×1, `none selected` ×1, `not entered` ×2) and bakes no draft data
  (`<img` 0, `Prefill scan-in` 0, `grade ` 0, `confidence ` 0, `blob:` 0).

**Residual risk / what this gate did NOT prove**
- The `!r.ok` branch still echoes the API's own `j.detail` into the operator panel and the activity log,
  verbatim and unmoderated (`page.tsx:188-190`). This is the base's own behavior, unchanged and
  pre-existing (confirmed at `7270547`), from a trusted first-party endpoint; if that endpoint ever
  emitted an internal string it would surface on the operator's own screen. Not a finding for this
  round, but the one place a server string is trusted.
- The operator's typed serial and the draft's `serial_visible` are echoed into the in-session record and
  Raw-input list (accepted in rounds 1-2): the operator's own value, on their own screen, in React state,
  sent nowhere new.
- Not executed here: the in-browser round trip and the live `/admin/intake` page (behind auth); no docker
  was run (the orchestrator holds the gate). Behavior is read from source and the built artifact, and the
  endpoints and `lib/api.ts` are byte-identical to the base, so the runtime path is the pre-existing one.
