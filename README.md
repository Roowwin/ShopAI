# RFO - Refurbish & Commerce Platform

Monorepo:
- apps/backend     FastAPI (staff + store trust zones), worker (Phase 5)
- apps/backoffice  Next.js staff app
- apps/storefront  Next.js public store
- infra/           nginx, postgres, pgbouncer, redis, minio configs
- scripts/         PowerShell automation (added per phase)
- loadtests/       k6 scenarios (Phase 10)
- docs/adr/        architecture decision records

Rules:
- Never commit .env or anything under secrets/.
- Re-running bootstrap without -Force never modifies existing files.
- -Force rotates ALL secrets: run docker compose down -v afterwards.

Setup: run bootstrap.ps1, then follow the per-phase guides.