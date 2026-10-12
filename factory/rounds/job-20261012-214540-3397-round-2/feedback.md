# feedback — round 2, job job-20261012-214540-3397

Decision: ESCALATE (architect CHANGES / performance PASS / security PASS).
Round-2 verdicts in full: `architect.md`, `performance.md`, `security.md` beside this file.

**Every round-1 fix was verified real and is closed.** The architect re-derived all four from source
and the built sheet: the three doors, the ticket checked before every post-await write, `r === null`
unreachable-as-a-response (`apiFetch` is `Promise<Response>` and a `Response` is always truthy), the
`tail` dependency rising past the cap (`page.tsx:79` increments, `:84` clamps keeping the NEWEST),
`SHEET` genuinely referenced, five h2s in the built HTML, and byte offsets confirming the `!important`
(18997 vs 19115 — the entire sheet has exactly three `!important`, all in that one rule). The
complement test is clean in both directions on the FINAL sheet
(`bde54a820760053a.css`, 32,262 B); `.grow`, `.shadow`, `.invisible`, `.outline` are all absent.
Function preservation remains exact. Do not regress any of it.

## REQUIRED

### F1 (blocking) — the door has one unguarded exit, and it is worse than base
`page.tsx:182` `const d: Draft = await r.json();` sits OUTSIDE the try/catch (which wraps only the
`await apiFetch` statement at `:167-171`), and `draftLive` is cleared only at `:175`. A 2xx whose body
fails to parse therefore escapes `aiDraft` while the door is still non-zero:

- every later photo is silently dropped at `:154`, with **no line in the record**;
- `aiBusy` stays true, so the input is permanently `disabled` (`DropZone.tsx:107`), `take()` refuses
  every drop (`:56`), and the zone keeps announcing "Reading the photo..." (`:93`) with nothing out;
- `pending` stays set, so `ValidationStream.tsx:90-95` keeps rendering "waiting on
  /staff/ai/intake-draft".

Recovery is a page reload. **Base was recoverable** — `grep -n disabled` on the base tree is empty and
`busy` only changed a heading — so the guard is what turned a mislabelled heading into a brick. The
invariant is written in your own comment at `:163-165`; the code does not enforce it. The round-2
architect calls this blocking, and it is right to: this job introduced the severity.

Trigger reachability, stated honestly (round-2 security and performance measured this, and it is why
they recorded rather than blocked): FastAPI returns JSON for this endpoint, nginx has no
`error_page`/`proxy_intercept_errors` rewrite on the api server, and default `proxy_buffering` turns a
mid-stream failure into 502/504 rather than a truncated 200 — so no component of this stack produces
it today. It is still a real hole in the guard, and it is one line.

**Fix:** the idiom already exists in the same file (`:112`, `:134`) —
`const d: Draft | null = await r.json().catch(() => null);` with the null case reported like the
`r === null` branch. Or move `:174-175` into a `finally`. Either is fine; pick one and say which.

**Then prove it, because the whole finding is about an unchecked exit path:** enumerate EVERY exit
from `aiDraft` — the re-entrancy return (`:154`), the superseded return (`:174`), the request-threw
branch, the non-OK branch, the parse-failed branch, the success branch — and show for each that the
door ends at 0 and `aiBusy`/`pending` are cleared. A `finally` that clears them is the shape that
makes the enumeration trivially true; say so if you choose that.

### F2 — F5 recurs: the enumeration is wrong by one
`ValidationStream.tsx:11` says "the two things the page decides on its own". This commit added a
**third** local line — `page.tsx:180` `"Draft not sent: the request could not be made."`. Its list of
pre-flight refusals is right; the count is wrong. `grep -n 'log("' page.tsx` → 14 sites (dispatch
109/131/160, payload answer 117/138/184, API refusal detail 121/144/189, pre-flight refusals
127/128/199, prefill 209, and 180 uncovered).

Fix: "two things" → "three things", and re-check the OPERATOR-VISIBLE string at
`ValidationStream.tsx:98` ("Fed only by the calls this page makes.") for the same inexhaustiveness —
the record also carries the page's own refusals and the prefill. Reword it to something true.

## RECORDED — cheap, make the claim true or stop making it

### R1 — "The kicker look is kept" is four of five dimensions
`page.tsx:257-260` claims the kicker look is kept, but the restored h2 renders
`text-sm font-semibold !text-eyebrow uppercase text-ink-500`: `.\!text-eyebrow` carries no weight, so
the heading is semibold while `kickerClass` on the same page renders at 400
(`ValidationStream.tsx:68` "Activity" — `.font-semibold` is the only weight source). Either add the
weight reset so the look really is kept, or reword the comment to state the change. State which you
chose — and if you add a class, re-run the complement test (`!font-*` is exactly the kind of token
that can emit a rule nobody calls).

### R2 — recorded, not required
`disabled={busy}` drops focus to the document body if the input is focused as a call starts. No trap;
Tab recovers. Recorded so it is not rediscovered as a defect.

## NOT REQUIRED — do not expand this round
- `Scan` (`page.tsx:286`) and `Create lot` (`page.tsx:272`) remain unguarded exactly as at base
  `7270547`. Unchanged ruling: a later job's problem, not this one's.
- The dead rules emitted from bare utility nouns in OTHER files' comment prose (`filter`, `visible`,
  `ring`, `collapse`, `transform`, `backdrop-filter`) are outside this job's allowed surface.
- The superseded-response check at `:174` is unreachable while the door at `:154` holds. Keep it —
  belt-and-braces, and the architect verified it is placed correctly.

**This round is about convergence.** If you find anything further, record it in your report rather
than fixing it. Two items, both small: fix them, prove the exit-path enumeration, and stop.

## Before you hand back
- Rebuild with the REAL exit status (redirect to a file, read `$?`; never a pipe) and report the
  route count and the new sheet name/size.
- Re-run the complement test on the BUILT stylesheet in both directions; re-run the four-dimension
  audit for anything you changed (including anything an added class introduces).
- Backend gate: `docker compose build api`, then `docker compose run --rm api pytest -q` with the
  three deselects — the in-container ids are `tests/…`, not `apps/backend/tests/…`. Expect
  `125 passed, 3 deselected`.
- LF / no BOM on every touched file: verify the STAGED blob (`git show :<path>`, `blob.count(b'\r')`),
  never `grep -c $'\r'`.
- Commit on the same branch `factory/job-20261012-214540-3397`. Do not merge, do not run
  `factory.ps1`, do not touch `factory/**`, do not remove the worktree.
- State plainly anything you could not verify.
