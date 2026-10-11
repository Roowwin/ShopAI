# architect review round 1

Manual reviewer. Base e17d8f3; commit 76af5e7. Gate: 29 passed / 4 deselected on freshly built image. Backoffice prod build red at BASE (assistant/page.tsx:125 pre-existing) - ruled accepted; surfaces clean.

VERDICT: PASS
- Migration 0009 additive-only + reversible; schema matches spec.
- Endpoint idempotent, no existence oracle; regex validation; 422 paths proven.
- Notes recorded to hygiene lane: (1) GET /staff/newsletter offset/limit need ge=0 bounds (negative params currently 500 instead of 422); (2) trailing-newline style (pre-existing pattern); (3) assistant:125 null-guard fixes the base-red; (4) no pagination UI yet (fine at scale).
