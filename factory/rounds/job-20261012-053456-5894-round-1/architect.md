# architect review round 1

Manual reviewer. commit 33b5748; gate 104 passed / 3 deselected (+13); backoffice tsc+build clean 17 routes; compose validated; printenv AI_AUTONOMY = false live.

VERDICT: PASS
- Switch per request, agent-gate only, staff path never reads it (tested); degrade ordering justified (valid records degrade; garbage stays 403/422).
- Grants surface: admin-only + audited CRUD; action_class server-derived from a fixed map (body field absent); caps 1-100; three deliberate acts to arm; revocation-not-recall stated to operators.
- Promotion guards on SIX handlers (4 named + 2 swept); reads Depends-only by convention (documented); no plain-function callers of the promoted six (swept).
- Precondition 8: measured non-reproduction - no index, the revisit trigger = query-shape change; record in the test docstring.
- AGENT_DAILY_CAP gap routed to job 15 (decision 4's cumulative clause needs its counterpart before a real grant).
