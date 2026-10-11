VERDICT: PASS

Job job-20261011-194358-7145 (ops views), commit `1c3e50e`. Everything re-derived by the reviewer; the job dir holds no builder report, so nothing was taken on trust.

## Complete and correct
- Six GET routes in `apps/backend/app/api/v1/staff_views.py`, all through one `READ_ROLES = ("admin","manager")` constant; no mutating decorator in the module; registered in `main.py`; no path collisions with the other staff routers. Shapes match the spec key-for-key.
- **The `total` deviation is right, and its reasoning is right**: window functions evaluate before LIMIT/OFFSET, so `count(*) OVER ()` yields no row at all once `offset` is past the end - a client reading the count off a returned row would report `0` for a merely-empty page. Implemented as a separate count statement sharing the filter block verbatim. Verified live by `test_views_pagination_is_consistent` and `test_views_totals_agree_with_the_database`.
- No N+1 (one page query + one count per list; fixed 2-5 per detail); no write statements at all; no refund/cancel control anywhere and `orders/[id]` says so in prose.
- Nav: all 11 entries plus the three dynamic detail routes returned 200 from `next start`, with `/admin/nope` -> 404 as a control, so the check is not vacuous.
- `assets/page.tsx`'s serial anchor + `stopPropagation` is sound: the `TR` handler is on an ancestor so selection is suppressed while navigation proceeds, and it *adds* a keyboard-reachable route (the `TR` was never focusable before).
- `lib/format.ts`: `StatRow`/`AuditFeed` import `aud`/`when` and both local copies are deleted.
- **PII reproduced independently** (11,102 audit rows): the distinct key set is exactly the 30 benign keys the docstring lists; customer-scoped entities carry only non-personal keys; the sole `name` key belongs to `promotion`; 0 email-shaped and 0 address-shaped matches.
- **Closed-world comment check** run as specified: 238 rules with comments, 238 without, zero difference either way. It isolated the mechanism too - a comment word alone *does* emit a rule, and so does a bare `<table>` tag - so the safety here is real but incidental, and `Table.tsx`'s warning stays the right rule.

## Non-blocking, recorded
1. The spec's "403 with an empty body" is not literally met (`{"detail":"insufficient role"}`, identical to every other staff route) - and `deps.py` was not in the allowed surfaces, so the literal wording was unsatisfiable. The wall is the 403 for all three non-admin roles, which the tests assert.
2. The spec contradicts itself: "all paginated with limit/offset and a total" does not hold for the three detail routes, whose own pinned shapes contain no `total`. Resolved per-route; sub-lists are capped instead (customer history 50, movements 50, reservations 50, asset audit 20). The customer page discloses its truncation; **the asset page does not disclose the 50/50/20 caps**, so a unit with more than 50 movements would silently show 50.
3. `_orders_page` also runs the count on the customer-detail path and discards it - one avoidable query per detail load, not an N+1.
4. `test_views.py`'s search assertion is stricter than the spec (public id only, not public id *or* email); it would fail spuriously if an email matched the fragment.
5. `text-brand-700 hover:underline` is repeated 9 times across the six files, and no such pattern pre-existed in the backoffice. `lib/ui.ts` is in scope and already exports `kickerClass` as precedent, so a shared `linkClass` would fit "do not hand-roll class strings".
6. The dev-restart question cannot be verified from the branch (the running container serves the main tree), but the known inotify caveat applies since this job adds six new route directories.
