# decision job-20261011-194358-7145 round 1

VERDICTS: PASS / PASS / PASS
DECISION: APPROVE

All three lenses pass, each verifying independently rather than accepting the builder's report - and the architect
notes it re-derived everything because the job dir held no builder report to trust.

The two things I most wanted checked both hold, by query rather than by reasoning:

- **PII**: reproduced twice over (10,973 rows by the security lens, 11,102 by the architect), each enumerating
  every distinct key in `before`/`after`/`meta` and regex-scanning for email/address/phone shapes - **0 matches**,
  with the person-name heuristic hitting only product titles. Returning those columns verbatim is justified.
- **The wall**: six doors on one shared role constant, proven live (403 for warehouse/sales/technician with a
  30-byte body, 401 unauthenticated, **404 on ids past every identity** so a handler is not answering 200 to
  anything), plus a `limit` cap of 200 enforced against the running API with `422` beyond it.

## Recorded, not reworked (non-blocking)
1. **The asset detail page does not disclose its 50/50/20 sub-list caps**, so a unit with more than 50 movements
   silently shows 50. The customer page does disclose its truncation. This is an honesty fix worth making - it
   goes to the nav job, which touches the same pages.
2. **`customers/[id]/page.tsx` renders `{c ? c.email : ...}` in its `<h1>` outside the gate block** (security
   lens). Not exploitable today, but the placement is the kind that becomes a leak if that state is ever seeded
   another way. Goes to the nav job.
3. **`/admin/orders` makes a second call to `/staff/overview`** - the heaviest read in the app - purely for one
   `by_state` dict, nearly doubling the page's backend work. Folding a grouped facet into the orders payload is
   the fix. Recorded for a follow-up perf job; not worth a round.
4. `text-brand-700 hover:underline` repeated 9 times; a shared `linkClass` in `lib/ui.ts` would fit the
   design-system rule. Folded into the nav job.
5. `_orders_page` runs a count it discards on the customer-detail path; `test_views.py`'s search assertion is
   stricter than the spec; `staff_views.py`'s docstring lacks the index-reality note its sibling has.
6. The pre-existing comment-emitted `.table` rule (`app/admin/page.tsx:38`) is still emitted - confirmed by the
   architect's closed-world check to be incidental (the word also occurs as a class and as a literal `<table>`
   tag), but it is the same trap and belongs in the nav job's clean-up.

## Ratified spec deviations
- The spec's blanket "all paginated with limit/offset and a total" contradicts its own pinned detail-route
  shapes; resolved per-route with capped sub-lists.
- The spec's "403 with an empty body" is unsatisfiable without editing `deps.py`, which was outside the allowed
  surfaces; the body is `{"detail":"insufficient role"}`, identical to every other staff route.

Gate: **58 passed** (from 49), no skips.
