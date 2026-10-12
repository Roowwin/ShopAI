VERDICT: PASS

Round-3 architect, job `job-20261012-214540-3397`, branch `factory/job-20261012-214540-3397`, commit **`ef5f7c6`** against base **`7270547`**.
Read first: round-1 and round-2 verdicts + `feedback.md`. Every number below is re-derived from the committed
worktree source (`git show`), the round-3 diff `49cbea7..ef5f7c6`, or the built artifacts
(`apps/backoffice/.next/static/css/bde54a820760053a.css`, 32,262 B; `apps/backoffice/.next/server/app/admin/intake.html`,
21,555 B; `apps/backoffice/.next/static/chunks/app/admin/intake/page-1703ae56506e214d.js`). I ran no docker and used
nothing the builder reported.

Both required items are genuinely closed, and I found no exit the builder failed to enumerate. Nothing new broke.

## F1 — closed, and unescapable by construction

`apps/backoffice/app/admin/intake/page.tsx`

- **(a) One clear, inside the `finally`.** `grep -c "draftLive.current = 0" page.tsx` → **1**, at `:209`, inside the
  `finally` opened at `:205` (`grep -n "} finally {"` → exactly one site). `draftLive` is otherwise only declared
  (`:74`), set (`:156`), read at the door (`:154`, `:179`) and in the guard (`:208`).
- **(b) Both flag resets are inside the same ownership guard — the defect family this round exists to end is absent.**
  `:208-212` is `if (draftLive.current === me) { draftLive.current = 0; setPending(null); setAiBusy(false); }` — all
  three statements inside the guard. A superseded call therefore cannot wipe the newer call's in-flight markers.
- **(c) Every post-door `return` is lexically inside the `try`.** Door taken at `:156`; no `return` exists between
  `:157` and `:167` (`awk 'NR>=157 && NR<=167 && /return/'` → 0 lines). The four returns at `:179`, `:185`, `:191`,
  `:200` are all inside the `try` (`:168`) whose `finally` is `:205`.
- **(d) The parse-failed branch reports and sets no draft.** `:196` `const d: Draft | null = await r.json().catch(() => null);`
  → `:198` `setErr("the draft answer could not be read")`, `:199` logs, `:200` `return` **before** `:202` `setDraft(d)`.
  Both `r.json()` reads are guarded (`:188` `.catch(() => ({}))`, `:196` `.catch(() => null)`).

**Six-exit enumeration re-derived independently — complete.** Door (`draftLive`), `pending`, `aiBusy` after each exit:

