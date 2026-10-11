# autonomy: per-identity grants, caps, kill switches and persisted proposals (ADR 0008 machinery, inert by default)

## Context
Implements the machinery **ADR 0008** (`docs/adr/0008-scoped-autonomous-execution.md`) requires, and nothing more.
ADR 0008 authorises autonomy as a **design**; its eight "Preconditions to enabling any grant" are the gate on
actually enabling it. This job builds those preconditions.

**This job ships INERT.** No grant exists after it, and `AI_AUTONOMY` defaults to `false`, so an ungranted rail
behaves exactly as ADR 0006 decision 4 describes - the human Confirm. Enabling the first grant is the owner's
action, after a rehearsal scorecard is archived, and is **not** part of this job.

Read ADR 0008 first. Its decisions 1-12 are the contract; the sections below are the implementation of them.

## Deliverable

### 1. `apps/backend/alembic/versions/0011_autonomy_grants.py` (new) - **alembic is in scope for this file only**
`autonomy_grants`: `id`, `identity_type` (`staff`|`agent`), `identity_id`, `action`, `action_class`
(`inventory`|`outward`), `daily_cap` (int, NOT NULL), `enabled` (bool NOT NULL DEFAULT **false**),
`created_at`, `created_by` (staff id). UNIQUE `(identity_type, identity_id, action)`. Provide a `downgrade()`.
Latest applied revision is `0010_agent_identity`, so this is `0011`. Apply it and quote the resulting table
definition; the table must come up **empty**.

### 2. `app/services/autonomy.py` (new)
- **`ACTION_CLASS`** - the closed set from decision 3: `inventory` = `create_lot, scan_in, test, grade, move,
  activate_lot`; `outward` = `price, list`. **Derive the key set from `staff_ai.TOOL_ROLES`** so an action the rail
  cannot dispatch cannot be granted, and fail loudly if the two ever disagree.
- **`lookup(db, identity_type, identity_id, action)`** - the grant, or `None`. **Called with the identity the
  server decoded from the token**, never anything client-supplied.
- **`consume_cap(r, identity_type, identity_id, action, daily_cap)`** - Redis key
  `autonomy:{identity_type}:{identity_id}:{action}:{YYYY-MM-DD}`. Per decision 4:
  - increments **on execution only**, never on propose;
  - **refunds** when the execution provably wrote nothing - not merely on a non-2xx, because the handlers commit
    inside themselves, so a failure *after* the mutation must not refund a write that stands;
  - the reserve/refund pair is **atomic or floor-bounded** (reserve-then-refund with a floor of 0 accepting
    bounded overshoot, or an atomic check-and-increment) - an `INCR` then `DECR` is not atomic;
  - **over-cap returns "degrade to propose"**, never a failure and never a silent drop.
- Caps apply to **every** identity including admin/manager and agents - do not copy `CHAT_DAILY_CAP`'s exemption.

### 3. The two kill switches (decision 6)
`AI_AUTONOMY` env (compose passthrough, **default false**) **and** the per-grant `enabled` flag. **Both** must be
on. Add `AI_AUTONOMY` to `docker-compose.yml`'s api environment with a `false` default - that file is in scope for
this one line only.

### 4. The persisted, identity-scoped, single-use proposal (decision 8) and the server-side deciding-model record (decision 7)
Both in **Redis** (the same store as the memory and cap keys), not process memory:
- On a proposal, persist `{action, args, resolved ids, decided_by_fallback, single_use}` keyed by
  `(identity, session)`.
- **The deciding model must be recorded server-side per proposal.** The existing `_FALLBACK_PROPOSAL` dict and the
  process-global `LAST_VIA` are **not sufficient** - propose and execute are separate HTTP requests, so across
  uvicorn workers or a restart the entry is absent and the guard silently passes. That is the exact failure
  decision 7 exists to prevent, and it is a **precondition**, not a nicety.
- Auto-execution runs **from the persisted proposal**, never from a client echo of `action`/`args`. The proposal is
  **consumed on execution** so it cannot be replayed.
- The existing human-Confirm execute path keeps its current client-supplied shape - decision 8 constrains the
  *autonomous* path. Say so in the code, or a reader will think the Confirm path is broken.

### 5. The gate (decisions 1-3)
In `staff_ai.py`'s **propose** branch, after the model returns a `TOOL_ROLES` action and the ids resolve:
1. look up the grant for the server-decoded identity and that action;
2. require **both** kill switches;
3. refuse to auto-execute a proposal the **fallback** model decided;
4. consume the cap (over-cap -> propose);
5. dispatch through the same path the execute branch uses, auditing with `meta.autonomy = {grant_id, identity}`;
6. otherwise return `{"type": "proposed", ...}` exactly as today, with an `autonomy` field saying *why* it did not
   execute (`no_grant` | `kill_switch` | `fallback_model` | `cap_reached`) so the UI can explain itself.
No second model call, and **never** re-derive the action at execute time.

