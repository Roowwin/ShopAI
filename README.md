# RFO - Refurbish & Commerce Platform
Production-first platform for serialized refurbishment stock: FastAPI + PostgreSQL 16 (PgBouncer, WAL archiving) + Redis + Next.js.

- apps/backend     FastAPI (two trust zones: staff/store), ARQ worker
- apps/backoffice  Next.js staff portal (TOTP-gated)
- apps/storefront  Next.js public store (ISR)
- infra/           nginx, postgres, pgbouncer, redis, observability
- docs/            ADRs, security + go-live checklists
- loadtests/       k6 scenarios

Evidence (measured, not asserted): k6 p95 78.83ms @ 2x load (100% checks); pgbench 3564 tps; restore drill round-trips 5000+ assets.
