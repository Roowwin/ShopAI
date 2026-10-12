# decision job-20261013-010413-1038

MODE: FAST LANE — the owner authorised self-approval on automated gates only (2026-10-12).
**No architect, security or performance round ran for this job.** There are no three-lens verdict
files in this round directory, and this record does not pretend otherwise.

DECISION: APPROVE (on the automated gates below, per the fast-lane authorisation — not as the
result of a review round)

COMMIT: `ea54d06` on `factory/job-20261013-010413-1038`. 6 files.

## The find that shaped the job

`rfo_assets_check_status` (read straight out of `pg_proc`, not inferred) admits
`tested -> graded` and **refuses `received -> graded`**. A lot of freshly scanned units is entirely
`received`, so a workbench that simply set `graded` would 409 on every single row — the brief's
central action, dead on arrival. The one rung had to be walked, and the job's design question was
where to put that walk and who may take it.

Answer: server-side, in the existing `grade` handler, behind an opt-in `test_first` flag.

## The authorization call, stated plainly

`test_first` is available only to a role-holder acting on its own behalf, and it is refused outright
for an agent identity. The reasoning:

- It widens no permission **because the unit never RESTS in `tested`** — the same request continues
  to `graded` in the same transaction. You cannot use it to park a unit in a state the caller's
  role could not otherwise produce; the only reachable end state is `graded`, which the caller was
  already authorised for.
- An agent is different in kind: for an agent, `test` is a separately granted and separately
  audited action (`ACTION_TEST`), so it must be taken explicitly rather than as a side effect of a
  `grade` grant. Refused with a 403 naming the reason.
- `test_first` defaults to **False**, and a test pins that a plain `grade` on an untested unit still
  409s and leaves no audit row — the old contract is unchanged, this is opt-in.

Both rungs are written to the audit trail as separate rows (`test`, then `grade`), so a unit's
history shows the path it actually took.

## Also delivered

- `GET /staff/lots/worklist` — progress counted over the **whole** lot (not the visible slice) plus
  the awaiting-grade queue, capped at 500 with the cut reported. 422 on neither/both of
  lot_id/lot_number, 404 on an unknown lot. Added to `test_staff_read_walls.py`'s sweep.
- `LotWorkbench.tsx` — search, queue, A/B/C/D per row, glowing progress bar reading
  "N of M units graded". Nothing optimistic; a row leaves the queue only on a confirmed response.
- Nav label and page heading "Lot Process"; a segmented Process Lot / New Intake control. The
  intake flows were **moved, not edited** — request expressions, buttons and guards count
  identically against the base (checked mechanically, `/staff/lots` 5=5, `/staff/assets/scan-in`
  4=4, `/staff/ai/intake-draft` 4=4, `Scan` 7=7).
- The route stays `/admin/intake`: the brief scoped the rename to "the navigation and page
  headers", and a URL change would break bookmarks for no gain.

## Gates — run by the orchestrator against this tree

- `docker compose build api` (from the worktree) → exit 0
- `pytest -q` with the three deselects → **151 passed, 3 deselected** (144 + this job's 7 new)
- `npx tsc --noEmit && npx next build` → **NEXT_EXIT=0**, `/admin/intake` prerendered at 8.51 kB

## Caught before the gate

The first build failed at import with `SyntaxError: '(' was never closed` — `await db.execute(...)`
chained straight into `.mappings()` leaves the grouping paren unbalanced. Fixed, and
`python -m compileall` now runs on the touched files before the image build, because a Python
syntax error is invisible to `docker compose build` and only surfaces when the app is imported.

## Not verified

The workbench's rendering, the progress bar's glow, and the two-tab control are unverified without a
browser. The backend behaviour (the ladder, the counts, the guards) is covered by the seven tests.
