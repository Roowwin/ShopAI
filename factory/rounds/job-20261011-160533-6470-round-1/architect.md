# architect review round 1

Manual reviewer. commit dfc355d; gate 35 passed / 4 deselected (+4 tests, baseline-disciplined, assistant-invariant test isolated-stable across runs); COMPILE_OK; scripts needed git add -f (.gitignore:39 scripts/ matches nested dirs - hygiene: anchor to /scripts/).

VERDICT: PASS
- test_daily_ops.py: zone walls probed at nonexistent ids (broken wall self-reports without writes); intake batch exact-delta + 409 re-scan + masked-serial assert + search + move-audit; proposal-safety generalized with wrong-side-write counters aimed at fixture-own rows; CMS pin round-trip + offer live/retire with settings restore.
- rehearse_day.py: seed_demo conventions (scoped bearer, one event loop, need() fail-clean, stamp-namespace re-runs); scorecard scores deterministic rows, model content report-only (superset of spec, accepted).
- Surfaced out-of-surface: staff READ endpoints lack auth deps - routed to top hygiene priority.
