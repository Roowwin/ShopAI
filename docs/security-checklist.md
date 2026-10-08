# RFO security: threat model + pen-test checklist (Phase 8)

## Trust boundaries (proven by gates, not by belief)
- Edge: nginx terminates TLS (mkcert dev CA); three rate zones (store 20r/s, staff 10r/s, login 10r/m); security headers + CSP per zone.
- API: two trust zones (staff/store) - separate routers, token types, cookie scopes; cross-type tokens rejected.
- DB: three roles (migrator DDL / app DML / ro SELECT-only); Postgres unreachable from host; app cannot touch audit_log or ledger beyond INSERT; asset+lot state machines enforced by triggers.
- Sessions: Argon2id hashes; refresh rotation with replay -> ALL sessions revoked; httpOnly Secure zone-scoped cookies.
- Payments: HMAC-signed webhook, idempotent processing (replay-safe); no card data (PCI SAQ-A with hosted provider).

## Known gaps (tracked)
- PII column encryption (pgcrypto) on phone/address/tax fields - Phase 11 data model work.
- CSP with nonces + no unsafe-inline for production (Phase 10; dev HMR needs eval).
- Real payment provider (Stripe) instead of stub HMAC - payments milestone.
- Backups/restore drills + observability - Phase 9.
- Load/soak + browser E2E - Phase 10.

## Pen-test checklist (manual, at staging)
[ ] Login brute force blocked by login zone at the edge
[ ] Reused refresh token revokes all sessions (test exists)
[ ] Staff token rejected on store endpoints and vice versa
[ ] rfo_ro login cannot write anywhere (test exists)
[ ] CSP blocks external scripts (browser console attempt)
[ ] Webhook with bad signature -> 401 (test covers bad sign)
[ ] Serial numbers never exposed beyond last 4 in public API
[ ] Rate limits effective per IP; no bypass via headers (X-Forwarded-For trusted only from compose network)
[ ] .env absent from git history (verified by sweep below)
[ ] Admin password never in chat/logs after Phase 6 rotation
