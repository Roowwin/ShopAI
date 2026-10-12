VERDICT: CHANGES

Reviewed `git -C <worktree> diff 7270547..HEAD` = 4 code files + spec (AiReview.tsx 149 L, DropZone.tsx
106 L, ValidationStream.tsx 94 L, page.tsx 259 L changed). Nothing below comes from the builder's report;
every number is from the worktree source or from the built artifact already in it. I ran no docker.

## Verified clean, by my own measurement

- **FUNCTION PRESERVATION: exact.** All six request expressions are byte-identical across
  `git show 7270547:.../page.tsx` vs `HEAD:.../page.tsx` after whitespace normalisation:
  `apiFetch("/staff/lots")`, `JSON.stringify({ warehouse: warehouse || null, notes: notes || null })`,
  `apiFetch("/staff/assets/scan-in")`, `JSON.stringify({ lot_id: lotId, serial_number: serial.trim() })`,
  `apiFetch("/staff/ai/intake-draft", { method: "POST", body: fd })`, `fd.append("image", file)`.
  Guards (`create or select a lot below first`, `serial required`), success strings
  (`setMsg("Created lot " + j.lot_number)`, `setMsg("Scanned " + j.serial_number)`), the three error
  strings and the whole prefill pair (`draft.serial_visible.trim()`, the `setNotes("AI draft: ...")`
  literal) each have base count == head count. `msg`/`err` are still rendered, byte-identical
  (page.tsx:283-284 vs base :124-125). The scan-in entry point is intact and reachable in the built
  markup: `select lot...`, `serial number`, `Scan` each occur once in
  `.next/server/app/admin/intake.html`; only its paint and two `aria-label`s changed.
- **THE TWO FABRICATION TRAPS: both clear.** (a) No spreadsheet rows are drawn from a file that was
  never read - the prerendered HTML carries `Spreadsheet rows` followed by "Not available - this build
  has no spreadsheet reader, so there are no rows to show here and none have been invented", and the
  refusal state renders only a named absence (DropZone.tsx:98-103). (b) No invented percentage:
  `grep -o "[0-9]\+%" .next/server/app/admin/intake.html` returns **zero** matches, and the only
  `progress` hit is the disclaimer "The API reports no progress mid-call". No `Math.random`,
  `setInterval` or fabricated timer exists in any of the four files.
- **THE STREAM'S INTERPOLATIONS ARE BACKED BY THE PAYLOAD** (checked against the endpoint source, not
  the comment). `POST /staff/lots` returns `{id, lot_number, status}` (`staff_ops.py:207`) - so
  "Created lot X (intake)..." is real; `POST /staff/assets/scan-in` returns
  `{id, public_id, serial_number, lot_number, status}` (`staff_ops.py:238-239`) - so "Scanned X into
  LOT-... - it is received." is real; `VISION_SCHEMA` (`staff_ai.py:24-35`) declares exactly the six
  keys the `Draft` type and the "Draft back:" line use, all required. No invented field.
