VERDICT: PASS

Job job-20261011-181232-6231 (backoffice admin shell + hygiene). Revision reviewed: 1a8a718 (full job) and 8d2815e (delta re-check).

## The core claim checks out
- "`requireRole` is UI-only, never the sole check" is TRUE as written: all 7 calls in `cms/page.tsx` and the one in `newsletter/page.tsx` hit doors that carry `require_roles("admin","manager")` server-side - `apps/backend/app/api/v1/staff_ops.py:265,276,291,298,314,336,349,377`.
- Live read-only probe against the running api: unauthenticated `GET /staff/newsletter`, `/staff/cms/home`, `/staff/me` all return **401**.
- `require_roles` reads the role from the DB row (`deps.py:33-38` re-queries `staff_users`; `:42` compares `staff["role"]`), so a token claiming a role cannot elevate. Server never trusts client `me.role`.
- Compensating control already in CI: `tests/test_staff_read_walls.py:38-41` pins those four doors in the unauthenticated sweep, so a dropped `require_roles` fails the gate.

## No protection removed; new guard is equal-or-stronger
- The old inline newsletter guard had **no** `.catch` on the `apiFetch` promise, which throws on a dead session - so it produced an unhandled rejection. The new `useMe` adds `.catch` and always settles `checked` (`lib/session.ts:31-32`): fail-closed on 401-throw, `!r.ok`, network reject, and unparseable body.
- No window found where `allowed === false` triggers an automatic fetch: the effect returns early on `!checked`, and the other `load()` call sites are user clicks.
- **Finding (2), FIXED in the delta:** the CMS mutation handlers were previously reachable by a non-privileged user (the whole form rendered). `cms/page.tsx:70` now early-returns a "role required" panel. Confirmed on re-check: rendering the form requires `!checked || allowed`; `checked` settles on every outcome, so the form cannot be reached with an insufficient role. Residual narrowed to a cosmetic pre-check flash; no data present (the loads are gated) and nothing authorised. Hooks order preserved (early return is after all hooks).
- **Finding (4), recorded not fixed:** `lib/api.ts::logout()` clears `sessionStorage["rfo_access"]` only after awaiting the POST, so a failed/offline logout can leave a live bearer token in the tab. Pre-existing (same pattern at `app/admin/page.tsx:26`), shared auth plumbing, and the refresh cookie is revoked server-side, so it is low severity. Agreed correct to leave for this job's scope; one-line follow-up (clear before the await, or in a `finally` inside `logout()`) fixes both call sites.

## No new exposure
- No PII leak: newsletter/cms are client components with no server-side data path. Reviewer fetched the served HTML + RSC flight data from `rfo-backoffice-1` for `/admin/newsletter`, `/admin/cms`, `/admin`: 0 email-like strings, no `subscribers`/`hero_title` payload, no `rfo_access`/`Bearer`/`access_token`/`totp_secret`.
- No added `console.*`, storage write, cookie, `dangerouslySetInnerHTML`, or token in a URL. The one hit is a comment naming the pre-existing storage key - naming a key is not a secret.
- Error boundaries render `error.message`; only reachable messages on these paths are apiFetch's session-expired string or a generic fetch failure.
- `app/icon.svg` is a self-contained static SVG - no script, no external href, no `data:` URI.
- Delta 2 (`try/finally` around logout) has no security impact; it fixes a dead-button case only.
