VERDICT: PASS

Round-3 rework reviewed as `git -C <worktree> diff 49cbea7..ef5f7c6` (66 insertions / 36 deletions, two files;
the job diff 7270547..HEAD is still the same 5 files, no `package.json`/lockfile). I re-derived the concurrency
shape from the source, not from the builder's report, and re-ran the round-2 harness against the new shape.
`try/finally` closes the round-2 R1 brick and no exit leaves the door shut. One residual is restated and judged
acceptable to land (R1 below). Every number is measured or simulated.

## 1. The `try/finally` — every exit enumerated, by simulation

I transcribed page.tsx:148-214 verbatim (control flow, the door guard, the finally) into a node harness with a
fake `apiFetch`/`json()`, boxed refs and immediate state assignment, and drove each exit. Output (`sim.js`):

| exit | site | result | aiBusy | pending | door | err |
|---|---|---|---|---|---|---|
| success | :202-204 | `ok` | false | null | 0 | "" |
| transport threw (r===null) | :180-185 | `not-sent` | false | null | 0 | "the draft request could not be sent" |
| `!r.ok`, JSON detail | :187-191 | `refused` | false | null | 0 | detail kept |
| `!r.ok`, `json()` rejects | :188 | `refused` | false | null | 0 | "AI draft failed" |
| **2xx, body not JSON (round-2 R1)** | :196-200 | `unreadable` | false | null | 0 | "the draft answer could not be read" |
| 2xx, body null | :196-200 | `unreadable` | false | null | 0 | same |
| re-entry (:154, before the try) | :154 | `refused-reentry` | unchanged | unchanged | owned by live call | — |

- **No exit leaves `pending` or `aiBusy` set.** All six exits that reach the try clear both in the finally
  (:208-212); the two that do not (the re-entry return and any pre-try work) never took the door, so the flags
  belong to the live call, whose own exit clears them. 5 drops while the first call is out (S7): **requests=1,
  `keepPhoto`=1, refused re-entries=5, ends clean**.
- **A superseded call's finally does NOT clear the newer call's markers.** Forced the race (S8: door ref set to a
  newer id at the await boundary): the older call returns `superseded`, its finally fails the `draftLive.current
  === me` guard, and the newer call's `aiBusy=true` / `pending="/staff/ai/intake-draft"` / door value all survive
  (`newerMarkersIntact=true`, `liveStillNewer=true`). Belt-and-braces: with the door holding at :154 this branch
  is unreachable (round-2 R2), and it is placed correctly.
- **The door cannot be cleared twice, and never by a non-owner.** `if (draftLive.current === me)` (:208) is the
  only writer of 0 after :156; `me` is unique per call (`++draftSeq.current`), so exactly one call clears it.
- **The finally cannot throw before clearing.** It has no `await`, no dereference and no call that can reject;
  and the door write (`draftLive.current = 0`) is ordered **first**, ahead of the two React dispatches. Forced
  the last dispatcher to throw: `{threw:"clear threw", doorCleared:true, pendingCleared:true}` — the door is
  already open even on that (unreachable) path. React dispatchers do not throw; a plain ref write cannot.

## 2. The parse-failed branch (:196-201) — clean, single-report, single-clear

It exits through the same finally (`return` at :200 → finally at :205). Simulated on a 2xx whose `json()`
rejects (S5) and a 2xx whose body is `null` (S6): `aiBusy=false, pending=null, door=0, err` set, **exactly one
setErr and one WARN line per call** (`logs` length 2 for every exit — the dispatch line plus the outcome; no
double-report), and the clear runs once. This is the round-2 R1 brick, now closed: the previously unguarded
`const d: Draft = await r.json();` is now a guarded read (`.catch(() => null)`) with its own reported exit.

## 3. Re-measured — what the round could have disturbed

- **Timers: zero; listeners: zero.** `grep -n 'addEventListener|setTimeout|setInterval|requestAnimationFrame|
  cancelAnimationFrame'` over the four intake files returns exactly two lines — AiReview.tsx:62 (create) and
  :63 (cancel). No file in the round-3 diff touches that effect.
