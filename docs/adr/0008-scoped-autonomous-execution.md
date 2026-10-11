# ADR 0008: Scoped autonomous execution (supersedes ADR 0006 decision 4)

## Status
PROPOSED - awaiting owner acceptance.

On acceptance, this ADR **supersedes decision 4 of ADR 0006** (*"no write executes without a human Confirm"*) **for
granted (identity, action) pairs only**. Every other decision in ADR 0006 stands, ADR 0007 stands except where it
restates that invariant (see "What does not change"), and the human Confirm remains the default and the fallback
for anything ungranted.

## Context
ADR 0006 decision 4 is the invariant the owner adopted (`docs/state.md` records it as ADOPTED and owner-authored).
ADR 0006's own open question states the alternative "would require its own ADR with its own rehearsal evidence".
This is that ADR.

**This change is at the owner's instruction**, not inferred from observed good behaviour, and carries no
confidence threshold.

**The blast radius is outward-facing and real.** Two dispatchable actions reach the live storefront: `list`
(`staff_ops.set_status("listed")`) makes a serialised device **publicly buyable**, and `price`
(`staff_ops.set_price`) sets its **public sale price**. Autonomy over them means an AI turn can publish and price
with no human click.

**What this ADR therefore has to be honest about:** the guards it would lean on are, in several places, *not yet
what they appear to be*. A prior review of the rail found that the fallback-model guard is **process-local state**
(a module-level dict plus a process-global `LAST_VIA`), that the execute branch **re-reads client-supplied
`action`/`args` and re-derives them** rather than executing a server-validated proposal, that no grant surface or
kill switch exists yet, and that `audit()`'s call sites hardcode `actor_type="staff"`. Autonomy over publishing
must not be authorised on the strength of guards that only hold inside one process for one request. The
**Preconditions** section below is therefore part of the decision, not advice.

One defect this ADR depends on, already fixed: `staff_ai.py` dispatches to `staff_ops.*` as *plain functions*, so
those routes' `Depends(require_roles(...))` never evaluates. Each action's roles now come from one module-level
tuple used by both the route dependency and an in-body `_require_role` guard, and `TOOL_ROLES` derives from those
same tuples.

## Decision
1. **Supersession is narrow.** ADR 0006 decision 4 is superseded for a (identity, action) pair **only** where an
   explicit, enabled grant exists. Absent a grant, the Confirm line is exactly what it was.
2. **Autonomy is a grant, never a switch.** A grant is `(identity_type, identity_id, action, action_class,
   daily_cap, enabled)`, administered by an admin in the backoffice. There is no global "autonomy on". **Grants are
   looked up by the identity the server decoded from the bearer token**, never by anything client-supplied, so one
   identity's grant can never be exercised by another.
3. **Action classes keep the dangerous set separable.** `inventory` = `create_lot`, `scan_in`, `test`, `grade`,
   `move`, `activate_lot`. `outward` = `price`, `list`, and any future CMS or product write. An `inventory` grant
   **never** implies `outward`; a grant may carry either or both, and the class is recorded so the backoffice can
   show what publishing rights exist.
4. **Caps apply to every identity, including admin, manager and agents** - deliberately departing from
   `CHAT_DAILY_CAP`'s exemption (`staff_ai.py` exempts admin/manager), or the most powerful identity is the only
   uncapped one. Cap semantics are specified, because an unspecified cap is not a control:
   - key: `autonomy:{identity_type}:{identity_id}:{action}:{YYYY-MM-DD}` in Redis, day-scoped, same store as the
     existing chat cap and memory;
   - the counter **increments on execution only** (not on propose), so a proposal that is never granted costs
     nothing;
   - a refused or failed execution **is refunded** (decrement), so a transient error cannot consume a day's
     budget. Two cases this must pin, because the handlers commit inside themselves (`set_status`/`set_price`
     mutate and commit, then return): refund only when the execution **provably wrote nothing**, not merely on a
     non-2xx - otherwise a failure *after* the mutation would refund a write that stands; and make the
     reserve/refund pair **atomic or floor-bounded** (reserve-then-refund with a floor of 0, accepting bounded
     overshoot, or an atomic check-and-increment), since an `INCR` then `DECR` is not atomic and can overshoot or
     go negative under concurrency;
   - **over-cap degrades to propose**: returned as a proposal for a human Confirm, never executed and never
     silently dropped. This deliberately does NOT copy `CHAT_DAILY_CAP`, which increments before its role and
     fallback checks and never refunds.
   These per-(identity, action) caps are **cumulative with, not an alternative to**, ADR 0006 decision 5's
   per-identity `AGENT_DAILY_CAP` (untouched) - both must be satisfied.
