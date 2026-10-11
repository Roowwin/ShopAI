VERDICT: PASS

Job job-20261011-194358-7145 (ops views), commit `1c3e50e`. All six checks hold; nothing blocking.

## The doors
All six use the shared `READ_ROLES = ("admin","manager")` constant - no route uses a weaker tuple. Reproduced **live**, not just from the suite: `warehouse`, `sales` and `technician` -> **403** with a 30-byte body and no data; no credential -> 401; admin/manager -> 200; ids past every identity -> **404**, which proves a handler is not answering 200 to anything.

## PII - reproduced and it holds
Scanned **10,973 `audit_log` rows** (24,551 scalar values across `before`/`after`/`meta`; the table grew to 11,068 during the session). Over `jsonb_each_text` of all three columns: **0** email-shaped, **0** address-shaped (both word forms), **0** phone-shaped. The person-name heuristic matched only product titles ("Pytest Phone"), never a human name. The distinct top-level key set is exactly the 30 benign keys listed; customer-scoped entities cross-tabulate to `order: {country, simulated, total_cents, units}`, `payment: {ref}`, `reservation: {count}`; the only `name` key belongs to `promotion`. `actor_type` is only staff/system - there is no user/customer entity. **Returning those columns verbatim is sound**, and the residual risk is documented.

## Reachability
`customer_email`/`display_name` appear only in `staff_views.py` behind the admin/manager gate. Repo-wide grep shows no store/public endpoint returning another user's email or display name.

## Test placement
The six are in `STAFF_READS` only; `READ_WALLS` is unchanged at its three list routes, so its admin leg (`r.json() != []`, `:104`) is never asked to assert a list on an object-returning route. The 401 sweep covers all six.

## The 403 wall is proven by `test_views.py`, not the sweep
`test_views_door_is_role_gated` asserts no-cred 401 / sales, warehouse **and** technician 403 / admin 200 for all six, plus the 404 probes. The `test_staff_read_walls.py` sweep alone proves only the 401 (its role-gate test is scoped to `READ_WALLS`).

## Also verified
No string-formatted SQL from input (`_PAID_IN` comes from a hardcoded, guard-checked constant; all caller values bind as parameters and an injection attempt was proven parameterised). `limit` capped at 200 on all three list routes; `offset` unbounded but bounded in cost by table size. Every page's data block is gated on `checked && allowed` and fetches early-return when not allowed.

## Non-blocking
- `customers/[id]/page.tsx` renders `{c ? c.email : ...}` in its `<h1>` *outside* the gate block. Not exploitable (`c` derives from `data`, which only a successful gated fetch sets), but the placement is the kind that becomes a leak if that state is ever seeded another way. Worth tightening.
- Comments in `app/**` contain bare `block`, `table`, `grid`; the emitted CSS does contain `.table{display:table}`, traced to a **pre-existing** comment (`app/admin/page.tsx:38`) rather than to this job, which adds no new emitted rule. Inherited hygiene condition, not a finding against this job.
