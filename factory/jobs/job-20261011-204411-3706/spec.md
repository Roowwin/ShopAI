# backend: sweep accumulated test lots + stop the leak, and drop stale nginx .bak files

## Context
Two pieces of accumulated debris, neither of which breaks anything today but both of which get worse with every
gate run.

**1. Test lots accumulate in the shared dev DB.** Measured 2026-10-11: **589 intake lots, 476 with notes exactly
`pytest`, 582 with the `pytest` prefix**, 127 of them empty — out of 1395 lots total. Every run of the suite adds
more, because the tests that create lots do not remove them. This already caused a real incident: combined with a
plain FK from `agent_tokens.staff_id`, a single leftover row turned every suite's `DELETE FROM staff_users WHERE
email LIKE 'pytest-%'` into a foreign-key failure and produced 10 unrelated test failures. The FK is fixed
(`ON DELETE CASCADE`); the debris is not.

**2. Stale tracked backup files.** `infra/nginx/templates/rfo.conf.template.bak`, `.bak2` and `.bak3` are tracked
on this branch and pre-date the agent-identity job (flagged by its reviewer). They are almost certainly hand-made
backups from an earlier job that should never have been committed.

## Deliverable

### 1. `apps/backend/scripts/sweep_test_lots.py` (new)
A **dry-run by default** sweeper (`--apply` to actually delete) that removes only debris, with the filter stated in
the code and in its output:
- **Only** `lots` with `status = 'intake'` whose `notes` match a test/probe pattern (`pytest%`, anything containing
  `probe`, and the two known strays `edge cap probe` / `pytest role-claim probe`).
- **Never** a lot in any other status (`active`, `completed`, `cancelled` are real inventory history), and **never**
  a lot with any `assets` row, whatever its notes.
- Parameterised SQL via the house engine; prints the counts it would delete, grouped by the pattern that matched,
  and exits non-zero if it finds a matching lot that also has assets (that is a safety alarm, not a normal case).
- Idempotent: running it twice deletes nothing the second time.

### 2. Stop the leak
Find the tests that create lots and do not clean them up (the 476 `pytest`-noted rows are the evidence), and give
them the house `finally` cleanup the sibling suites already use. Report **which test files leaked and how many lots
each created** — that number is the leak rate per gate run. If a test deliberately needs a lot to persist for
another test to read, say so and leave it; otherwise clean it up.

### 3. A test that proves the sweeper is safe - `apps/backend/tests/test_sweep_safety.py` (new)
This is the part that matters, because the script deletes rows on a shared DB. Create, in a rolled-back or
explicitly-cleaned transaction:
- a matching **empty intake** lot -> the sweeper deletes it;
- a matching lot that **has an asset** -> the sweeper **must not** delete it (the safety case);
- a matching lot in a **non-intake** status -> the sweeper **must not** delete it;
- a non-matching intake lot -> untouched.
Assert the script's selection function directly (import it), so the test does not depend on running the CLI.

### 4. Run the sweep
Dry-run first and **report the counts**, then `--apply` and report before/after. Note that `audit_log` rows
referencing those lots are append-only and stay — that is expected, not a leak.

### 5. Remove the stale backups
Confirm `infra/nginx/templates/rfo.conf.template.bak{,2,3}` are referenced nowhere (grep the repo, including
`docker-compose.yml`, `infra/`, `scripts/`, `docs/`), then delete them. If anything references one, **stop and say
so** rather than deleting.

## Acceptance
- `docker compose build api` then the gate green (from the **root tree**, worktree mounted):
  `MSYS_NO_PATHCONV=1 docker compose run --rm -v "<worktree>/apps/backend:/app" api pytest -q` - report the count
  before and after. **Do not run it concurrently with anything else**: two overlapping pytest runs corrupt each
  other's results on the shared DB.
- The sweeper's dry-run output, then the before/after counts across the apply.
- The safety test's four cases, quoted.
- The leak report: which test files created lots without cleanup, and how many per run.
- `grep` evidence that no `.bak` file is referenced, then the deletion.
- Allowed surfaces: `apps/backend/scripts/**`, `apps/backend/tests/**`,
  `infra/nginx/templates/rfo.conf.template.bak{,2,3}` (delete only). Anything else = **CHANGES**.

## Constraints
- Work only on branch `factory/<job-id>` (worktree provided) - LF / no BOM; PS 5.1 write rules
- Do NOT touch: `.env`, `secrets/`, `infra/nginx/conf.d/**`, `infra/nginx/templates/rfo.conf.template` (the live
  template - only the `.bak*` files are in scope), `alembic`, `factory/*`, `apps/**` outside `apps/backend`
- No migration: this is a data sweep plus test cleanup, not a schema change.
- Be careful with a destructive script on a shared DB: dry-run by default, and prove the safety filter before
  applying it.
