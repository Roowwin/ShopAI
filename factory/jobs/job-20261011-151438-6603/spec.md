# fix: seeder bearer scoped to /staff (store zone rejects staff tokens - proven live)

## Context
Round-4 defect found by the live acceptance run of the merged seeder: the Api client sends the staff bearer on every call; POST /store/checkout answered 401 invalid token - the two-zone model correctly refuses staff tokens on store endpoints. Tests missed it (they call /store/* headerless).

## Deliverable
apps/backend/scripts/seed_demo.py ONLY: scope the Authorization header to paths starting with /staff - never send it on /store/* paths (reserve/checkout/registers stay headerless guest calls, which is what the house semantics expect). No other behavioral change.

## Acceptance
- python -m py_compile passes inside the rebuilt image (COMPILE OK), LF/no-BOM preserved.
- Gate: 30 passed 4 deselected (unchanged - script-only change).
- The seeder itself is verified by the owner post-merge (live run places orders); report the change and nothing else.

## Constraints
- Work only on branch factory/<job-id> (git worktree provided)
- LF / no BOM; PS 5.1 write rules
- Gates AFTER docker compose build api
- Do NOT touch: .env, secrets/, infra/nginx/certs/, anything but the seeder script