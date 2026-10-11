VERDICT: PASS

Job job-20261011-181232-6231 (backoffice admin shell + hygiene). Revision reviewed: 1a8a718; delta 8d2815e noted below.

Scope: no backend change, no new endpoints, no queries. All paths under `apps/backoffice/`.

## Findings (all non-blocking)
1. **`/staff/me` frequency.** `useMe` fires once per consuming page - only `cms/page.tsx` and `newsletter/page.tsx`. The layout does NOT call it, so the layout adds no fetch. CMS is net-new (previously ungated: 0 -> 1); newsletter's existing inline fetch merely moved into the hook (count unchanged). `app/admin/page.tsx` still hand-rolls its own `/staff/me` - duplication, not an extra request. No page fires it twice. A layout-level context would not help: every nav is a plain `<a href>` full-document reload, so the layout remounts anyway.
2. **`"use client"` on the layout does not force client rendering of the subtree.** Every admin page is already `"use client"` and Next passes children as props; the shell is still prerendered to HTML, so no layout shift. Cost is hydrating the nav shell per admin page.
3. **No regression in newsletter requests**: before = `/staff/me` -> `/staff/newsletter`; after = same two, same serialization. CMS gains one serial hop (its three `/staff/cms/*` calls now wait on `/staff/me`), ~1 RTT, and the gate is largely redundant with `apiFetch`'s existing 401 redirect - but the spec mandates it, so accepted.
4. **Pre-existing, unchanged:** `cms/page.tsx:22-24` awaits the three `/staff/cms/*` fetches sequentially rather than `Promise.all`. Not this job's to fix; recorded.
5. **Effect deps cannot thrash.** `[checked, allowed, load]` are a boolean, a boolean, and a `useCallback(fn, [])`; `requireRole` returns `!!me && ...` so value-compares. `load`'s setters change no dep. No infinite render.
6. **Bundle/blocking:** the four error/loading files are ~15/3 lines, `session.ts` 43 lines, no new dependencies, `icon.svg` static. No render-blocking assets.
7. **StrictMode:** dev fires 2 `/staff/me` (1 in prod) from the mount->cleanup->remount cycle; each run captures its own `alive`, so `checked` cannot be left stale. Minor cosmetic: on `!r.ok`, `finally` sets `checked=true` while the redirect is in flight, so a gated page can briefly flash "role required" during the redirect.

## Delta 8d2815e
No new request, query, or render cost: the CMS panel is an early return that *removes* work for a non-privileged user, and the sign-out `finally` adds no fetch. No re-review concern from this lens.
