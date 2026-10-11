VERDICT: CHANGES

Job job-20261011-194232-1757 (ADR 0008). Reviewed at `47d15a8`/`0fe6438`.

Surface clean: 5 files, all `docs/`; nothing under `apps/`, `infra/`, `alembic/`, `.env`, `secrets/`.

**Verdict rationale:** the design shape is sound (grant rows not a switch, class separation, caps for all roles,
rehearsal precondition, reversibility) and the honesty section is unusually candid. **But several promises were
unimplementable as the code stands and unspecified as written**, and approving the ADR authorises autonomy over
publicly visible actions (`list` publishes, `price` sets the public price). Not sign-off-able as drafted.

## Blocking
1. **Agent-identity grants were unreachable, contradicting the ADR.** `staff_users.role` admits no `agent`
   (`0001_initial.py:55`), and every `TOOL_ROLES` entry points at a `staff_ops` tuple containing no `agent`. So an
   agent could execute nothing - yet decision 5 and the rehearsal bullet required an agent turn to auto-execute,
   while "what does not change" forbade a grant from widening the tuples.
2. **Decision 7 rested on process-local state a separate request can miss.** `_FALLBACK_PROPOSAL` is a
   module-level dict keyed only by staff id, and the deciding model is read from process-global `LAST_VIA`.
   Propose and execute are two HTTP calls; across uvicorn workers or a restart the entry is absent and
   `pop(sid, False)` silently passes, so a **fallback model's decision executes anyway**. For an autonomous rail
   that is the only thing between a degraded local model and a live publish.
3. **Decision 8 had no mechanism to build on.** The execute branch re-reads client-supplied `action`/`args` and
   re-derives (`int(args.get("sale_price_cents", 0))`, grade defaults to `"B"`, location to `WH-A-01-01`). There is
   no server-side record of the validated proposal - only a boolean - so a machine client could send arbitrary args.
4. **Cap accounting unspecified**, and the existing cap has a known defect the ADR did not address
   (`CHAT_DAILY_CAP` increments before the clear-context shortcut and before the role/fallback checks, and never
   refunds). No key shape, no increment point, no refund rule.

## Missing
5. **Unbounded `action`/`args`** - a prior perf review explicitly asked for this to be stated in ADR 0008 and it
   was omitted. Once a machine client is normal, "not reachable from the UI" no longer holds.
6. **`audit_feed` index abandonment** - deferred to "the job that emits agent rows", which is this ADR.
7. **Revocation mid-flight** - decision 6 sells the flag as "instant" but never says disabling gates the next call
   and cannot recall a dispatched one: a device already published stays published.
8. **Future CMS/product writes are pre-declared `outward`** yet `cms_put_home`, `approve_listing`,
   `create_product`, `cms_edit_product` carry only a route `Depends` and no in-body guard - and the ADR's own
   premise is that `Depends` never evaluates on a plain-function dispatch.

## Also
Grants must be looked up by the **server-decoded** identity (fine, but the ADR should say so). Honesty was
better than most, but understated: the two kill switches and the backoffice grant surface **do not exist**;
"reversibility" glosses that executed outward state is not reversed; and `audit()`'s call sites hardcode
`actor_type="staff"` in all seven staff handlers, so decision 5's marker is a change to every handler plus a CHECK
widening, not "just the ADR 0007 migration".

**Minimum before approval:** resolve the agent-role/allow-list contradiction; require server-side storage of the
deciding model *and* the validated action/args for the auto-execute path; specify cap key + increment/refund
semantics; state that revocation is not a recall; bound `action`/`args` or state the edge cap; and name the
deferred `audit_feed` index work and the per-action in-body-guard obligation.
