# hygiene: the gate deselect list moves into config; docs gate-arity reconciled

## Context
The accepted gate = 3 deselects (assistant pair + test_search), but the list lives only in prose (docs state it variously as 2/3/4 across files). Agents re-derive it from memory; a wrong copy = a wrong gate. Counts as of job 13: 91 passed / 3 deselected / 94 collected; the arithmetic cross-check = test-function count.

## Deliverable
1. apps/backend/pytest.ini: addopts with the exact 3 deselects (assistant pair + test_search); the plain invocation pytest -q then equals the gate everywhere.
2. docs reconciliation: every doc that states a deselect list/arity gets updated to the same 3 (PROJECT_CONTEXT.md:26 among them); state the arithmetic method (grep count = passed+deselected).
3. Tests: none needed - the existing suite IS the test (run it and report the count WITHOUT any --deselect flags at all).

## Acceptance
- docker compose build api; pytest -q bare prints exactly 91 passed 3 deselected (or current count at this HEAD) with no flags.
- Allowed surfaces: pytest.ini, docs/*. Anything else = CHANGES.

## Constraints
- Standard; do NOT fix flaky tests by re-seeding; do not touch factory/*, .env, secrets/, infra/.