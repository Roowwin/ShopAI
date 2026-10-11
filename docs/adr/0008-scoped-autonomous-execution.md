# ADR 0008: Scoped autonomous execution (supersedes ADR 0006 decision 4)

## Status
PROPOSED - awaiting owner acceptance.

On acceptance, this ADR **supersedes decision 4 of ADR 0006** (*"INVARIANT UNCHANGED: no write executes without a
human Confirm. Read-only ops may run without confirm within caps."*) **for granted (identity, action) pairs only**.
Every other decision in ADR 0006 stands: the agent identity, credentials, the shared door, caps, the audit marker
and the walls are unchanged, and the human Confirm remains the default and the fallback for anything not granted.

## Context
ADR 0006 decision 4 is the invariant the owner adopted (`docs/state.md` records it as ADOPTED and owner-authored).
ADR 0006's own open question states that the alternative - scoped auto-execute for low-risk ops - "would require
its own ADR with its own rehearsal evidence". This is that ADR.

Two things are explicit from the outset:

1. **This change is at the owner's instruction.** It is not inferred from observed good behaviour, and it carries
   no confidence threshold: autonomy is granted deliberately, per identity and per action, and can be withdrawn.
2. **The blast radius is real and outward-facing.** Two actions the chat rail can dispatch reach the live
   storefront:
   - `list` -> `staff_ops.set_status("listed")` makes a serialised device **publicly buyable**.
   - `price` -> `staff_ops.set_price(...)` sets that device's **public sale price**.
   Autonomy over those means an AI turn can price and publish a device with no human click. Everything below
   exists because of that, not as decoration.

**A defect this ADR depends on being fixed, and how it was.** `staff_ai.py` dispatches to `staff_ops.*` as *plain
functions*, so those routes' `Depends(require_roles(...))` never evaluates; the effective gate was the chat's own
`TOOL_ROLES`, which for `test` and `list` was **more permissive than the door it called** (a sales user could list
a device through chat while `/staff/assets/{id}/status` refused them). That divergence is closed as of this
program's roles job: each action's roles now come from one module-level tuple used by both the route dependency
and an in-body `_require_role` guard. **Grants are expressed in terms of those same tuples**, so a grant can never
be more permissive than the door that executes it - that is a precondition of this ADR, not an assumption.

## Decision
1. **Supersession is narrow.** ADR 0006 decision 4 is superseded for a (identity, action) pair **only** where an
   explicit, enabled grant exists. Absent a grant, the Confirm line is exactly what it was.
2. **Autonomy is a grant, never a switch.** A grant is `(identity_type, identity_id, action, action_class,
   daily_cap, enabled)`, administered by an admin in the backoffice. There is no global "autonomy on".
3. **Action classes keep the dangerous set separable.** `inventory` = `create_lot`, `scan_in`, `test`, `grade`,
   `move`, `activate_lot`. `outward` = `price`, `list`, and any future CMS or product write. An `inventory` grant
   **never** implies `outward`; a grant may carry either or both, and the class is recorded so the backoffice can
   show what publishing rights exist.
4. **Caps apply to every identity, including admin, manager and agents.** The existing `CHAT_DAILY_CAP`
   deliberately exempts admin/manager (`staff_ai.py`); autonomy caps must not repeat that, or the most powerful
   identity is the only uncapped one. **Over-cap degrades to propose** - returned as a proposal for a human
   Confirm, never executed and never silently dropped.
5. **Audit.** Every autonomous execution writes the same mutation audit row as a human one, plus
   `meta.autonomy = {grant_id, identity}`. Agent executions use `actor_type = 'agent'` (requires the ADR 0007
   migration). `audit_log` is append-only; autonomy adds no new write path.
6. **Two independent kill switches.** Env `AI_AUTONOMY` (default `false`, compose passthrough, needs a restart)
   **and** the per-grant `enabled` flag (instant, from the backoffice). Both must be on. Flipping either off
   returns the rail to propose-only.
7. **The fallback model never auto-executes.** If the deciding model is the local fallback, the action is
   proposed, not executed - preserving the property the current `_FALLBACK_PROPOSAL` guard provides.
8. **Never re-derive the action at execute time.** Autonomy executes exactly the action and args the model
   returned and the server validated. The retired `/staff/assistant` door's re-decide-at-execute pattern is out of
   scope by construction, and must not be reintroduced.
9. **Rehearsal evidence is required before the first grant is enabled** (see below). The scorecard is pasted and
   archived, per ADR 0006's own requirement.
10. **Reversibility.** Deleting all grants restores exact ADR 0006 behaviour **with no code change**. This is the
    property that makes the decision safe to reverse, and it is why autonomy is a row rather than a constant.

## What does not change
- The role allow-list and the in-body `_require_role` guards still gate every execution; a grant cannot widen them.
- Caps, audit and the append-only ledger.
- Agent tokens remain valid **only** on the assistant surface (ADR 0006 decision 7, ADR 0007).
- ADR 0006 decisions 1, 2, 3, 5, 6, 7 and 8 are untouched, as is all of ADR 0007.

## Rehearsal evidence required before enabling
`scripts/rehearse_day.py` must score, deterministically (driven by action-scoped execute so the model is out of
the loop), and the scorecard must be pasted and archived:
- autonomy off -> deltas zero;
- `inventory` grant on -> exactly one asset and one audit row, carrying `meta.autonomy` and the right actor;
- `cap = 1` -> the second turn returns `type: proposed` and writes nothing;
- `inventory`-only grant -> `price` and `list` refused, and the storefront's price and catalogue unchanged;
- kill switch off -> a granted identity proposes, deltas zero;
- agent turn -> `actor_type = 'agent'` with the identity name in `meta`.

## Consequences
**+** Automation proposes and, where granted, disposes - within caps, fully audited, without credential sharing
and without a new attack surface.
**+** The Confirm line remains for everything ungranted, and removing grants restores the old behaviour exactly.
**-** The safety property the test suite asserts today ("a proposal never writes") must be **split, not deleted**:
ungranted / kill-switch -> zero deltas; granted -> exactly one write plus the audit marker. Approving this ADR
means rewriting tests that currently encode the opposite, and that should be visible in the record rather than
discovered later.
**-** Outward grants put pricing and publishing in an AI turn's hands. That is mitigated by class separation, by
caps that cover every role, by two kill switches and by reversibility - **not** by a human click.
**-** Heavy autonomous days throttle against caps by design; raise deliberately.

## Out of scope
Inherited from ADR 0006 decision 8: unattended multi-step execution chains, and agent actions in the customer
(store) zone.

## Open questions for the owner (acceptance)
1. **Outward actions are grantable.** The owner has decided this; the ADR records it as an explicit decision with
   its blast radius stated rather than as a default anyone inherits.
2. **Caps cover admin/manager.** This deliberately departs from `CHAT_DAILY_CAP`'s exemption - confirm.
3. **The rehearsal scorecard is a precondition** to enabling the first grant - confirm.
