# Factory pilot - job-20261011-101451-1281 (content-pages) - CLOSED 2026-10-11

Result: APPROVED + MERGED (merge 1041cc5 on phase11-ai, pushed). Storefront rebuilt; /faq /contact
/grades /returns live (static 136 B); footer links all four; header nav has FAQ; regression drill passed.

Chain exercised: next -> builder via "ollama launch claude" (deepseek-v4.1-flash:cloud, interactive,
in worktree) -> build (uncommitted) -> review scaffold -> manual verdicts round-1 (architect CHANGES /
security PASS / performance PASS) -> decision ESCALATE -> rework via feedback.md -> round-2 PASS x3 ->
decision APPROVE -> approve (git add -A + commit rounds + merge --no-ff + worktree remove).

Gates: deterministic 29/29 via --deselect of the two lot-dependent assistant tests
(test_assistant.py::test_assistant_proposes_without_writing, ::test_assistant_executes_scan_in -
both call a live LLM mid-test, stochastic). Full 31/31 also observed multiple times; single flake
runs per test documented (30/31). Storefront prod build green in worktree and at root; tsc satisfied
by strict build. Backend untouched by the job (storefront-only).

factory.ps1 bugs found and fixed (committed 7114945 + this session):
- decision/approve hardcoded round-1 -> rework loop could never converge; now round-aware.
- "reviewer $role:" parse bug ($var: in double-quoted string = drive-qualified syntax) -> ${role}.
- --permission-mode acceptEdits--model sonnet flag mash -> spaced.
- review crashed when claude off PATH -> graceful manual-reviewer fallback.

Protocols born (state.md gets these):
- Close the builder session BEFORE approve (open CWD locks the worktree on Windows).
- Job must be committed on its branch BEFORE approve.
- Before handing the builder instructions referencing committed files (feedback.md/spec/backlog),
  ff-sync: git -C factory\worktrees\<id> merge --ff-only phase11-ai.
- Worktrees lack ignored files -> Copy-Item .env in whenever a worktree is (re)created.
- Builder chat = testimony, not evidence; gates verified in PS terminal only.
- Reviewer base branch is phase11-ai (template "main" is generic).

Open audit items:
- scan_in execute-path lot-existence validation question; DB truth of LOT-2026-0002 unpinned.
- /api/tags model probe pending (ids seen via launch banners: deepseek-v4.1-flash:cloud, gemma4:31b-cloud).
- Compose project name baked in yml -> worktree test runs share the ROOT postgres volume.

Post-pilot policy updates (job 2 = deal-of-month):
- Official gate: TWO deselects, both the LLM-stochastic assistant pair. Post-6360 it was FOUR (those two plus test_catalog_from_seed_stock/test_search, which read hand-seeded stock and drifted with real orders); both were rewritten hermetic on 2026-10-16 and came out of the list. Post-6360 full count: 28 passed 4 deselected (measured in the then-shared `rfo` database); in `rfo_test` today: 349 passed, 2 skipped, 2 deselected.
- 2026-10-16 - THE GATE MOVED TO ITS OWN DATABASE (`rfo_test`, docker-compose.test.yml service `api-test`). Four deselects UNCHANGED; count 347 passed / 2 skipped / 4 deselected; provision+migrate runbook in PROJECT_CONTEXT.md COMMANDS. The suites used to write into `rfo` and could not clean up (no DELETE grant on stock_movements -> the FK pinned every unit a test scanned in -> immortal mission-*/pytest* products in the operator's catalogue). The two seeded-stock tests are NOT rescued by the fresh database: 0002_seed leaves its products 'draft' where the storefront needs 'active', and earlier tests in the same run buy the seeded units - rewrite-them-hermetic stays backlog.
- ALWAYS run docker compose build api before gate runs - the api image bakes code (no bind-mount); gate numbers on a stale image are meaningless.
- Hermetic fixture pattern already exists in-suite (test_guest_checkout_to_paid builds own lot/asset); DONE for the two drift tests on 2026-10-16 - they build their own product/lot/listed units and window the catalogue read on their own token, so an accumulating test database cannot walk out from under them.
- Builder self-commit protocol verified (round-1 8bc7549, round-2 bf51a47, Co-Authored-By Claude). Feedback delivery: put substance INLINE in the builder prompt; feedback.md is for the trail, not the transport.