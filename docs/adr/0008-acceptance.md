# ADR 0008 - Owner acceptance recorded 2026-10-11
1. OUTWARD GRANTABLE: confirmed with eyes open - a granted agent turn may set a public price and publish a serialised device to the live storefront with no human click. Blast radius accepted as written.
2. CAPS COVER ADMIN/MANAGER TOO: confirmed (deliberate departure from the CHAT_DAILY_CAP exemption - the most powerful identity is not the uncapped one).
3. PRECONDITIONS ARE A GATE NOT A CHECKLIST: confirmed - no grant is enabled until all eight are built and verified, and the full rehearsal scorecard (including cross-worker fallback-refusal and agent-turn actor_type cases) is pasted and archived.
4. REVOCATION IS NOT RECALL: confirmed - disabling a grant stops the NEXT execution; already-published devices and already-set prices are not undone.
Additional review notes adopted: Precondition 5 closes at BOTH the edge (16k nginx cap) and the dispatch schema; the rehearsal scorecard also pins the fails-after-mutation refund boundary (or proves it not reachable and records why).
STATUS: ADOPTED AS DESIGN - no grant is enabled; propose-only stands everywhere until the precondition build completes and the rehearsal evidence is archived.