# RFO go-live checklist (Phase 10)

## Data safety
[x] Nightly pg_dump(-Fc) + roles dumps; 7-copy retention
[x] Restore drill passes (counts round-trip) - runs in Test-Phase9
[x] WAL archiving enabled (RPO <= 5 min per completed segment)
[ ] pgBackRest/WAL-G + streaming replica + failover (production infra)
## Security
[x] CSP/HSTS/frame-ancestors at edge; rate zones proven by burst test
[x] Argon2id + TOTP + refresh theft detection + audit log
[x] Hex-literal secret sweep green
[ ] Real Stripe webhook replaces stub HMAC (payments milestone)
## Performance (evidence, not assertion)
[ ] k6 2x load: p95 recorded below threshold
[ ] pgbench sustained write tps recorded
[ ] Grafana RFO Postgres dashboard attached to release notes
## CI/CD
[ x] pytest + tsc gates in workflow; scans as warnings (strict at go-live)
[ ] Branch protection + PR-required (on first remote push)
## Sign-off
[ ] Restore drill re-run on release-day dump
[ ] Checklist reviewed by second staff member