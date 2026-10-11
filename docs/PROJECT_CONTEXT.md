# PROJECT_CONTEXT.md - RFO Platform (handover v5 - job 2 closed: deal-of-month)

## START HERE (read fully, then docs/state.md, then docs/factory-pilot.md + ADRs; evidence-first)
1. Branch phase11-ai, current with origin. Pilot merge 1041cc5; job-2 (deal-of-month) merged after 2 rounds (round-2 commit bf51a47 + merge); all pushed.
2. LIVE & VERIFIED:
   A. Phases 0-10 (tag v1.0.0-golive-ready) + Phase 11 AI co-pilot + CMS + storefront (see docs/factory-pilot.md and state.md 11b-11e lines for detail).
   B. FACTORY: TWO jobs approved+merged. Pilot job-20261011-101451-1281 (content pages /faq /contact /grades /returns + footer/nav). Job 2 job-20261011-122535-6360 (deal-of-month CMS pin: staff_ops home PUT + public home-content serializer + backoffice CMS input + storefront DealOfMonth.tsx card) - went through a REAL rework: round-1 CHANGES (stockless product published null-price card) -> ESCALATE -> rework -> INNER JOIN fix proven sufficient via 0006 chk_listed_has_price -> hermetic pytest with finally-resores - all states (unset/blank-slug/bad-slug/stockless) absent, payload integrity asserted; regression-proof recorded (test fails on reverted code).
   C. Gate policy (authoritative, in docs/factory-pilot.md): FOUR deselects (2 LLM-flaky assistant tests + 2 hand-seeded count-assert tests); post-6360 counts: 28 passed 4 deselected; ALWAYS docker compose build api before gate runs (api image bakes code, no bind-mount). Hermetic fixture pattern exists in-suite (test_guest_checkout_to_paid) - rewrite drift tests to it: backlog.
   D. Builder runtime: ollama launch claude in worktree (deepseek-v4.1-flash:cloud default; gpt-oss:120b fallback). Builder SELF-COMMITS before reporting. Feedback substance goes INLINE in the builder prompt (feedback.md = trail only). Reviews = manual (architect/security/performance verdict files; claude -p path unoperational; ccr unused plan B).
   E. Worktree protocols: ff-sync before referencing committed files; Copy-Item .env into new worktrees; CLOSE builder session before approve; job committed on branch before approve; worktree pytest shares ROOT postgres.
3. NEXT: backlog REVISED - job 3 = newsletter (auth-free: subscribe endpoint + dedupe + admin view + footer form; fits factory size). Wishlist MOVED after customer-auth design (wishlist needs customer identity; guest-only checkout today - design doc first, then factory). Then reviews/blog-cms. Also: rewrite 2 drift tests hermetic; admin CMS slug-feedback hint (nice-to-have).
4. KNOWN DEBTS: go-live fact-check of content-page business copy before real customers; phantom assets 5155/5156 scrap; admin@rfo.local rotation; media real-upload; storefront tsc baseline diagnostics; Ollama cloud context limit undisclosed; /api/tags probe pending; no secrets in git (re-verified).

## STANDING RULES (full, carried from v3 + today)
- PS 5.1: [IO.File]::WriteAllText + UTF8Encoding($false), LF/no-BOM; NEVER Set-Content/Out-File; never name PS vars $home/$args/$error/$host. 2-arg WriteAllText = UTF8 no-BOM by .NET default.
- $var: inside double-quoted strings = drive-qualified syntax -> ${var}: or here-strings. Content carrying quotes/& -> SINGLE-QUOTE here-strings (@'...'@), never inline "...".
- cmd/native args strip embedded double quotes (3x burned): single quotes / Read-Host / here-string-into-FILES, never console JSON.
- Small per-file pastes + checkpoint prints; big multi-command pastes mangle (evidence: junk file from split paste). Parser aborts whole batch on parse error.
- Long outputs: git --no-pager. Verify backend edits: docker compose run --rm api python -c "import app.main; print('IMPORT OK')". After api/worker recreate: restart nginx. Raw .NET IO uses process CWD (Join-Path (Get-Location)).
- SQLAlchemy text() + asyncpg: NO :param::TYPE casts inside text() - branch in Python.
- Never re-run root phase*.ps1 installers. Role/identity from JWT+DB only. Nothing executes without human Confirm; memory = context, never authority; fallback local model executes READ-ONLY. Privacy: ai.* view data + aggregates only; Ollama Cloud = data leaves premises.
- Evidence-first: agent chat = testimony; gates verified in PS terminal; two-terminal discipline (agent=work, PS=proof).

## COMMANDS
- factory: .\factory.ps1 -Action next -Title '...' | review | decision | approve | rework -JobId -Note '...'
- JOB GATE: docker compose build api && docker compose run --rm api pytest -q --deselect "tests/test_assistant.py::test_assistant_proposes_without_writing" --deselect "tests/test_assistant.py::test_assistant_executes_scan_in" --deselect "tests/test_storefront_api.py::test_catalog_from_seed_stock" --deselect "tests/test_storefront_api.py::test_search"
- builder: cd factory\worktrees\<id>; ollama launch claude (banner: model + CWD check) -> smoke -> build prompt
- up/down.ps1 | rebuild backend: build api worker; up -d api worker; restart nginx | migrations: compose --profile tools run --rm migrate alembic upgrade head
- storefront restart = full npm build (2-4 min) | model switch: .env AI_CLOUD_TEXT_MODEL
- PS-safe capture: [IO.File]::WriteAllText("last-pytest.txt", (($cmd out) -replace "`r`n","`n"))

## REGRESSION DRILL (5 min)
Step 0: four content pages render + footer links + header FAQ. Then: deal set in /admin/cms -> card above New arrivals w/ $279.00 -> cleared -> gone. Then: chips -> proposal -> Confirm (audit row) -> asset_details serial AND id -> clear messages -> role verified + role-claim refused -> CMS hero edit -> category chips -> image URL -> card render.

## JOB-3 SPEC DRAFT (fill Deliverable/Acceptance after -Action next)
newsletter: store public POST /store/newsletter/subscribe (email validate + dedupe, audited table); backoffice /admin view of subscribers; storefront footer email form + success state. No auth; no PII beyond email; rate-limit reuse of nginx zones. Acceptance: dedupe works, admin sees list, gate 28/4 green, prod builds green.

## KEY PATHS
v4 list valid + NEW: apps/storefront/app/components/DealOfMonth.tsx; factory/rounds/job-20261011-122535-6360-round-{1,2}/. No secrets included. - End -