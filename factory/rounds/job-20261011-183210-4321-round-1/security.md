VERDICT: PASS

Job job-20261011-183210-4321 (backoffice design system). Commit reviewed: 423ebfc.

The spec's "presentation only" claim holds. Diff is 20 files, all under `apps/backoffice/`.

## 1. Authorisation/guards - intact, unchanged
- `newsletter/page.tsx:16-17,36-40`: `useMe` + `requireRole(me, ["admin","manager"])` and the `if (!checked) return; if (!allowed) {...return;}` effect are **byte-identical to base**; the only diff below the gate is JSX.
- `cms/page.tsx:15-16,29-32`: same gate, same roles, same fail-closed ordering. `cms/page.tsx:72`'s `if (checked && !allowed)` deny block is present and unaltered (only the banner's classes moved `amber-*` -> `accent-*`).
- No early return removed; `checked`/`allowed` logic untouched. `lib/session.ts` and `lib/api.ts` are **not in the diff at all**.
- intake/assets/ai-listings/security never had client gates in either revision; `admin/layout.tsx` is nav-only in both.

## 2. Fetch/action/endpoint surface - no change
- `apiFetch(` count per page identical base->job: cms 7/7, assets 8/8, intake 4/4, ai-listings 2/2, newsletter 1/1, security 2/2, login 2/2.
- `onClick=` count identical; endpoint string literals sorted-diff identical; HTTP method census identical (2 PATCH / 19 POST / 1 PUT each side). No `credentials`/`Authorization`/headers path changed.
- Every handler survives verbatim inside the new `<Button onClick={...}>`.

## 3. Copy - no user-visible change
- Sorted `placeholder` set identical. Text-only diff (classNames stripped) shows **zero** copy differences - only structural tag renames. Button labels and the deny text "admin or manager role required" preserved.
- Only `aria-label` in the app is on `app/icon.svg:1`, unchanged; no page-level aria-label existed to lose.
- **Non-finding worth recording:** the new `Button` sets `type="button"` by default, whereas the plain `<button>`s it replaced implicitly defaulted to `type="submit"`. Inert here - there are **no** `<form>` elements or `onSubmit` handlers anywhere in `apps/backoffice` (grep NONE in both revisions) - but it is the one behavioural delta in the diff, and a future form will need an explicit `type="submit"`.

## 4. New exposure - none
- No `dangerouslySetInnerHTML`/`innerHTML`/`console.*` (grep identical base vs job).
- `lib/ui.ts`: `STATUS_TONE`/`GRADE_TONE` are static literal maps; `statusTone`/`gradeTone` do a **map lookup** with a `NEUTRAL` fallback, not string-concatenation of a caller/API value - so an API-supplied status cannot inject into a class name.
- `cn()` is a plain `filter(Boolean).join(" ")` - not a sink. `Badge`'s `colorClass` is only fed static map outputs.
- No new storage writes or logging; no new data rendered (status/grade chips render the same fields previously emitted as raw text).
- `globals.css` holds only channel-triples - no external `@import`.

## 5. Surface - clean
Only `apps/backoffice/**`; no `apps/backend`, `.env`, `infra/`, `secrets/`, `alembic`, `factory/`. Both spec-required exclusions honoured (`admin/page.tsx`, `admin/assistant/page.tsx` absent from the change set).
