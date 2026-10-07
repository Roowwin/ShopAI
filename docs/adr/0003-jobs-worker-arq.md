# ADR 0003 - Background jobs: ARQ

Status: accepted

- Async-native, Redis-only broker, minimal ops surface; matches FastAPI event-loop model.
- Rejected: Celery (needs extra infra/options we do not use; heavier ops).
- Outbox drain, reservation TTL release, email, image processing, FTS indexing run here.