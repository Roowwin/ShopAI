# decision job-20261011-194950-163 round 1

VERDICTS: CHANGES / CHANGES / PASS
DECISION: ESCALATE

Two lenses independently found the same blocking defect, and the security reviewer **proved it live** rather than
reasoning about it.

## The finding, and why it matters more than any other in this program
The agent's chat door delegates the **sponsor's staff role**, and since agent creation is admin-only the sponsor is
the **creating admin** - whose role every `TOOL_ROLES` tuple admits, `list` and `price` included. The route-level
role gate is skipped on a plain-function dispatch, nothing on the execute branch requires a human, and
`execute`/`action`/`args` are all client-supplied. So an agent token with no prior proposal executed a real write -
`200 {"type":"executed","action":"create_lot",...}` with the lot row landing - and could equally have published a
device to the live storefront and set its public price, with no human, no grant and no cap (admin/manager are exempt
from `CHAT_DAILY_CAP`), audited as `actor_type="staff"` under the sponsor's id.

That is the same class of hole the roles job closed for human callers, reappearing through a machine credential -
and it falsifies three claims: the code's own note that "a write still needs the human Confirm", ADR 0008's premise
that "an agent can execute nothing today", and the spec's explicit ban on implementing any auto-execute path. It was
caught only because a reviewer traced the *delegated role* instead of accepting the note.

Also blocking, same cause: **the agent door has no role allow-list at all**, unlike `/staff/ai/chat`, so an agent is
strictly stronger than a least-privilege staff token and cannot be created least-privilege.

## Everything else passes, exhaustively
The wall is genuinely a third token class: a **differential sweep over all 61 route-method pairs** found agent and
anonymous bearers differ on exactly one route - the intended door - so an agent confers nothing anonymous lacks
anywhere else. Token secrecy (sha256 only, plaintext never stored, list returns no token), the three widened CHECKs
(verified live, superset, no duplicates), the rotate/revoke/expire/sponsor-deactivated/row-deleted lifecycle (no
window found), and admin-only creation all pass. Performance passes too: the constraint re-ADD is a seq-scan
validation, 1.30 ms on the 11.6k-row audit table, not a rewrite.

## Rework delivered
The fix was already in flight when the verdicts arrived: 403 propose-only plus an `AGENT_ROLE` that no tuple
admits, which is exactly REQUIRED 1. Remaining round-2 items from the feedback: the nginx block for
`^/staff/agents/chat$` (in the **template**, not `conf.d`), the stale `"store"` typ comment, the `Expires` column
rendering `revoked_at ?? expires_at`, and one line of coverage for a staff token on the mirror.

## Orchestrator action taken
ADR 0007 decision 3 and ADR 0008 were amended (`eb07506`) to record the mirror door and to state that an agent
**must be propose-only** until a server-enforced single-use Confirm exists (ADR 0008 Precondition 2) - neither may
keep claiming "no new endpoints" while the mirror route exists.

## Carried to the autonomy job
1. Agent chat memory, the daily cap and `_FALLBACK_PROPOSAL` are keyed on the **sponsor's** staff id, so a machine
   identity reads and writes the sponsor's conversation memory and can inject text into a human's assistant context
   (measured: `turns` 0->1 human, then 1->2 agent). Same bucket for the quota, and cap-exemption follows the
   sponsor's role.
2. Rotate discards the original `ttl_days` and resets to a fixed 90.
3. The audit marker cannot be satisfied by a call-site edit while the agent shares the sponsor's identity.

## Process
The security reviewer diagnosed the flaky-gate mystery seen earlier in this program: **concurrent gate runs sabotage
each other**, because every suite's cleanup deletes `staff_users WHERE email LIKE 'pytest-%'` on the shared DB. That
is recorded as a memory, and it is a second cost of parallelising factory jobs.
