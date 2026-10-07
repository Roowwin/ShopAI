# ADR 0001 - Architecture baseline

Status: accepted

- Two trust zones (staff / store): separate routers, auth schemes, rate limits, CORS origins.
- Passwords hashed with Argon2id in the app; pgcrypto only for PII column encryption.
- Postgres roles: migrator (DDL only), app (DML only), readonly (reports). App never superuser.
- PgBouncer in transaction mode; the app disables prepared-statement caching (asyncpg/SQLAlchemy).
- Redis: response/catalog cache, rate-limit counters, sessions, job broker.
- Serialized asset model with append-only stock ledger; reservations use SKIP LOCKED.
- Media in MinIO (S3-compatible) served via CDN; never in Postgres or the API image.
- Hosted payments only; no card data touches our systems (PCI SAQ-A).

Targets: p95 < 200 ms API, 300 req/s peak, 99.9% availability, RPO <= 5 min (RTO: confirm).