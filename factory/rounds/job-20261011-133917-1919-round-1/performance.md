# performance review round 1

Manual reviewer.

VERDICT: PASS
- UNIQUE(email) carries dedupe; bounded LIMIT/OFFSET; count(*) fine at this scale; consider a created_at index only if the list grows to need it.
