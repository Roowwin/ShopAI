VERDICT: CHANGES

Job job-20261011-194950-163 (agent identity rail), commit `d864dae`. 8 files, all inside the allowed surfaces. The
identity class, the wall, the migration and the UI are well built and well tested **on their own merits**. One
blocking finding, in the delegation the deviation rests on.

## R1 (BLOCKING) - the agent speaks with the sponsor's staff role, so it can EXECUTE, not just propose
`staff_agents.py:79-90` delegates with `staff={"id": agent["staff_id"], ..., "role": agent["role"]}`, and
`agent["role"]` is the **sponsor staff row's** role (`deps.py:66,73-77`: `s.role`). Creation is admin-only
(`staff_agents.py:64`) and `staff_id` is the **creating admin's own id** (`:65-66`), so every agent is sponsored by
an admin - and every `TOOL_ROLES` tuple contains `admin`, including the two outward tools, `list` and `price`.

- The route-level role gate is skipped on a plain-function dispatch, so the only gate on the execute branch is
  `staff["role"] not in TOOL_ROLES[action]` - which the sponsor's admin role passes.
- Nothing on that branch requires a human: `execute: true`, `action` and `args` are all client-supplied. An agent
  token can therefore POST `execute=true, action="list"|"price"` and **publish a device / set its public price with
  no human, no grant and no cap** - `admin`/`manager` are exempt from `CHAT_DAILY_CAP` (`staff_ai.py:157-159`).
- The write is audited as the human: `actor_type="staff"`, `actor_id=staff["id"]` - indistinguishable from the
  admin's own action.

This makes three claims false: `staff_agents.py:84` ("a write still needs the human Confirm"); ADR 0008 decision
9's premise "an agent can execute nothing today"; and the spec's scope ban on "any auto-execute path" - met in
effect, even though no new execute branch was written. (A human could already run a script with their own token -
but this job is what puts a **machine credential** on the branch and sanctions it as an identity class, while ADR
0007 decision 1 defines that class as role `agent`, which no `TOOL_ROLES` tuple admits.)

**Required:** make the agent's delegated identity **non-executable** - pass a role no tuple admits (e.g. `"agent"`)
or refuse `body.execute` in `agent_chat` with 403 - so propose still works (the propose branch does not
role-gate) and execute is refused until a **server-enforced** confirm exists. Test it: agent
`execute=true, action="list"` -> 403 and zero deltas. If the owner wants agent-execute-on-human-confirm now, the
confirm must be server-persisted and single-use - that is ADR 0008 Precondition 2, out of this job's scope. The
interim is propose-only.

## Q1 - the mirror route: at the app layer narrower, at the edge wider
Protocol, `TOOL_ROLES` and the Confirm line are shared by delegation (same function object, same `ChatIn`, same
execute branch). Credential acceptance is strictly narrower (`get_agent` takes `typ="agent"` only, so a staff token
cannot use the mirror), and the mirror's sponsor role is exactly what that sponsor's own token has - no escalation.
**The real widening is at nginx**: `infra/nginx/conf.d/rfo.conf:63` gives `^/staff/ai/chat$` a 16k body cap and
190s timeouts, while `^/staff/agents/chat$` falls into the generic `^/staff/` block, inheriting the server-level
**25m** cap and the default 60s timeout. Starlette reads and JSON-parses the body before dependencies run, so the
mirror's unauthenticated body-read surface is ~1600x the door's, and a slow AI turn can 504 where the door would
not. Needs its own nginx block - in the **template**, per this program's earlier finding that `conf.d` is a
rendered artifact.

## Q2 - keep the mirror route; record the deviation
Do **not** widen the surfaces. The delegation is protocol-identical and strictly narrower in what it accepts, and
the alternative (editing `staff_ai.py` so the agent authenticates on `/staff/ai/chat`) puts agent-token acceptance
into the very route ADR 0008 decision 9 will rewrite for the grant branch - entangling the wall's single surface
with the autonomy path - and overrides the surfaces rule mid-flight. But the deviation **must be recorded**: ADR
0007 decision 3 ("No new endpoints") and ADR 0008's "the existing chat route" are false as shipped. Docs are
outside this job's surfaces, so the orchestrator must amend ADR 0007 decision 3 to name `POST /staff/agents/chat`
as the agent door and update ADR 0008's decision 9 / Consequences wording.

## Q3 - migration 0010 verified (contents and live state)
`WIDEN` re-ADDs every original value plus `agent`, matching the originals exactly; `NARROW` is those three lists
verbatim; dropped by the exact names with `IF EXISTS` both ways; `agent_tokens` matches the spec column-for-column.
Live: `alembic_version = 0010_agent_identity`, all three constraints widened with every original preserved, and
`agent_tokens` has the 8 spec columns, its pkey, the `staff_id` FK and the unique `token_hash`.

## Q4 - the wall is genuine
`get_agent` decodes `typ="agent"`; `get_staff` decodes only `typ="staff"`; `get_customer`/`store_ops` only
`"customer"`. So an agent bearer is 401 on every staff route and on the store wall - asserted by sweeping the
imported `STAFF_READS` tuple plus `/store/me`, with an assistant-surface control. `get_agent` also requires
unrevoked, unexpired, sponsor-active and a constant-time SHA-256 match, which is what makes rotate/revoke
immediate. Untested but true: a staff token is 401 on the mirror (worth one line of coverage).

## Q5 - scope discipline clean
The 8 allowed files only; no compose/`.env`/infra/docs/`staff_ops.py` change. No grants table or lookup, no
`AGENT_DAILY_CAP`/`AI_AUTONOMY`, no kill switch, no audit call-site edit, no new auto-execute branch. (R1 is a
*behavioural* auto-execute path through the pre-existing branch, not a new one.)

## Q6 - other
- **Stale comment**: `test_agent_identity.py:94` says the store door's typ is `"store"`; it is `"customer"`.
- **UI**: the `Expires` column renders `revoked_at ?? expires_at` (`page.tsx:192` under the `Expires` header at
  `:180`) - a revocation timestamp shown under an "Expires" label.
- **Attribution coupling**: agent and sponsor share one Redis bucket keyed on the sponsor's staff id, so memory,
  the daily cap and `_FALLBACK_PROPOSAL` are shared between the agent, the sponsor's own chat and any second agent
  from that sponsor. Why ADR 0007 decision 6's "marked actor type=agent with the identity name" cannot be
  satisfied by an audit call-site edit alone.
- ADR citations resolve correctly; the backoffice page's primitives all exist and its comment is free of bare
  utility words.
