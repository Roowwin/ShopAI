VERDICT: PASS

Reviewed exactly `git -C <worktree> diff 7270547..HEAD` (4 code files + the job's own spec).
HEAD = `e7735ba06602fe0df1b4829b8cb98d549fa7d2de`; `git status --porcelain` is empty, so the tree
I read is the tree I gated. No finding rises to CHANGES; residual risk is stated at the end.

**1. The AI wall — untouched**
- `git diff --name-only 7270547..HEAD -- apps/backend/` is EMPTY: no backend file is in the diff, so
  `apps/backend/tests/test_ai_wall.py` (a DB-role invariant) cannot be affected.
- The three `apiFetch` call sites are byte-identical to the base. Normalizing `git show
  7270547:.../intake/page.tsx | grep apiFetch` against the new file and `diff`-ing the two gives
  `IDENTICAL-CALL-SITES`: same endpoints (`/staff/lots`, `/staff/assets/scan-in`,
  `/staff/ai/intake-draft`), same bodies, same field names (`warehouse`, `notes`, `lot_id`,
  `serial_number`, `image`). No new parameter.
- Whole-diff grep for `fetch(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|axios|navigator\.` in
  the four changed files: ZERO matches.
- Independent confirmation from the built chunk
  `.next/static/chunks/app/admin/intake/page-8bbe14b8e97ab127.js`: the only endpoints are
  `/staff/lots`, `/staff/assets/scan-in`, `/staff/ai/intake-draft` plus the shared `lib/api` auth
  paths, and the only external origin is the pre-existing `https://api.rfo.localhost`. No new call,
  no new model invocation, no new origin.

**2. ADR 0006 — confirmations stay human-only; a sheet sends nothing**
- No effect in the diff fires a mutation. The only `useEffect`s are the pre-existing mount `load()`
  (a GET), the object-URL unmount cleanup, the rAF fade and the scroll-to-tail. Every POST sits in
  an `onClick` (`createLot`/`scanIn`) or in the file-change/`onPhoto` handler.
- The spreadsheet path refuses locally and cannot reach the API or the model:
  `DropZone.tsx:35-40` returns at the MIME gate for any file whose `type` does not start with
  `image/` — `onPhoto` is never called, only `setRefused` + `onSheet`; and `onSheet`
  (`page.tsx:161-164`) only appends an Activity line. `DropZone.tsx` contains no network symbol at
  all. A file dragged onto the zone as a spreadsheet is refused in the DOM, named, and dropped.
- This is strictly NARROWER than the pre-existing picker: the old `<input accept="image/*">` would
  have submitted any file chosen through the OS "All files" filter; the same MIME gate now fronts
  both the drop and the picker path, so the change removes a way to send a non-image, it does not
  add one.

**3. Client-side data handling — object URL lifecycle is correct**
- `keepPhoto` (`page.tsx:82-87`) revokes the previous URL before creating the next, and the mount
  effect (`page.tsx:80`) revokes the live one on unmount, reading `photoUrl.current` at teardown so
  the LAST URL is the one released. No path creates a URL without storing it in the ref; a rapid
  double-drop revokes the intermediates. No leak, and nothing released early.
- No blob, serial or token reaches a log line, an error string or a URL: grep for
  `console.(log|error|warn|info|debug)` across all four files returns ZERO. The `blob:` URL appears
  only as `<img src>` (`AiReview.tsx:76`) — origin-scoped, not a credential. The built
  `intake.html` contains no `blob:`, `Bearer`, `access_token`, `rfo_access`, or any serial value.
- Residual (accepted, not a finding): the operator's typed serial and the draft's `serial_visible`
  are echoed into the in-session Activity record (`page.tsx:120-121`, `171`) and the Raw-input list
  (`page.tsx:178`). That is the operator's own value on their own screen, held in React state only,
  sent nowhere new, and the same value the form field already displays.

**4. Secrets and dependency surface — clean**
- Grep of the changed files for `api[_-]?key|secret|token|bearer|password|authorization|private key`
  returns ZERO matches.
- `package.json`, lockfiles, `.env*`, `secrets/`, `infra/` are untouched by the diff. Every import in
  the new code resolves to `react` or an in-repo `@/…` / `./…` path — no new package. The one
  non-code diff entry is the job's own `factory/jobs/.../spec.md`; no other `factory/*` write.

**5. Injection / exposure in what is rendered — escaped everywhere**
- ZERO matches for `dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML|eval(|new
  Function|document.write` in the changed files, and none in the built chunk.
- Every API/model string (`draft.brand`, `draft.model`, `draft.condition_notes`,
  `draft.serial_visible`, `draft.confidence`, the error `detail`, the refused file name) is a JSX
  expression child, so React escapes it. Independently confirmed in the built
  `.next/server/app/admin/intake.html`: the model-derived copy is present as text nodes, and the
  SSR markup renders only the honest empty states (`No photo yet…`, `No draft yet…`, `No intake
  call has been made yet…`, `none selected`, `not entered`, `Spreadsheet rows`) — no fabricated row
  data is baked into the artifact.
- The built stylesheet `007b61e37cb234d0.css` has no `url(...)`, `data:`, `@import` or
  `expression(` — nothing that could carry an outbound reference.

**6. Visibility / walls — unchanged**
- No route added, removed or renamed; the screen is still `app/admin/intake/page.tsx`, still inside
  the unchanged `app/admin/layout.tsx` + the `apiFetch` Bearer wall (`lib/api.ts`), whose real check
  remains the server-side `require_roles`. Neither `app/admin/layout.tsx`, `lib/api.ts`,
  `lib/ui.ts` nor `app/components/**` appears in the diff, so nobody's access widens.

**Non-security observation (no action for this lens):** `DropZone.tsx:23` defines
`const SHEET = /\.(csv|xlsx|xls|tsv)$/i`, which is never referenced — the refusal is decided by MIME
alone. Dead code only; it widens nothing and blocks nothing.

**Residual risk / what this gate did NOT prove:** the in-browser round trip (photo →
`/staff/ai/intake-draft`, and the scan-in POST) is read from source and the built artifact only; it
was not executed here, and `/admin/intake` is behind auth so a served-markup check cannot read the
live page. The endpoints are byte-identical to the base, so the runtime behavior is the pre-existing
one rather than anything this job authored.