- **HOUSE IDIOM: the J3 round-1 defect is NOT repeated.** The row handler carries the target guard
  verbatim (page.tsx:268 `if (e.target !== e.currentTarget) { return; }`), identical to the fixed form
  at `app/admin/assets/page.tsx:135`; `tabIndex={0}`, `onClick -> e.currentTarget.focus()` and the
  `ROW_FOCUS` string all match the J3 precedent. `ring-inset` is used on both new focus cues that live
  inside a scroller - the lot row (page.tsx:42, inside Table's `overflow-x-auto` at Table.tsx:40) and
  the log box (ValidationStream.tsx:68, its own `overflow-y-auto`). Every outset ring this job adds
  (the two review columns, the file input with `ring-offset-2`) sits inside `Card p-6`, and `Card.tsx`
  declares no `overflow-hidden`, so nothing is trimmed.
- **COMPLEMENT TEST on the built sheet** (`.next/static/css/007b61e37cb234d0.css`, 32,160 B) is clean
  and is this job's own doing. I re-derived it: 372 emitted class selectors. Remainders are 6 real
  selectors plus 2 parser artefacts (`19`, `com` - the `tailwindcss v3.4.19` banner comment, not a
  selector). The 6: `visible` (comment prose, agents/page.tsx:18), `ring` (charts.tsx:2,16,22 /
  kpi.tsx:16 / pipeline.tsx:62 / Input.tsx:14), `filter` (audit/page.tsx:26,73 / orders/page.tsx:21,31),
  `collapse` (layout.tsx:64,111), `backdrop-filter` (CommandPalette.tsx:101), `transform` (only
  `transform` substrings in the scanned globs are AssetPanel.tsx:183, charts.tsx:50, layout.tsx:128 -
  `.transform{transform:translate(...)}` is the stock utility). **Every emitter is in a file this job
  never touched, and none of the six occurs as a standalone token anywhere in
  `app/admin/intake/*.tsx`** - so this job emits no new dead rule. Reverse direction: every class token
  the job writes IS emitted - `grep -Fc` on the sheet returns 1 for `.lg\:grid-cols-3`,
  `.lg\:col-span-2`, `.motion-reduce\:transition-none`, `.focus-visible\:ring-inset`,
  `.focus-visible\:bg-surface-muted`, `.file\:bg-brand-700`, `.min-w-\[12rem\]`, `.bg-surface-sunken`.
- **THE FOUR-DIMENSION AUDIT substance holds where I could check it.** All new fill+ink pairs clear
  4.5:1 when computed from the channel triples in globals.css: the log's ground is opaque
  `surface-sunken` and its four inks measure ink-400 5.94:1, ink-500 7.87:1, ink-600 13.59:1, with
  brand-300 13.23:1 (AI) and accent-700 16.20:1 (WARN); both review columns reuse that step over
  `surface-muted` (ink-400 5.73:1) and the draft's inner `surface` card (ink-500 6.96:1); the refused
  band is accent-700 on accent-50 12.03:1; the file button is ink-900 on brand-700 5.24:1. No literal,
  hex, `rgb()`, `hsl()` or raw hue scale (`slate-`/`gray-`/...) appears in any of the four files.
  (d) is not reinvented: `grep -n "color-scheme\|--tw-ring-offset" app/admin/intake/*.tsx` is empty, and
  the built sheet still carries `color-scheme:dark`. The only sub-bar pairs are the two hairlines
  (line 1.68:1, line-strong 1.98:1), which globals.css:86-91 records as the owner's standing exception,
  and `accent-700` is a LIGHT amber (253 230 138) here, so the usual inversion trap does not apply.
- **SCOPE: exact.** `git diff --name-only 7270547..HEAD` is the 4 intake files plus this job's own
  spec. No `package.json`, no `apps/backend/**`, no `globals.css`, no `tailwind.config.ts`, no other
  route, no storefront, no `app/components/**`. All four blobs are LF-only, BOM-free, trailing newline
  (`blob.count(b'\r') == 0`, first bytes != EF BB BF).

## Findings

- **F1 (blocking): a second photo during an in-flight draft pairs the wrong photo with the wrong draft
  and clears the in-flight marker - the review panel then presents two real values as one record.**
  `DropZone.tsx:35-40` (`take()` has no `busy` check), `:52-56` (`onDrop` calls it unconditionally),
  `:81` (the file input carries no `disabled`), `page.tsx:137-156` (`aiDraft` has no re-entrancy guard;
  `:147` `setDraft(d)` is last-writer-wins; `:155` `setPending(null)` runs after whichever call finishes
  first), `page.tsx:82-86` (`keepPhoto` binds `photo` to the newest file immediately),
  `AiReview.tsx:74-79` vs `:120-139` (the image and the draft fields are rendered as the two sides of
  one call). Evidence: `grep -n "disabled" app/admin/intake/*.tsx` -> **no matches (exit 1)**, and
  `grep -n "busy"` returns only DropZone.tsx:25,30,71 and page.tsx:197 - the flag changes a heading
  string and nothing else. Repro: drop/choose photo B while A is being read; if A resolves second the
  panel shows B's image beside A's brand/model/serial_visible, and `Prefill scan-in`
  (AiReview.tsx:138 -> page.tsx:166-172) writes A's serial into the scan-in field the operator is
  matching against B. The panel's own contract (AiReview.tsx:7-13, "BOTH SIDES ARE THE RECORD ITSELF")
  is what this breaks. The base had no guard either, but the base showed no photo and claimed no pair,
  so this job is what makes a mismatch read as one record. Fix is inside the allowed surface:
  early-return in `take()` when `busy`, `disabled={busy}` on the input, and a guard in `aiDraft`.
- **F2: the tail-follow stops following exactly at the 200th record.** `ValidationStream.tsx:52-55`
  (`}, [events.length, pending])`) against `page.tsx:36` (`EVENT_CAP = 200`) and `page.tsx:73`
  (`next.slice(next.length - EVENT_CAP)` clamps `length` at 200). Once the cap saturates, a pure-log
  append leaves BOTH dependencies unchanged, so the effect that runs `el.scrollTop = el.scrollHeight`
  (`:54`) never re-runs and the newest line stays below the fold - which is the exact outcome the
  component's own comment at `:50-51` says it exists to prevent. Reachable on the log-only paths that
  do not flip `pending`: `page.tsx:161-164` (`onSheet`) and the pre-flight refusals `:116-117`,
  `:120-121`, plus `page.tsx:170-171` (`prefill`) when no `pending` change lands in the same batch.
  Derivable by inspection: React compares deps with Object.is, and neither value changes. Fix: depend on
  `events[events.length - 1]?.seq` - the counter the module already carries for exactly this purpose
  (`page.tsx:67-70`) - or on an append counter.

## Minor, recorded but not required

- `DropZone.tsx:23` `const SHEET = /\.(csv|xlsx|xls|tsv)$/i;` is dead: `grep -n "SHEET"` matches the
  definition only. Refusal is decided by MIME alone (`:37`), so any non-image - a PDF, a `.txt` - is
  refused with "Spreadsheet parsing is not wired yet - <name> was not read..." (`:100-101`). It is
  honest about sending nothing, but the word "spreadsheet" is wrong for a non-sheet; the dead regex
  shows a distinction was intended.
- `ValidationStream.tsx:9-13` claims "Every line ... is a real event from a request this page actually
  made: the moment a call is dispatched, the payload's own answer, or the API's own refusal detail".
  Two classes of line are none of those three - the pre-flight refusals (`page.tsx:116-117`,`:120-121`)
  and the prefill line (`page.tsx:170-171`). The lines themselves are truthful; the enumeration in the
  comment is not exhaustive.
- The heading outline lost two levels: "New lot" and "Scan in" were `Heading level="h3" as="h2"` in the
  base and are now `<p className={kickerClass}>` (`page.tsx:214`, `:231`), leaving "Photo intake",
  "Capture" and "Lots" as the h2s. Reads as deliberate (both sit under "Capture"), noted only.
- While a selected lot row holds keyboard focus, `focus-visible:bg-surface-muted` (`page.tsx:42`, which
  compiles to `.focus-visible\:bg-surface-muted:focus-visible`, specificity 0-2-0) beats the selection
  wash `bg-brand-50` (`page.tsx:263`, 0-1-0), so the "this is the chosen lot" cue disappears while the
  ring is shown. J3 carried the same pair, but there the row opened a panel rather than being the
  selector itself. Cosmetic.

## Residual risk this gate did not close

- The in-browser round trip (photo -> `/staff/ai/intake-draft`, and the scan-in POST) is read from
  source and the built artifact only; `/admin/intake` is behind auth, so a served-markup check cannot
  read the live page. The three call sites are byte-identical to the base, so the runtime behaviour
  should be the pre-existing one, but I did not execute it.
- F2 requires a session long enough to reach 200 records (~70 scans at 3 records each) to show; the
  mechanism is certain, the frequency is not the point - the effect is simply absent from then on.
