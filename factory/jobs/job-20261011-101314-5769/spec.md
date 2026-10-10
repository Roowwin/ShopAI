# content-pages: FAQ, Contact, Our Grades A-D, Returns/Warranty pages

## Context
Read factory/backlog.md section for the why. Read docs/PROJECT_CONTEXT.md standing rules.

## Deliverable
(describe files to create/change)

## Acceptance
(list of checks the reviewers + pytest must verify)

## Constraints
- Work only on branch factory/<job-id> (git worktree provided)
- LF / no BOM; PS 5.1 write rules
- Run: docker compose run --rm api pytest -q   (must be green)
- Do NOT touch: .env, secrets/, infra/nginx/certs/