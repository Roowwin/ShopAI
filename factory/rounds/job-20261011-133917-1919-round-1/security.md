# security review round 1

Manual reviewer.

VERDICT: PASS
- Role gating demonstrated in-test: 401 unauth, 403 sales, 200 admin; admin/manager only per house pattern.
- Public subscribe: no enumeration, no oracle (identical response), normalization prevents case-variant dupes; parameterized SQL throughout.
- Note: confirm the existing nginx rate zone covers POST /store/newsletter/subscribe (bulk-signup abuse) - config check, not a defect.
