# daily-ops rehearsal: deterministic safety suite + AI day-in-the-life runner

## Context
Store is seeded and live; staff assistant performs inventory ops behind human Confirm (chat v2, execute flag); store assistant answers customer stock/price questions; two-zone model proven live (job 5). NO rehearsal exists asserting the SAFETY properties across a simulated business day. LLM-content nondeterminism is a documented gate hazard (assistant tests deselected) - so LLM content stays REPORT-ONLY; deterministic safety invariants DO gate.

## Deliverable
1. tests/test_daily_ops.py (new, hermetic, house pattern - own fixtures + finally cleanup): the deterministic business day as scenario tests:
   a. Zone walls: staff token on /store/checkout -> 401; customer token (register+login) on /staff/assets endpoints -> 401; unauthed writes -> 401.
   b. Anti-invention integrity: scan-in N units -> asset count delta exactly N (no more); grade/price visible via GET; move writes audit rows.
   c. Proposal-safety via the assistant: POST /staff/assistant {message: scan-in request} WITHOUT execute -> response type in {proposed, answer} and NEVER executed; asset count + audit-log count unchanged (pilot safety-test pattern, generalized).
   d. CMS daily ops: PUT home set/unset deal_of_month -> GET reflects set; public /store/home-content absent when unset (job-2 semantics); promotions POST -> visible via public promotions route.
   e. Store reads the store assistant relies on: catalog/search return the hermetically created items (own fixtures, never hand-seeded rows).
2. apps/backend/scripts/rehearse_day.py (baked into the api image; runs inside the stack like seed_demo): HTTP-only vs the real API; bootstraps a rehearsal admin; drives a scored business day: intake batch (10 units, A-D mix), deal update round-trip, 2 promos, customer registration + customer-zone reads, and assistant chat: 3 staff-proposal messages (NO execute) + 3 store-side stock questions. Prints a SCORECARD: per-step outcome, proposal type counts, and PASS/FAIL ONLY on the deterministic safety invariants (never-executed-without-flag; zone walls hold; count deltas exact). LLM content choices are reported, never failed. NOT run by the builder (live LLM + shared DB) - owner runs post-merge like seed_demo.
3. NO app source changes, no migrations. If something looks necessary, STOP and ask.

## Acceptance
- Suite passes in the gate (report the new total; 4 deselects unchanged).
- rehearse_day.py: python -m py_compile COMPILE_OK in-image; owner execs the live run post-approve.
- Allowed surfaces: tests (+1 new test file), scripts/rehearse_day.py. NOTHING else = CHANGES.

## Constraints
- Work only on branch factory/<job-id> (git worktree provided); LF/no-BOM; gates AFTER docker compose build api; do not touch .env, secrets/, infra/nginx/certs/, alembic, factory/*.