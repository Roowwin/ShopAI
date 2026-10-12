VERDICT: CHANGES

Reviewed `git -C <worktree> diff 7270547..HEAD` (4 intake files + this job's spec) and the round-2-only
diff `e7735ba..HEAD` (the same 4 files). Every number below is from the worktree source, the built sheet
`apps/backoffice/.next/static/css/bde54a820760053a.css` (32,262 B) or
`apps/backoffice/.next/server/app/admin/intake.html` (21,445 B). I ran no docker and used nothing the
builder reported; the round-1 verdicts and `feedback.md` were read first.

Two findings. The four required fixes are real and I re-derived each one — but F1's guard is
incomplete in exactly the place the round-1 review told the builder to guard, and F5's reworded
comment has the same defect the round-1 review named, one line further along.

## Findings

### 1 (blocking) F1 — the door has one unguarded exit, and it is worse than the base it replaced
`page.tsx:182` `const d: Draft = await r.json();` sits OUTSIDE the try/catch. The try at
`page.tsx:167-171` wraps only the `await apiFetch(...)` statement; the parse is 11 lines later and
unguarded. If it rejects, the rejection escapes `aiDraft` — and `draftLive.current` (set to `me` at
`:156`) is only ever reset at `:175`, so it stays non-zero for the rest of the session. `setPending`/
`setAiBusy` (`:191-192`) are skipped with it.

Consequences, all from that one line:
- every later photo is silently dropped: `page.tsx:154` returns before any log, so nothing appears in
  the record to say so;
- `aiBusy` stays true, so `DropZone.tsx:107` keeps the file input disabled and `DropZone.tsx:56`
  refuses every drop (`take`) — the primary control of this screen is dead until a page reload, and
  the zone keeps announcing "Reading the photo..." (`DropZone.tsx:93`) with nothing in flight;
- `pending` stays set, so `ValidationStream.tsx:90-95` keeps rendering "waiting on
  /staff/ai/intake-draft" — the record claims a call is out when none is, in the one panel whose
  stated job is truthful reporting.

The base was recoverable here: at 7270547 the same bare `await r.json()` also escaped, but there was
no door and no disabled input (`grep -n "disabled" app/admin/intake/*.tsx` on the base → nothing), so
the next photo just ran `aiDraft` again. This round's guard converted a transient mislabelled heading
into a permanent brick. The builder's own comment at `:163-165` states the invariant it did not
achieve: "Only the way a REJECTED request is handled is new: it is reported and the door reopens,
where the base ... left its busy flag set for the rest of the session."

Repro (mechanism certain, trigger named not observed — I could not run the stack): any 2xx whose body
does not parse. `r.ok` is true, so control reaches `:182`; an interrupted body transfer (this call is a
multi-second vision read, so it is the longest-lived request on the page) or any intermediary answering
200 with HTML rejects `json()`, which then escapes `aiDraft`. Confirmable by inspection in one command:
`grep -n "draftLive" apps/backoffice/app/admin/intake/page.tsx` → set at 156, read at 154/174, cleared
only at 175 — no cleanup path exists between the close and that clear.

Fix: keep the door's invariant on every exit, e.g. `const d: Draft = await r.json().catch(() => null);`
(the idiom the same file already uses at `:112` and `:134`) and report the parse failure instead of
setting a draft, or move `:174-175` into a `finally`. Nothing else about the fix needs to change.

What is correct and should not be disturbed: `r === null` is not confusable with a real response
(`apiFetch` is declared `Promise<Response>`, returns `r` or throws — lib/api.ts:3,21 — and a `Response`
is always truthy), the catch genuinely does reopen the door (`:175` runs before the null branch), the
401 throw apiFetch really raises is therefore handled, and the ticket at `:174` is checked before every
post-await write to `draft`/`pending`/`aiBusy` (the only writers of `draft`/`aiBusy` in the file are
`:157` and `:183`/`:192`, all behind it; `createLot`/`scanIn` touch only `pending`, pre-existing).

### 2 (required, cheap) F5 — the reworded enumeration is inexhaustive again, with a counterexample this commit added
`ValidationStream.tsx:11` now says "beside those request events, the two things the page decides on its
own, which are the refusals it makes before it ever sends anything ... and the prefill". This commit
added a THIRD local line: `page.tsx:180` `log("WARN", "Draft not sent: the request could not be made.")`
— it is not a request event, not a payload answer, not an API refusal detail, not one of the three
refusals the comment names, and not the prefill.

Reproduce: `grep -n 'log("' apps/backoffice/app/admin/intake/page.tsx` → 14 sites. Classified:
dispatch 109/131/160; payload answer 117/138/184; API refusal detail 121/144/189; pre-flight refusals
127/128/199; prefill 209; **and 180, the new one the comment does not cover**. Its own list of
pre-flight refusals ("no lot selected, no serial entered, a file that is not a photo") is exactly right
— the count is what is wrong. Fix is "two things" → "three things" (or name it: "...the refusals it
makes before it ever sends anything, the line it writes when a call could not be sent at all, and the
prefill...").

Same inexhaustiveness reaches the operator: `ValidationStream.tsx:98` renders "Fed only by the calls
this page makes." while the panel now carries local lines including the one this round added. That
string predates this round, but the round-2 comment's own wording is what makes it visibly false.

## Minor, recorded (not blocking)
- F4 keeps the kicker look in four of five dimensions, not five: the built heading is
  `<h2 class="text-sm font-semibold !text-eyebrow uppercase text-ink-500">New lot</h2>`. `.font-semibold`
  (`{font-weight:600}`) is the only weight declaration on it — `.\!text-eyebrow` carries font-size,
  line-height and letter-spacing only, and `globals.css` declares no heading weight — so the restored
  eyebrow is semibold, where `kickerClass` as used on this same page (`ValidationStream.tsx:68`
  "Activity") has no weight class and renders at 400. So "The kicker look is kept" (`page.tsx:257-260`)
  is size/tracking/case/ink kept, weight changed. Cosmetic and inherent to the primitive F4 asked for;
  flagged only because the comment asserts it. The important utility itself is sound and the heading
  outline is strictly better than base's (1 h1 + 5 h2 vs base's 1 h1 + 3 h2).
- `disabled={busy}` drops focus to the document body when the input is focused as the call starts
  (`DropZone.tsx:107`). No trap — Tab recovers from the top — but a keyboard operator choosing several
  photos re-walks the page each time. Recorded, not required.
- `AiReview.tsx` ordering is right and worth keeping: draft (127) is tested before reading (147), so a
  real draft is never masked by the "Reading the photo now" line, and the fallback is at 153.

## Verified clean by my own measurement (do not regress)
- **F1 mechanism: real.** All three doors present (`DropZone.tsx:56`, `:107`, `page.tsx:154`), and
  `DropZone.tsx:114` is byte-identical to the Button's own treatment (`Button.tsx:18`), as its comment
  claims. Supersession is in fact unreachable (a second call cannot start while the door is non-zero),
  so `draftLive` can only move 0→me→0 — the ticket is belt-and-braces, and correctly placed.
- **F2: real and complete.** `ValidationStream.tsx:60` `tail = events.length > 0 ? events[last].seq : -1`
  with deps `[tail, pending]` at `:64`. `page.tsx:79` increments `seq.current` per event and `:84` clamps
  with `next.slice(next.length - EVENT_CAP)`, which keeps the NEWEST, so at and beyond the cap the length
  is frozen while the last element's `seq` still rises; from empty the dep moves -1→seq. Every append
  moves a dep, memory still bounded at 200.
- **F3: real, and neither path sends.** `SHEET` (`DropZone.tsx:32`) is referenced by `looksLikeSheet`
  (`:49-51`) from `take` (`:58`); the two surfaces branch on what the zone established
  (`DropZone.tsx:126-130`, `page.tsx:198-203`) and claim no reader this build has. `onRefuse` only logs,
  and the sole `onPhoto` call is inside the `image/*` branch.
- **F4 justification holds in the FINAL sheet.** `.text-eyebrow{` @ byte **18997**, `.text-sm{` @ byte
  **19115** — the primitive's class is later, so the sheet would win without the modifier.
  `.\!text-eyebrow{font-size:.6875rem!important;line-height:1rem!important;letter-spacing:.1em!important}`
  is emitted @18699, and the entire sheet contains exactly **3** `!important`, all inside that one rule:
  the app's first `!important` utility, as claimed, and no other rule is affected by it.
- **Optional row-focus item taken cleanly.** `page.tsx:48` ROW_FOCUS dropped the wash and kept
  `focus-visible:ring-2 ring-inset ring-brand-500` (`ring-inset` still required inside Table's
  `overflow-x-auto`). One class removed, no rule left dangling.
- **Complement test on the FINAL sheet: clean both directions** (323 emitted selectors parsed from
  selector preludes, 52 scanned source files). `.grow`, `.shadow`, `.invisible` and `.outline` are all
  ABSENT — the dead `.outline{` the builder says its own first round-2 draft emitted is not in the final
  sheet. Only remainders are the six round 1 already attributed to files this job never touched
  (`filter`, `visible`, `ring`, `collapse`, `transform`, `backdrop-filter`); I checked by exact token that
  none of those nine words appears as a standalone word in any of the four intake files
  (`grep -o -E "(^|[[:space:]\"'])(grow|shadow|invisible|outline|filter|visible|collapse|transform|backdrop)([[:space:]\"']|$)"`
  → 0 for all). Reverse: every class the job writes IS emitted, including `.\!text-eyebrow`,
  `.disabled\:opacity-50`, `.disabled\:pointer-events-none` and all eleven `file:` classes (each count 1).
- **The artifact is the final build, not stale:** `.\!text-eyebrow` and `.disabled\:opacity-50` exist only
  in the round-2 source, and both are in the sheet.
- **Function preservation: exact.** Each of `apiFetch("/staff/lots?limit=50")`,
  `apiFetch("/staff/assets/scan-in"`, `apiFetch("/staff/ai/intake-draft"`, `fd.append("image", file)`, both
  `JSON.stringify` bodies, both guard strings, `"Created lot " + j.lot_number`,
  `"Scanned " + j.serial_number`, `draft.serial_visible.trim()` and the `setNotes("AI draft: ...")` literal
  occurs the same number of times in base 7270547 and HEAD. The ai-draft expression differs only by
  `let r: Response | null = null` plus assignment — the single declared deviation, whose try/catch is
  acceptable in intent (a rejected request is now reported rather than escaping) and whose success path
  is untouched; finding 1 is that the same intent was not applied to the parse. `setPending` is new but
  round 1 introduced it, not this round.
- **Scope and hygiene exact.** `git diff --name-only e7735ba..HEAD` is the four intake files and nothing
  else; `7270547..HEAD` adds only this job's own spec. No `package.json`, `apps/backend/**`,
  `globals.css`, `tailwind.config.ts`, other route or storefront. All four blobs LF-only, BOM-free,
  trailing newline.

## Residual risk this gate did not close
- No runtime execution: `/admin/intake` is behind auth and I ran no docker, so the round trip
  (photo → `/staff/ai/intake-draft`, and the scan-in POST) is read from source and the built artifact
  only. Finding 1's mechanism is certain from the code; its trigger is named, not observed here.
- F2 needs ~200 records (~70 scans at 3 lines each) to show at all; the mechanism is what matters and
  the old dependency is genuinely gone.
