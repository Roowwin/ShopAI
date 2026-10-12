# feedback — round 1, job job-20261012-214540-3397

Decision: ESCALATE (architect CHANGES / performance CHANGES / security PASS).
Round 1 verdicts, in full: `architect.md`, `performance.md`, `security.md` beside this file.
Both F1 and F2 were found INDEPENDENTLY by two reviewers from their own measurement. Fix them;
do not re-argue them. Everything the reviewers verified clean stays clean — do not regress it.

## REQUIRED

### F1 — the `busy` flag is advisory, not a guard: a second photo can pair the wrong photo with the wrong draft
`DropZone.tsx:35-40` (`take()` has no busy check), `:52-56` (`onDrop` unconditional), `:81` (the
`<input type="file">` has no `disabled`), `page.tsx:137-156` (`aiDraft` has no re-entrancy guard;
`:147` `setDraft(d)` is last-writer-wins; `:155` clears `pending` after whichever request finishes
first), `page.tsx:82-86` (`keepPhoto` rebinds the photo URL to the newest file immediately),
`AiReview.tsx:74-79` vs `:120-139`.

Evidence: `grep -n "disabled" apps/backoffice/app/admin/intake/*.tsx` → no matches (exit 1);
`grep -n "busy"` → only `DropZone.tsx:25,30,71` and `page.tsx:197`, i.e. the flag changes a heading
string and nothing else.

Repro: choose/drop photo B while A is still being read. If A resolves second, the panel renders B's
image beside A's `brand` / `model` / `serial_visible`, and `Prefill scan-in`
(`AiReview.tsx:138` → `page.tsx:166-172`) writes A's serial into the field the operator is matching
against photo B. The in-flight "waiting on" marker also disappears while a call is genuinely out.
This contradicts the panel's own stated contract (`AiReview.tsx:7-13`).

Note the honest framing: the base at `7270547` had no guard either, but it showed no photo and
claimed no pair — this job added the busy state, plumbed it to the child that could enforce it, and
added the side-by-side panel that makes the mismatch read as a single record. Fix it here.

Fix (inside the allowed surface, changes no flow's behaviour): early-return in `take()` while busy,
`disabled={busy}` on the file input, and a re-entrancy guard in `aiDraft` so a response that is no
longer the current request cannot set `draft`, `pending` or `aiBusy`.

### F2 — the auto-follow tail stops at the 200th record
`ValidationStream.tsx:52-55` (`}, [events.length, pending])`) vs `page.tsx:36`
(`EVENT_CAP = 200`) and `page.tsx:73` (`next.slice(next.length - EVENT_CAP)` clamps the length).

Once the list is saturated, a pure-log append leaves BOTH deps unchanged, so the effect that runs
`el.scrollTop = el.scrollHeight` (`:54`) never re-runs and the newest line stays below the fold —
exactly the outcome the comment at `:50-51` says it prevents. The performance reviewer simulated
the exact reducer and dep check over 205 appends: fires 200 of 205. Reachable on log-only paths:
`page.tsx:161-164` (`onSheet`), `:116-117` / `:120-121` (the pre-flight refusals), `:170-171`
(`prefill`). It is masked whenever the same render also flips `pending`, which is why it hides.

Fix: depend on a value that changes on every append — `events[events.length - 1]?.seq` (the counter
`page.tsx:67-70` already carries) or an explicit append counter.

## ALSO FIX — cheap, and genuine regressions this job introduced

### F3 — the refusal copy asserts the file *was a spreadsheet*, but the trigger is "not an image"
`DropZone.tsx:23` declares `const SHEET = /\.(csv|xlsx|xls|tsv)$/i` and NEVER references it
(`grep` matches the definition only); the refusal is decided by MIME at `:37`
(`if (f.type.startsWith("image/"))`), so every non-image goes to `onSheet`. Both surfaces then claim
a spreadsheet: `DropZone.tsx:100-101` "Spreadsheet parsing is not wired yet — <name> was not read
and nothing was sent" and `page.tsx:161-163` `[WARN] Spreadsheet refused: <name> — this build has no
spreadsheet reader…`. Drop a PDF, a `.zip`, or a photo whose MIME arrives as
`application/octet-stream` and the app tells the operator it was a spreadsheet. It is honest about
sending nothing; the word "spreadsheet" is the part that is wrong.

Fix: either reference the extension regex so the copy is accurate for sheets, or reword both
surfaces so they describe what is actually known ("not a photo — nothing was read and nothing was
sent"). Do not leave the dead constant in place as an unused declaration.

### F4 — the heading outline lost two h2s
`page.tsx:214` ("New lot") and `:231` ("Scan in") were `<Heading as="h2">` and are now
`<p className={kickerClass}>`. Restyle-and-keep-function covers semantics: a screen reader's outline
of this page lost two sections. Use the `Heading` primitive with the kicker styling rather than
demoting the element.

### F5 — a comment overstates what the stream contains
`ValidationStream.tsx:9-13` says every line comes from a request. The pre-flight refusals
(`page.tsx:116-117`, `:120-121`) and the prefill line (`:170-171`) are local events. The lines
themselves are truthful; the enumeration is not exhaustive. Reword the comment. (No comment in this
job may quote a ratio or a percentage — that constraint still holds.)

## RECORDED — optional, cosmetic
`page.tsx:42` `focus-visible:bg-surface-muted` (specificity 0-2-0) beats the selected-row cue
`bg-brand-50` at `page.tsx:263` (0-1-0), so while a selected lot row holds keyboard focus the
"chosen lot" wash disappears — and in this page the row IS the selector. J3 carried the same pair,
but there its row opened a panel instead of selecting. Fix if it is genuinely a one-class change
(e.g. a ring for the selected state rather than a fill); otherwise record it and move on.

## NOT REQUIRED — do not expand this round
- The `Scan` (`page.tsx:242`) and `Create lot` (`page.tsx:228`) buttons share the same unguarded
  wiring, so a double-press can duplicate `POST /staff/assets/scan-in` or create a second lot. It is
  identical in the base at `7270547`, so this job neither introduced nor worsened it. It is
  recorded as a residual for a later job — DO NOT fix it here.
- The dead rules emitted from bare utility nouns in OTHER files' comment prose (`visible`, `ring`,
  `filter`, `collapse`, `backdrop-filter`, `transform`) are outside this job's allowed surface.
  Reported, not yours.

## Before you hand back
- Rebuild and re-report the REAL exit status — redirect to a file and read `$?`; never let a pipe
  own it. Re-run the four-dimension audit numbers for anything you changed.
- Re-run the complement test on the BUILT stylesheet and confirm your diff still emits no dead rule
  (`grow`, `shadow`, `invisible` must stay absent from the sheet) and no missing rule.
- Backend gate: `docker compose build api` then `docker compose run --rm api pytest -q` with the
  three deselects. **The in-container node ids are `tests/…`, not `apps/backend/tests/…`** (the api
  image is `WORKDIR /app` with `COPY . .` from `apps/backend`). Expect `125 passed, 3 deselected`.
- LF / no BOM on every file you touch: verify the STAGED blob with `git show :<path>` and
  `blob.count(b'\r')`, never `grep -c $'\r'`.
- Commit on the same branch `factory/job-20261012-214540-3397`. Do not merge, do not run
  `factory.ps1`, do not touch `factory/**`, do not remove the worktree.
- State plainly anything you could not verify. An honest gap is a note; a silent fake is a CHANGES.
