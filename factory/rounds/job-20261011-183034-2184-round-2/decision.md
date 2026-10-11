# decision job-20261011-183034-2184 round 2

VERDICTS: PASS / PASS / PASS
DECISION: APPROVE

Both round-1 blockers are closed and independently verified. The nginx fix is now at the **source**: the template
carries both edits, `conf.d == render(template)` was rebuilt empirically (a throwaway nginx running the real
entrypoint rendered the committed conf byte-for-byte), the cap is chat-only so `intake-draft`'s multipart upload
is untouched (reproduced with an 8206-byte body), and the cap table was reproduced in both directions. No
authorisation surface moved - the round-1 posture (single source of truth, seven in-body guards, nothing widened)
stands, verified by an empty diff on `staff_ai.py` and the tests.

## Ratified: the deliberate spec deviation
The spec prescribed `client_max_body_size 2k`; the delivered value is **16k**. **Ratified.** The spec number was
wrong, not the code: the app allows 2000 *characters* while nginx counts *bytes*, so 2k could 413 a legal
max-length Confirm turn (measured: 2113 B body). 16k gives ~2x headroom over the worst case. `ChatIn` was
correctly left alone, since ADR 0006/0007 put the agent rail on this route.

## Owner action required after merge
The running `rfo-nginx-1` still serves its start-time render (no chat block). The block only lands on the next
`docker compose up` / `restart nginx` - so the acceptance's before/after status codes must be taken **after** that
restart, or they measure a config that is not live. Orchestrator performs this.

## Recorded for the autonomy job (J8)
- `action: str | None` and `args: dict | None` carry **no length constraint**, so an execute turn's `args` is
  schema-valid at any size and can exceed the new 16k edge cap. Not reachable from the shipped UI, but the agent
  rail speaks this door - harden it (bound `action`/`args`) or state the edge cap in ADR 0008.
- A client emitting `\uXXXX` escapes turns 2000 non-BMP chars into ~24 kB -> 413 while the schema accepts it.

## Recorded for data hygiene (a class, not an instance)
The dev DB holds **994 lots, 100 empty-intake, 94 with notes exactly `pytest`** (plus 1 empty `active` lot). The
two strays reported by this job are instances of a systematic leak from the test harness. Route the **class** to
a hygiene step: a sweeper for empty `intake` lots with test/probe notes plus fixture cleanup so it stops
accreting - never touching `completed`/`active` lots or any lot with assets.

## Ratified deviation ledger (program)
- J3: `client_max_body_size` 2k -> 16k on the chat route (spec number wrong).

Gate at this revision: 47 passed mounted; 43 passed / 4 deselected on the official gate. Baseline 42.
