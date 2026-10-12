VERDICT: PASS

Reviewed `git -C <worktree> diff 7270547..HEAD` (4 intake files + this job's own spec) and, separately,
the round-2-only diff `e7735ba..49cbea7`. HEAD = `49cbea7b163ae8a518bc9fa796433345637cea05`;
`git status --porcelain` is EMPTY, so
the tree I read is the tree I gated. Re-verified from scratch rather than inheriting round 1. No finding
rises to CHANGES; residual risk is stated at the end.

**1. The AI wall — still untouched, and no new network symbol anywhere**
- `git diff --name-only 7270547..HEAD -- apps/backend/` is EMPTY. No backend file, no endpoint, no
  parameter, no migration — `apps/backend/tests/test_ai_wall.py` (the DB-role invariant) cannot be
  reached from this diff.
- All four `apiFetch` call sites are byte-identical to the base: normalizing `git show
  7270547:.../page.tsx` against the new file and `diff`-ing gives `IDENTICAL-CALL-SITES` — same three
  endpoints (`/staff/lots`, `/staff/assets/scan-in`, `/staff/ai/intake-draft`) plus the pre-existing
  list GET, same bodies, same field names (`warehouse`, `notes`, `lot_id`, `serial_number`, `image`).
  The rework wrapped the draft call in a `try/catch`; the call expression itself is unchanged.
- Per-pattern counts over `app/admin/intake/*.tsx`, each backed by a positive control (`apiFetch` → 5,
  `apiFetch("/staff` → 4, `import` → 17): `fetch(` 0, `XMLHttpRequest` 0, `sendBeacon` 0, `WebSocket` 0,
  `EventSource` 0, `axios` 0, `navigator.` 0, `import(` 0. No added line in the whole `7270547..HEAD`
  `apps/backoffice` diff matches any of those, or `console.`/injection/secret patterns (grep exit 1).
- Built chunk `.next/static/chunks/app/admin/intake/page-0d1d4e09efa25c84.js` (22,323 B, 22:09 — a NEW
  hash vs round 1's `page-8bbe14b8e97ab127.js`, and it carries the round-2 strings `is not a photo` ×2,
  `Reading the photo now` ×1, `could not be sent` ×1, so it IS built from `49cbea7`): exactly **one**
  external origin, `https://api.rfo.localhost` (the pre-existing `lib/api.ts:1` default), and 4
  `fetch(` occurrences — the same 4 that `lib/api.ts` (unchanged, not in the diff) contains. No
  `XMLHttpRequest`/`sendBeacon`/`WebSocket`/`EventSource`/`axios`/`navigator` (0 each, positive controls
  `scan-in` → 6, `intake-draft` → 3 fire).

**2. Both refusal branches are purely local — nothing is sent, a name is only ever text**
- `DropZone.tsx:55-61` `take()` is the single door: non-image → `setRefused({name, sheet})` (local
  state) + `onRefuse(f.name, sheet)`; `page.tsx:198-203` `onRefuse` only calls `log(...)`, i.e. appends
  one Activity line. No request, no model call, no storage write on either branch.
- `looksLikeSheet` (`DropZone.tsx:49-51`) is a pure local classification — `SHEET.test(f.name)` (the
  constant is now referenced; `:32` has no `g` flag, so no `lastIndex` statefulness), `f.type ===
  "text/csv"`, `f.type.includes("spreadsheet")`. Nothing in it opens, reads, parses or transmits the
  file.
- The name is rendered only as a JSX text child: `DropZone.tsx:127,129` (`{refused.name}`) and
  `page.tsx:199-202` (concatenated into a log string). `href=` → 0 over the four files, so no name
  reaches a URL/attribute; the only `src={` (1) is `<img src={photo.url}>` from the object URL.

**3. ADR 0006 — every write still needs an operator press; nothing was removed or automated**
- The four files contain exactly four `useEffect`s: `page.tsx:104` the pre-existing mount `load()` (a
  GET), `page.tsx:91` the object-URL unmount revoke, `AiReview.tsx:60` the rAF fade,
  `ValidationStream.tsx:61` the scroll-to-tail. None performs a mutation.
- Every POST sits under an operator gesture: `createLot`/`scanIn` under `onClick`
  (`page.tsx:272,286`), the draft call under the input `onChange` (`DropZone.tsx:108`) /
  `onDrop` (`:85`), and `prefill` still only writes local fields under `AiReview.tsx:145`
  `onClick`. The rework added a `catch` and a guard; it removed no confirmation and automated no write.
- The `catch` (`page.tsx:167-171`) cannot mask a dead session: `lib/api.ts:8-26` clears
  `rfo_access` and fires `location.href = "/"` BEFORE it throws, and `aiDraft` then sets `r = null` and
  a constant error string. It reopens the door the base left stuck (`setAiBusy(false)` now always
  runs on that path); it does not suppress the redirect and issues no follow-up request.

**4. Single-flight and the disabled state — fail-closed, and no stale payload can land**
- Two independent doors: `DropZone.tsx:56` (`if (!f || busy) return;`), `:107` (`disabled={busy}`), and
  `page.tsx:154` (`if (draftLive.current !== 0) return;`). The page door is a **ref**, not state, so it
  holds even if a handler were bound to a pre-flush render.
- `keepPhoto(file)` was moved BELOW the guard (`page.tsx:154` before `:158`), so a refused second photo
  cannot rebind the blob URL, and `setDraft(null)` (`:157`) clears the panel before the call goes out —
  `AiReview` shows the new `reading` pending branch (`AiReview.tsx:147-150`) instead of a stale card.
- The superseded-response test (`page.tsx:174`) returns before touching draft, pending or busy. Two
  concurrent calls are unreachable from the UI (the ref door + `busy` + `disabled`), and `aiBusy` stays
  true across the entire window in which `draftLive` is back to 0, so a response can never be paired
  with a newer record or a newer photo. Fail-closed in both directions.
- The disabled input exposes nothing and drops nothing: the previously chosen photo stays displayed,
  `onChange` clears `e.target.value` only after reading the `File` (`DropZone.tsx:108`), and no blob,
  serial or token is read from or written to it.

**5. Client data handling — unchanged where round 1 cleared it**
- Object URL: created once in `keepPhoto` (`page.tsx:93-98`), previous one revoked before the next, and
  the live one revoked on unmount (`:91`) — read from the ref at teardown, so the LAST URL is the one
  released. `blob:` appears only as `<img src>`, origin-scoped, not a credential.
- `console.*` → 0 matches in the four files AND in the built chunk (each of log/error/warn/info/debug
  counted 0). The new error string is the constant literal `"the draft request could not be sent"`
  (`page.tsx:179`) — no message, name or URL interpolated.
- Injectors → 0 per pattern in the four files and in the chunk (`dangerouslySetInnerHTML`, `innerHTML`,
  `eval(`, `Function(`, `document.write`). Every API/model string (`draft.*`, `j.detail`, `refused.name`,
  `file.name`) is a JSX expression child, React-escaped; `gradeTone`/`statusTone` (`lib/ui.ts:49-57`)
  are lookup tables with `?? NEUTRAL`, so no model string is ever concatenated into a class or attribute.
- Built HTML (`.next/server/app/admin/intake.html`, 21,445 B, 0 CR): 0 occurrences of `blob:`,
  `Bearer`, `access_token`, `rfo_access`, `Authorization`, `sessionStorage`, `https://` or any external
  origin; `href/src` are all `/_next/...` or `/admin*`. It renders only the honest empty states
  (`No photo yet` ×1, `No draft yet` ×1, `No intake call has been made yet` ×1, `Spreadsheet rows` ×1,
  `none selected` ×1, `not entered` ×2) and bakes in NO draft data (`grade ` 0, `confidence ` 0,
  `Prefill scan-in` 0, `<img` 0) — no fabricated record. Built CSS `bde54a820760053a.css` (32,262 B):
  0 `url(`, `@import`, `data:`, `expression(`, `javascript:` — nothing that can carry an outbound ref.

**6. Secrets, dependencies, walls — clean**
- Secret-pattern grep over the four files: 0 matches. The one diff entry under `factory/` is this job's
  own `spec.md` (the preceding `chore(factory)` commit); its only hits for the pattern are the words
  "token" (design tokens) and "secrets/" inside the constraint sentence — no credential.
- `package.json`, all lockfiles, `.env*`, `secrets/`, `infra/` are untouched by the diff. Every import
  resolves to `react` or an in-repo `@/…`/`./…` path — no new dependency.
- No route added, removed or renamed; `app/admin/layout.tsx`, `lib/api.ts`, `app/components/**` are all
  outside the diff, so the route guard, the Bearer wall and the server-side `require_roles` check are
  exactly as they were.

**Residual risk / what this gate did NOT prove**
- One functional fail-closed gap, recorded honestly, NOT a security finding: on the success branch
  `await r.json()` (`page.tsx:182`) is still unwrapped, so a `200` with a malformed body rejects and
  skips `setPending(null)`/`setAiBusy(false)`, leaving the zone disabled for the session. Fail-closed —
  no call can start, no data is exposed, and no stale payload is applied — availability only.
- Accepted (as in round 1, unchanged by the rework): the operator's typed serial and the draft's
  `serial_visible` are echoed into the in-session Activity record and the Raw-input list. That is the
  operator's own value, on their own screen, in React state only, sent nowhere new.
- Not executed here: the in-browser round trip and the live `/admin/intake` page (behind auth), and no
  docker was run (the orchestrator holds the gate). Behaviour is read from source and the built artifact;
  the endpoints and `lib/api.ts` are byte-identical to the base, so the runtime path is the pre-existing
  one rather than anything this job authored.
