# ADR 0004 - Performance targets (confirmed)

Status: accepted

- p95 < 200 ms API | 300 req/s peak storefront | 99.9% availability | RPO <= 5 min | RTO <= 1 h.
- Verified in Phase 10 at 2x load; nginx JSON logs + pg_stat_statements + OTel are the evidence chain.