| # | exit | door | pending | aiBusy | verdict |
|---|------|------|---------|--------|---------|
| 1 | `:154` re-entrancy (door `!== 0`) | untouched (owner's `me`) | untouched (owner's) | untouched (owner's) | correct — the owning call's own `finally` clears all three |
| 2 | `:179` superseded (`!== me`) | untouched | untouched | untouched | correct — guard is false, flags belong to the newer call; unreachable while the door holds |
| 3 | `:185` request threw (`r === null`) | → 0 | → null | → false | cleared by `finally` |
| 4 | `:191` `!r.ok` | → 0 | → null | → false | cleared by `finally` |
| 5 | `:200` answer unreadable (`d === null`) | → 0 | → null | → false | cleared by `finally` |
| 6 | `:204` success fall-through | → 0 | → null | → false | cleared by `finally` |

No seventh exit exists: exits are exactly the four in-try returns plus the fall-through, plus the one pre-door return
at `:154`. The only exposure I can name is that `:157-162` (React setters, `keepPhoto`, `log`, `new FormData()` +
`fd.append("file", file)`) sit **outside** the `try`, so a throw there would still escape with the door shut. None of
them can throw for a real `File`: the setters are no-throw, `URL.createObjectURL` throws only for a non-Blob argument,
`FormData.append` only for a non-Blob/string value, and `toLocaleTimeString("en-AU", …)` falls back rather than
throwing for an unknown tag. Recorded as residual, not a finding — it is the same shape the round-2 feedback blessed
("a `finally` that clears them is the shape that makes the enumeration trivially true"). The compiled client chunk
carries `"Draft unreadable"` and `"the draft answer could not be read"`, so the round-3 logic (not a stale bundle) is
what shipped.

## F2 — closed; 15 = 9 + 6 is true and complete

`apps/backoffice/app/admin/intake/ValidationStream.tsx:9-20`

`grep -c 'log("' page.tsx` → **15** (round 2 had 14). Classified against the endpoint/flow reality:

- **Request-derived (9):** dispatch `:109` lots, `:131` scan-in, `:160` ai-draft; payload answer `:117`, `:138`, `:203`;
  API refusal detail `:121`, `:144`, `:190`.
- **The page's own (6):** pre-flight refusals `:127` (no lot), `:128` (no serial), `:220` (file/sheet not a photo);
  `:184` could not be sent; `:199` could not be read; `:230` prefill.

The comment's four bullets resolve to exactly those six (refusals = 3, sent = 1, read = 1, prefill = 1), so the
enumeration is complete. The one log line this round adds — `:199` `"Draft unreadable: the answer arrived, but it
could not be read."` (`git diff 49cbea7..ef5f7c6` shows it as the sole net-new `log(` site) — is covered by the new
bullet.

The operator-visible string was making a false claim and no longer does. The new wording
(`ValidationStream.tsx:101-105`) reads "Fed by this page's own calls, and by what it decides on its own - the refusals
it makes, a request that could not be sent or read, and the prefill…" — true of all 15 lines. It is in the built HTML
and the old string is gone: `grep -c "Fed only by the calls this page makes" intake.html` → **0**; the new sentence
matches the HTML byte-for-byte.

## R1 — closed by the "reword" option, and the sheet really is unchanged

The builder's identity claim is **verified independently**, and it is a fresh round-3 build, not a stale file:

- Sheet: `bde54a820760053a.css`, **32,262 B** — same content-hashed name and size as round 2 (identical name ⇒
  identical bytes; content hash). No class was added, so there is nothing new to complement-test — and the reworded
  comment introduced no rule either.
- Freshness proof: the HTML grep on the new footnote matches exactly, and the HTML delta is **exactly 110 bytes**
  (round 2 21,445 → 21,555); the escaped old/new footnote strings are 158 vs 268 chars = **110**. A stale round-2
  sheet would have shipped a stale round-2 HTML; it did not.

The reworded comment (`page.tsx:277-285`) no longer asserts "the kicker look is kept" — it states the weight change.
Its own claims check out: all five h2 render `text-sm font-semibold…` (built HTML); `.font-normal` is **not emitted**
and weight utilities emit in config key order (`.font-medium{` @19205 < `.font-semibold{` @19234), so a plain reset
would lose to the primitive — `!` would indeed be needed, which is the stated reason for rewording instead. Size
claim also holds: `.text-eyebrow{` @18997 < `.text-sm{` @19115, so the modifier is load-bearing.

## Standard set re-verified (landing gate)

- **Function preservation:** every base expression still present, and **round 2 → round 3 counts are identical for
  every preserved token** — this round changed no functional expression. Occurrence counts (base / r2 / HEAD):
  `apiFetch("/staff/lots?limit=50")` 1/1/1, `apiFetch("/staff/assets/scan-in"` 1/1/1,
  `apiFetch("/staff/ai/intake-draft"` 1/1/1, `fd.append("image", file)` 1/1/1, `JSON.stringify` 2/2/2,
  `setNotes("AI draft: ` 1/1/1, `"create or select a lot below first"` 1/1/1, `"serial required"` 1/1/1,
  `setAiBusy(false)` 1/1/1, `setPending(null)` 0/3/3.
- **Scope:** `git diff --name-only 7270547..HEAD` → the four `app/admin/intake/**` files + this job's own spec; round 3
  touched only `page.tsx` + `ValidationStream.tsx`. Working tree clean, HEAD == `ef5f7c6`.
- **LF / no BOM:** all four committed and staged blobs — `b'\r'` count 0, no BOM, trailing newline, index == HEAD
  (verified with Python over `git show :<path>` and `git show <rev>:<path>`, not `grep -c $'\r'`).
- **Built HTML:** 5 `<h2>` (`Photo intake`, `Capture`, `New lot`, `Scan in`, `Lots`) and one preserved
  `select lot...`.
- **Complement test, both directions:** 401 emitted class tokens vs 52 scanned source files → **0** emitted-but-in-no-source.
  Reverse: no genuine class written by the intake files is missing (the only "missing" tokens are prose,
  `aria-live` values and prop values like `size="sm"`). The nine `file:` classes written in `DropZone.tsx:112-113` are
  exactly the nine `file:` selectors in the sheet. `.grow`, `.shadow`, `.invisible`, `.outline` are all **absent**.
  Exactly one rule carries `!important`, with its three declarations (`.\!text-eyebrow{font-size:.6875rem!important;
  line-height:1rem!important;letter-spacing:.1em!important}`).

## Residual risk

- **The recorded residual is acceptable and does not block this landing.** The shared single-slot `pending` is cleared
  without ownership at `page.tsx:113` (`createLot`) and `:135` (`scanIn`) — the two functions the round-1 and round-2
  reviewers ruled out of scope. Concretely: pressing Create lot or Scan while a draft read is out can blank the panel's
  "waiting on /staff/ai/intake-draft" line early. It cannot brick: the ownership ticket guards the door and `aiBusy`,
  and neither function touches `aiBusy` or `draftLive`. Effect is a transient honesty glitch in one panel line, on a
  path that also double-POSTs at base. Recorded for a later job, as ruled.
- **Round-2 report correction (does not affect this landing).** Round 2's claim that `"Created lot " + j.lot_number`,
  `"Scanned " + j.serial_number` and `draft.serial_visible.trim()` "occur the same number of times in base 7270547 and
  HEAD" is inaccurate: each is 1 at base and 2 at HEAD. The extra occurrence is the record's own log line quoting the
  same value — an addition by round 1, not a removal; nothing base did was removed. Recorded so it is not
  re-litigated as a round-3 regression.
- **Not verified:** no runtime execution (no docker, `/admin/intake` is behind auth). The round trip
  (photo → `/staff/ai/intake-draft`, and the scan-in POST) is read from the committed source and the built artifacts.
  F1's mechanism is now certain from source and its guard shape is structurally unescapable; F2's count is exhaustive
  by direct enumeration.
- Cosmetic: `ValidationStream.tsx:104` says "the record carries a call's start and its answer, and nothing in between"
  while the panel does draw a "waiting on …" marker between them — but that is not a record line and not progress, and
  the comment at `:20` acknowledges the marker. Not a false claim of the kind round 2 flagged.

## Commands

```
cd factory/worktrees/job-20261012-214540-3397
git rev-parse HEAD                                        # ef5f7c6
git diff --name-only 7270547..HEAD                        # 4 intake files + factory/jobs/.../spec.md
git diff --name-only ef5f7c6^..ef5f7c6                    # page.tsx, ValidationStream.tsx
grep -n "draftLive" apps/backoffice/app/admin/intake/page.tsx
grep -c "draftLive.current = 0" apps/backoffice/app/admin/intake/page.tsx     # 1
awk 'NR>=157 && NR<=167 && /return/' apps/backoffice/app/admin/intake/page.tsx | wc -l   # 0
grep -c 'log("' apps/backoffice/app/admin/intake/page.tsx                     # 15
grep -o '<h2[^>]*>[^<]*</h2>' apps/backoffice/.next/server/app/admin/intake.html
grep -c "Fed only by the calls this page makes" apps/backoffice/.next/server/app/admin/intake.html  # 0
grep -bo '\.text-eyebrow{' apps/backoffice/.next/static/css/bde54a820760053a.css   # 18997
grep -bo '\.text-sm{'      apps/backoffice/.next/static/css/bde54a820760053a.css   # 19115
grep -bo '\.font-medium{'  apps/backoffice/.next/static/css/bde54a820760053a.css   # 19205
grep -bo '\.font-semibold{' apps/backoffice/.next/static/css/bde54a820760053a.css  # 19234  (.font-normal: absent)
```
