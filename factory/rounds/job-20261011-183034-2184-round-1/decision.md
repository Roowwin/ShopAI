# decision job-20261011-183034-2184 round 1

VERDICTS: CHANGES / CHANGES / CHANGES
DECISION: ESCALATE

The authorisation half is genuinely closed and the fix is structurally right - two reviewers independently
proved it by mutation. One reviewer put it exactly: the source of truth is real (the allow-list points at the
same constant objects the routes use, pinned by both an `is` check and a frozen literal, so re-widening either
side fails CI), and `_require_role` is the first statement of all seven dispatch targets, before any DB access.
With a full pre-fix revert the escalation tests fail on a real write (chat `test` returned 200 and moved audit
rows). Gate 47 passed.

Three findings on the edge half, two blocking:

1. **BLOCKING - the nginx edit is in a generated file.** `infra/nginx/conf.d/rfo.conf` is rendered from
   `infra/nginx/templates/rfo.conf.template` at every container start, so the committed fix is a no-op live
   today and is erased by the next `restart nginx`. Independently confirmed by two reviewers, one of whom
   proved `render(template) == conf.d` byte-for-byte and reproduced the overwrite on a throwaway container.
   The fix belongs in the template; the spec's allowed-surface list is amended for it.
2. **BLOCKING - the 2k body cap rejects legitimate requests.** `ChatIn.message` allows 2000 characters (not the
   900 the spec assumed, which is the storefront's), and nginx counts bytes: a Confirm turn re-sending the same
   message is 2055 B -> 413, so a message that proposes fine fails on Confirm. Raise to 16k.
3. **Recorded, not required:** the `Depends` is now the weaker twin for those routes (a dead edit if changed
   alone - fail-closed); nothing pins `TOOL_ROLES[action]` to the dispatch target it maps to; the chat route now
   answers **503** rather than 429 when throttled (pre-existing `limit_req_status` default, so a client cannot
   tell throttling from an outage); and the new zero-delta assertions use global table counts, so they
   false-fail under a concurrent suite run (the gate is serial).

Also carried to the program: `POST /store/reservations` and its `release` are unauthenticated and flip
`listed <-> reserved`. They cannot reach the closed graded->listed escalation, so they do not reopen this hole -
worth a look when the autonomy rail lands on that surface.