5. **Audit.** Every autonomous execution writes the same mutation audit row as a human one, plus
   `meta.autonomy = {grant_id, identity}`. Agent executions use `actor_type = 'agent'`. `audit_log` is
   append-only; autonomy adds no new write path. Note this touches **every** `staff_ops` handler (they hardcode
   `actor_type="staff"`) plus a CHECK-constraint widening - it is not "just the ADR 0007 migration".
6. **Two independent kill switches.** Env `AI_AUTONOMY` (default `false`, compose passthrough, needs a restart)
   **and** the per-grant `enabled` flag. Both must be on. Flipping either off returns the rail to propose-only.
   **Neither exists yet** - see Preconditions.
7. **The fallback model never auto-executes, and the deciding model must be recorded server-side.** The existing
   `_FALLBACK_PROPOSAL` dict and process-global `LAST_VIA` are **not sufficient**: propose and execute are separate
   HTTP requests, so across uvicorn workers, or after a restart, the entry is absent and the guard silently passes.
   The deciding model must be recorded **per proposal, server-side (Redis, alongside the memory and cap keys)**, and
   the execute path must read it from there. This is a precondition, not a nicety.
8. **Never re-derive the action at execute time.** Auto-execution runs **from the server-persisted, validated
   proposal** (its `action`, `args` and resolved ids), never from a client echo of them. The stored proposal is
   **identity-scoped and single-use** (consumed on execution, so it cannot be replayed). Today's execute branch
   re-reads `body.action`/`body.args` and re-resolves the asset, defaulting grade and location - so this is new
   machinery to build, not a constraint on existing behaviour, and a machine client must not be able to
   substitute args.
9. **Agent identities are authorised by a grant, not by a role.** `staff_users.role` admits no `agent` and every
   `TOOL_ROLES` tuple is a staff-role tuple, so an agent can execute nothing today. Resolution: the execution gate
   for an **agent** identity is a valid enabled grant for that action, while staff roles continue to be governed by
   `TOOL_ROLES`. **A staff grant may only be created for an action the identity's role already permits** - a grant
   never widens a role tuple. The in-body `_require_role` guard is extended to accept "role permits it" OR - **and
   only for `identity_type == 'agent'`** - "a valid enabled agent grant for this action exists", and nothing else.
   Two properties this path rests on, which are therefore obligations: **the grantable action set is closed to
   `TOOL_ROLES` keys** (an action the rail cannot dispatch cannot be granted), and **grants are created only by an
   admin** in the backoffice. Without both, the branch would be a general bypass rather than a bounded one.
10. **Revocation gates the future; it does not recall the past.** Disabling a grant or flipping a kill switch stops
    the *next* execution. An action already dispatched is not undone - a device already published stays published
    and a price already set stays set. Operators must be told this, because "instant" is otherwise read as recall.
11. **Rehearsal evidence is required before the first grant is enabled** (see below), pasted and archived.
12. **Reversibility.** Deleting all grants restores exact ADR 0006 behaviour **with no code change**. This restores
    future behaviour only, per decision 10.

## What does not change
- The role allow-list and the in-body `_require_role` guards still gate every execution; a staff grant cannot widen
  them (decision 9).
- Caps, audit and the append-only ledger.
- Agent tokens remain valid **only** on the assistant surface (ADR 0006 decision 7, ADR 0007) - as built, the agent
  door is `POST /staff/agents/chat`, a mirror that delegates to `staff_ai.chat` and accepts only `typ="agent"`; see
  ADR 0007 decision 3's "as built" note. An agent **must be propose-only** until Precondition 2 exists: its
  delegated identity may carry no role any `TOOL_ROLES` tuple admits.
- ADR 0006 decisions 1, 2, 3, 5, 6, 7 and 8 are untouched. **ADR 0007 is untouched except where it restates this
  invariant**: its Status clause ("ADR 0006 gates EVERY proposal-to-execute path in this rail without exception")
  and its decision 4 are narrowed for granted pairs exactly as ADR 0006 decision 4 is - an **ungranted** rail is
  still fully gated by the human Confirm. Everything else in ADR 0007 (the identity class, credentials, the shared
  door, caps, the audit marker, the rehearsal extension) stands, and decision 5 depends on its
  `actor_type='agent'` migration.

## Preconditions to enabling any grant
Accepting this ADR authorises the *design*. Autonomy may not be **enabled** until all of the following are built and
verified - each is a real gap today, not a formality:
1. **Server-side deciding-model record** per proposal, so decision 7 holds across workers and restarts.
2. **Persisted validated proposal**, with auto-execution running from it, never from a client echo (decision 8).
3. **Agent authorisation path** - the grant-scoped gate of decision 9, plus the `staff_users.role` CHECK widening
   that ADR 0007 requires.
