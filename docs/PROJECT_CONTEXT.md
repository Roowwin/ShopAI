# PROJECT_CONTEXT.md - RFO Platform (handover v4 - close of factory-pilot session)

## START HERE (read fully, then docs/state.md, then docs/factory-pilot.md + ADRs; evidence-first)
1. Branch phase11-ai at 1041cc5 (merge factory/job-20261011-101451-1281), PUSHED.
2. LIVE & VERIFIED:
   A. Phases 0-10 (tag v1.0.0-golive-ready) + Phase 11 AI co-pilot (/admin/assistant): chat v2 w/
      memory (6 turns, redacted, TTLs), tools activate_lot/create_lot/scan_in/test/grade/price/
      list/move + read-only asset_details (cost admin/manager only); proposal -> Confirm -> audited;
      owner-class unlimited chats, staff CHAT_DAILY_CAP.
   B. Brains: Ollama cloud text gpt-oss:120b via services/ai.py (think flags, local qwen2.5:7b
      fallback = READ-ONLY, vision gemma3:4b).
   C. CMS: 0008 site_settings + product image_url/featured; staff_ops CMS endpoints audited;
      /admin/cms editor; public /store/{home-content,promotions,categories}.
   D. Storefront: header live search/category nav/cart badge; category pages; home = CMS hero +
      promo + new arrivals + best sellers; product page w/ UnitPicker; cart; NEW content pages
      /faq /contact /grades /returns (ContentPage.tsx layout) + footer links + header FAQ.
   E. FACTORY: pipeline PROVEN on pilot (docs/factory-pilot.md): next -> builder (ollama launch
      claude, deepseek-v4.1-flash:cloud; fallback gpt-oss:120b) -> manual reviews (claude -p/
      sonnet path unoperational, no Anthropic login; ccr bridge unused plan B) -> decision ->
      rework -> round-2 APPROVE -> merge. factory.ps1 fixed (round-aware decision/approve,
      reviewer fallback, flag fix). Gate policy: 29 deterministic tests (deselect 2 lot-dependent
      assistant tests); worktree test runs share the ROOT postgres. Protocols: ff-sync worktree
      before referencing committed files; Copy-Item .env into new worktrees; CLOSE builder session
      before approve; job committed on branch before approve; gates verified in PS only.
3. NEXT: backlog job 2 = deal-of-month CMS pin; then wishlist/newsletter/reviews/blog-cms one at a
   time; hygiene jobs: assistant tests hermetic/mock, scan_in lot audit, compose .bak cleanup.
4. KNOWN DEBTS: go-live fact-check of content-page business copy (support email/hours/warranty/
   freight/GST/thresholds/serial-mask) BEFORE real customers; phantom assets 5155/5156 scrap;
   admin@rfo.local rotation; media upload; storefront tsc baseline diagnostics; Ollama cloud
   context limit undisclosed; /api/tags probe pending; no secrets in git (verified today again).

## STANDING RULES (carry forward from v3 verbatim) + NEW:
- $var: inside double-quoted PS strings = drive-qualified syntax -> use ${var}: or single quotes/here-strings. (earned today)
- Any content carrying quotes or & goes through a SINGLE-QUOTE here-string (@'...'@), never inline "..." literals. (earned today)
- git: use --no-pager habitually; single long here-string statements paste safely, multi-command mega-batches mangle -> per-file blocks + checkpoint prints.
- Worktrees lack ALL ignored files (.env, node_modules); worktree test runs hit the SHARED root postgres.

## COMMANDS
- up/down.ps1 | factory job gate: docker compose run --rm api pytest -q --deselect
  "tests/test_assistant.py::test_assistant_proposes_without_writing" --deselect "tests/test_assistant.py::test_assistant_executes_scan_in"
- factory: .\factory.ps1 -Action next -Title '...' | review | decision | approve | rework -JobId -Note '...'
- builder: cd factory\worktrees\<id>; ollama launch claude --model deepseek-v4.1-flash:cloud (or gpt-oss:120b)
- rebuild backend: build api worker; up -d api worker; restart nginx | migrations: compose --profile tools run --rm migrate alembic upgrade head (0001..0008)
- storefront restart = full npm build (2-4 min poll loop) | model switch: .env AI_CLOUD_TEXT_MODEL
- PS-safe pytest capture: $out = (docker compose run --rm api pytest -q) | Out-String; [IO.File]::WriteAllText("last-pytest.txt", ($out -replace "`r`n","`n"))  (2-arg WriteAllText = UTF8 no-BOM by .NET default)

## REGRESSION DRILL (5 min)
Step 0 NEW: /faq /contact /grades /returns render real copy; footer 4 links; header FAQ.
Then verbatim v3 drill: chips -> proposal -> Confirm (Executed OK + audit row) -> asset_details by
serial AND id -> clear previous messages -> whats my role -> role-claim refused -> storefront hero
reflects CMS edit -> category chips filter -> image URL -> card render.

## JOB-2 SPEC DRAFT (fill Deliverable/Acceptance after -Action next -Title)
deal-of-month: CMS-pinned Deal of the Month slot on home. Extend staff_ops CMS home endpoint + /
admin/cms form (admin/manager, audited) with a single pinned-deal record (title, product ref, badge
copy; likely site_settings row). Home renders a distinctive card above New Arrivals linking the
existing /products/[slug] page with price + image_url. Empty/unset state renders NO block.
Acceptance: CMS edit reflects on home after rebuild; unset hides block; pytest green; green theme.

## KEY PATHS
v3 list still valid + NEW: apps/storefront/app/components/ContentPage.tsx; apps/storefront/app/
{faq,contact,grades,returns}/page.tsx; docs/factory-pilot.md; factory/rounds/<id>-round-N/{architect,
security,performance,decision,feedback}.md. No secrets included. - End -