- **rAF fade + cancellation, object URL, dep arrays, mount fetch — untouched by this round.** The round-3 diff
  changes only page.tsx:160-213 + :275-288 and ValidationStream.tsx:9-30 + :99-105. So `[tail, pending]`
  (ValidationStream.tsx:68), `[draft]` (AiReview.tsx:64), `keepPhoto`/unmount revoke `[]` (page.tsx:91-98) and
  `load = useCallback(…, [])` with `useEffect(() => { load(); }, [load])` (:100-104) are byte-for-byte round 2
  → the mount fetch still fires once.
- **The `tail` dep still fires past the 200-cap.** Re-ran the reducer (:82-85) + dep (:64) simulation on the
  changed file: **205 of 205 appends fire** (at append 201 the list length is pinned at 200 while `tail` moves to
  201 — `lenAt201=200, tailAt201=201`), and **1000 of 1000** at n=1000. Retention stays exactly the newest 200
  (`6..205`, `801..1000`); `seq` keys remain unique (`keysUnique:true`).
- **Bounded re-render cost, unchanged and not grown.** Worst case ≈200 `<li>` × 3 `<span>` + the wrapper/section
  ≈ 606 log nodes, plus ≤50 lot rows × ~5 nodes ≈ 250. Round 3 adds no per-render work; the footer paragraph
  changed text, not element count.
- **Chunk and first-load.** Route chunk `page-1703ae56506e214d.js` = **22,621 B** (round 2: 22,323 B → +298 B,
  the new branch + its two strings). Manifest first-load `/admin/intake/page` = **373,534 B** across 5 files
  (round 2: 373,236 B → +298 B). Every sibling route is byte-identical to round 2 (`/admin/assets` 376,973 B,
  `/admin/dashboard` 372,767 B, `/_not-found` 353,583 B) → the shared chunks did not move; the delta is the
  intake route chunk alone.
- **No `transition-all`, no new dependency.** 0 occurrences in the sources and 0 in the built sheet (which
  carries only `.transition-colors`, `.transition-opacity`, `.transition-transform`); the diff lists no
  `package.json`/lockfile.

## 4. The stylesheet-identity claim — CONFIRMED from the artifact

`.next/static/css/bde54a820760053a.css` = **32,262 B**, **454** rule blocks, name and size both identical to
round 2. Next content-hashes this filename, and the round-3 diff adds or removes **no class token** — the only
`class` matches among the diff's `+`/`-` lines are the word "class" inside the rewritten comment
(`…the primitive's class is the later one`, page.tsx:278). Same name + same size + same rule count + no class
change ⇒ the sheet is content-identical to round 2. **This round added no CSS, so there is no new CSS cost to
measure.** I found no second copy of the sheet on disk to byte-compare against; the three independent
invariants above are what the claim rests on, and I state that plainly.

## 5. The recorded residual — acceptable to land

**R1 (recorded, accepted).** `pending` is a single unowned slot: the draft's finally writes `setPending(null)`
without ownership (:210), and `createLot`/`scanIn` (:113, :135) set and clear it unguarded. Simulated: with a
create in flight (`pending="/staff/lots"`) a draft finishing drives it to `null` **while the create is still
out** (`residual: create in flight -> /staff/lots` → `draft finished -> null`), and a rejected create/scan that
throws leaves its marker showing. Effect is confined to the "waiting on …" line in the record: it is
display-only, it cannot mis-sequence a call, the create's own completion is unaffected, and the marker vanishes
by itself the moment the create ends. Both functions are the two the round-1/2 reviewers explicitly ruled out of
scope for this job. **Landing it as a recorded residual for a later job is correct** — the round is about
convergence, and this costs one line when a future round owns those functions.

One noted non-finding: the door is taken at :156 one statement before `keepPhoto` (:158), which is outside the
try — a synchronous throw there would strand it. It is unreachable: `keepPhoto`'s only throwing call is
`URL.createObjectURL` on a non-Blob, and DropZone.tsx:57 only calls `onPhoto` with a `File` whose type starts
`image/`. Not worth changing.

## Not verified, stated plainly

I did not run docker (per instruction), so there is no live-route check and no backend gate from me; every number
above comes from the worktree's existing build output and from code run locally (node simulations). The build is
the round-3 tree: the route chunk contains round-3-only strings ("Draft unreadable", "the draft answer could not
be read", "Fed by this page's own calls") and `git status --porcelain` is empty against HEAD. I edited no file
other than this verdict. The verdict file was absent on arrival; I created its directory.