4. **The in-body `_require_role` guard becomes an obligation on any action promoted into a grantable class.**
   Several CMS/product handlers (`cms_put_home`, `approve_listing`, `create_product`, `cms_edit_product`) carry only
   a route `Depends` today - which, per this ADR's own premise, never evaluates on a plain-function dispatch. None
   is dispatchable by the rail today, so there is no current hole; promoting one into `outward` requires the guard
   first.
5. **Bound `action`/`args`.** `ChatIn.action` and `ChatIn.args` carry no length constraint, so an execute turn's
   args are schema-valid at any size. The earlier review asked for this to be closed or stated here; a machine
   client on this door makes "not reachable from the UI" no longer true. Bound them, or state the edge cap and why.
6. **Kill switches and the backoffice grant surface.** Neither exists; both are work.
7. **Cap accounting** per decision 4's semantics, including the refund path.
8. **`audit_feed` index work acknowledged.** The overview feed filters `actor_type IN ('staff','agent','system')`;
   a *selective* `actor_type` filter already makes the planner abandon `audit_at_idx` for a seq scan plus sort. Low
   severity (dashboard-only) but this is the ADR that creates agent rows, so it is named here rather than deferred
   again.

## Rehearsal evidence required before enabling
`scripts/rehearse_day.py` must score, deterministically (action-scoped execute, so the model is out of the loop),
and the scorecard must be pasted and archived:
- autonomy off -> deltas zero;
- `inventory` grant on -> exactly one asset and one audit row, carrying `meta.autonomy` and the right actor;
- `cap = 1` -> the second turn returns `type: proposed` and writes nothing; a failed first attempt is refunded;
- `inventory`-only grant -> `price` and `list` refused, and the storefront's price and catalogue unchanged;
- kill switch off -> a granted identity proposes, deltas zero;
- **fallback-model proposal, then execute across a separate request/worker -> refused** (the decision 7 guard);
- **agent turn -> `actor_type = 'agent'`** with the identity name in `meta` (requires Preconditions 1-3);
- **revocation**: disable a grant, then execute -> refused, and previously published state unchanged (decision 10).

## Consequences
**+** Automation proposes and, where granted, disposes - within caps, fully audited, without credential sharing.
**Same door, one new authorisation path**: the grant-scoped branch of decision 9 lets an agent identity past
`TOOL_ROLES` on the agent chat door. Three things must not be misquoted from this document:
- the agent door is **not literally** `/staff/ai/chat` - it is `POST /staff/agents/chat`, a mirror delegating to the
  same handler (ADR 0007 decision 3's "as built" note);
- the delegation carries **no role any `TOOL_ROLES` tuple admits**, so an agent is **propose-only** until a
  server-enforced single-use Confirm exists (Precondition 2) - a first cut that passed the sponsor's admin role
  would have let an agent publish a device with no click;
- what changes is the **authorisation surface**, and it is bounded by action class and cap.
**+** The Confirm line remains for everything ungranted, and removing grants restores the old behaviour exactly.
**-** The safety property the test suite asserts today ("a proposal never writes") must be **split, not deleted**:
ungranted / kill-switch -> zero deltas; granted -> exactly one write plus the audit marker. Approving this ADR
means rewriting tests that encode the opposite, visibly rather than later.
**-** Outward grants put pricing and publishing in an AI turn's hands, mitigated by class separation, caps for every
role, two kill switches, the server-side model record and reversibility - **not** by a human click.
**-** Several mitigations listed above **do not exist yet** and are itemised as Preconditions; until they do, this
ADR authorises a design, not a running feature.
**-** Heavy autonomous days throttle against caps by design; raise deliberately.

## Out of scope
Inherited from ADR 0006 decision 8: unattended multi-step execution chains, and agent actions in the customer
(store) zone.

## Open questions for the owner (acceptance)
1. **Confirm outward actions are grantable.** The owner has already directed this; it is recorded here as an
   explicit decision with its blast radius stated, rather than as a default anyone inherits. Listed only so the
   acceptance is explicit rather than implied.
2. **Caps cover admin/manager**, departing from `CHAT_DAILY_CAP`'s exemption - confirm.
3. **The Preconditions are a gate, not a checklist.** Confirm that no grant is enabled until all eight are built and
   the rehearsal scorecard (including the cross-worker fallback and agent-turn cases) is archived.
4. **Revocation is not recall** (decision 10) - confirm that is understood for outward actions.