### 6. ADR 0008 precondition 5 - bound `action`/`args`
`ChatIn.action` and `ChatIn.args` carry no length constraint today, so an execute turn's args are schema-valid at
any size, and a machine client on this door makes "not reachable from the UI" untrue. Bound them (a `max_length` on
`action`, and a size bound on `args`), or state the edge cap and why - but bounding is the expected choice.

### 7. ADR 0008 precondition 4 - the in-body guard obligation
Add the in-body `_require_role` guard to the four CMS/product handlers that carry only a route `Depends`
(`cms_put_home`, `approve_listing`, `create_product`, `cms_edit_product`). None is dispatchable by the rail today,
so there is no current hole - the point is that promoting any of them into `outward` must not be able to inherit
the skipped-`Depends` problem.

### 8. Backoffice `app/admin/autonomy/page.tsx` and a `require_roles("admin")` router
List / create / enable / disable per-identity, per-action grants, showing the action **class** prominently (the
owner must be able to see at a glance which publishing rights exist). Add the nav entry to the sidebar's **AI**
group. Use the design-system primitives; guard with `useMe()` + `requireRole(me, ["admin"])`; fail closed.

### 9. `scripts/rehearse_day.py` - the rehearsal ADR 0008 requires
Extend it to score, deterministically (action-scoped execute, so the model is out of the loop): autonomy off ->
deltas zero; an `inventory` grant on -> exactly one asset and one audit row with `meta.autonomy` and the right
actor; `cap=1` -> the second turn returns `proposed` and writes nothing, and a failed first attempt is refunded;
`inventory`-only -> `price`/`list` refused with the storefront price and catalogue unchanged; kill switch off ->
proposes with zero deltas; **a fallback-model proposal then executed across a separate request/worker -> refused**;
**an agent turn -> `actor_type='agent'`** with the identity name in `meta`; and **revocation** - disable a grant,
then execute -> refused, with previously published state unchanged. **Paste the scorecard** in your report.

### 10. Tests - `apps/backend/tests/test_autonomy.py` (new)
The deterministic cases above, plus: a grant for one identity does not authorise another; a **staff** grant may not
widen a role tuple (decision 9) - a grant for an action the identity's role already permits behaves, and one for an
action it does not is refused; and `ACTION_CLASS`'s key set equals `TOOL_ROLES`'s.

**Rewriting the existing invariant tests:** `test_daily_ops.py::test_assistant_proposal_never_writes_without_the_flag`
and `test_assistant.py`'s proposal test currently encode "a proposal never writes". Decision/Consequences in ADR
0008 says those must be **split, not deleted**: keep an ungranted/kill-switch leg asserting zero deltas, and add a
granted leg asserting exactly one write plus the audit marker. Do that, and say so in your report.

## Acceptance
- Gate green from the root tree with the worktree mounted; report the count before and after. **Do not run it
  concurrently with anything else** - two overlapping runs corrupt each other on the shared DB.
- `docker compose build api` **and** `docker compose up -d api` - the running container must be recreated, or the
  new routes will 404 while the gate is green.
- The migration applied, table empty, and the resulting definition quoted.
- The **rehearsal scorecard**, pasted.
- **A live demonstration, with the grant then revoked**: enable an `inventory` grant for one action, show the
  autonomous execution and its `meta.autonomy` audit row, then disable it and show the next turn proposes. Report
  the before/after deltas. (Use an inventory action, never `outward` - publishing to the live storefront is not
  this job's to demonstrate.)
- `AI_AUTONOMY` present in `docker-compose.yml` defaulting false, and a run with it false showing zero autonomy.
- Allowed surfaces: `apps/backend/alembic/versions/0011_autonomy_grants.py` (new),
  `apps/backend/app/services/autonomy.py` (new), `apps/backend/app/api/v1/{staff_autonomy.py (new),staff_ai.py,staff_ops.py,deps.py}`,
  `apps/backend/app/models/**` (a model for the table), `apps/backend/app/main.py`, `apps/backend/tests/**`,
  `apps/backend/scripts/rehearse_day.py`, `docker-compose.yml` (the `AI_AUTONOMY` line only),
  `apps/backoffice/app/admin/{autonomy/page.tsx,layout.tsx}`, `apps/backoffice/app/components/**`. Anything else =
  **CHANGES**.

## Constraints
- Work only on branch `factory/<job-id>` (worktree provided) - LF / no BOM; PS 5.1 write rules
- Do NOT touch: `.env`, `secrets/`, `infra/`, `factory/*`, `apps/storefront/**`,
  `apps/backoffice/app/admin/assistant/page.tsx`, any migration other than your new `0011`
- **Do not enable a grant in any committed default, and do not change `AI_AUTONOMY`'s default.** The rail ships
  inert; enabling is the owner's decision after the rehearsal.
- The autonomy caps must not inherit `CHAT_DAILY_CAP`'s admin/manager exemption, nor its "
  increment before the role and fallback checks, never refund" behaviour.
