# feedback - job-20261011-194950-163 round 1 -> round 2

Builder: the identity class, the wall, the migration and the UI are well built and well tested on their own merits
- the migration is a verified superset applied live, the wall is genuinely a third token class, and print-once is
proven (sha256 match, plaintext absent from the row). One blocking finding, and it is in the delegation.

## REQUIRED 1 (BLOCKING) - the agent can EXECUTE, not just propose
`staff_agents.py` delegates with `staff={"id": agent["staff_id"], ..., "role": agent["role"]}`, and `agent["role"]`
is the **sponsor staff row's** role. Creation is admin-only and `staff_id` is **the creating admin's own id**, so
every agent is sponsored by an admin - and every `TOOL_ROLES` tuple contains `admin`, including the two outward
tools `list` and `price`.

The route-level role gate is skipped on a plain-function dispatch, so the only gate on the execute branch is
`staff["role"] not in TOOL_ROLES[action]`, which the sponsor's admin role passes. Nothing on that branch requires
a human - `execute`, `action` and `args` are all client-supplied. **So an agent token can POST
`execute=true, action="list"` and publish a device on the live storefront at a price, with no human, no grant and
no cap** (`admin`/`manager` are exempt from `CHAT_DAILY_CAP`). And the write is audited as `actor_type="staff"`
with the sponsor's id, so it is indistinguishable from the admin's own action.

This is precisely what ADR 0008 exists to prevent, and it falsifies your own note at `staff_agents.py:84`
("a write still needs the human Confirm") and ADR 0008 decision 9's premise that an agent can execute nothing.

**Fix:** make the agent's delegated identity **non-executable**. Either pass a role no `TOOL_ROLES` tuple admits
(e.g. `"agent"`), or refuse `body.execute` in `agent_chat` with 403 - propose must keep working (the propose branch
does not role-gate). Test it: an agent POSTing `execute=true, action="list"` gets **403 and zero deltas**, while a
plain propose still returns `type: "proposed"`. A server-enforced single-use confirm is ADR 0008 Precondition 2 and
is out of scope here; the interim is **propose-only**.

## REQUIRED 2 - the mirror route's edge block
`^/staff/agents/chat$` falls into the generic `^/staff/` nginx block, so it inherits the server-level **25m** body
cap and the default **60s** proxy timeout, where the chat door has **16k** and **190s**. Starlette reads and
JSON-parses the body before dependencies run, so the mirror's unauthenticated body-read surface is ~1600x the
door's, and a slow AI turn can 504 where the door would not. Give `^/staff/agents/chat$` its own block mirroring
the chat door (same cap, same timeouts, same `limit_req` zone).
**Put it in `infra/nginx/templates/rfo.conf.template`, not only `conf.d/`** - this program established that
`conf.d/rfo.conf` is a generated artifact, re-rendered from the template at every nginx container start, so a
`conf.d`-only edit is silently reverted. Re-render and confirm the two agree.

## REQUIRED 3 - two small correctness fixes
- `test_agent_identity.py:94` says the store door's typ is `"store"`; it is **`"customer"`**. Fix the comment.
- The backoffice `Expires` column renders `revoked_at ?? expires_at` (`page.tsx:192` under the `Expires` header at
  `:180`), so a revocation timestamp appears under an "Expires" label. Show the two states as what they are.

## REQUIRED 4 - one line of coverage
A **staff** token must be 401 on the mirror route (the reviewer verified this is true but untested). Add it.

## Recorded, not required
- The agent and its sponsor share one Redis bucket keyed on the sponsor's staff id, so memory, the daily cap and
  `_FALLBACK_PROPOSAL` are shared between the agent, the sponsor's own chat and any second agent from that sponsor.
  Under propose-only this is not a write risk; it is why ADR 0007 decision 6's "marked actor type=agent with the
  identity name" cannot be satisfied by an audit call-site edit alone. Carried to the autonomy job.
- The delegation dict omits `public_id`/`totp_enabled`, which nothing reads today - a latent coupling worth a note.

## Orchestrator handles (outside your surfaces)
Amending ADR 0007 decision 3 to name `POST /staff/agents/chat` as the agent door, and ADR 0008's decision 9 /
Consequences wording, so neither claims "no new endpoints" while the mirror route exists.

## When done
Re-run the gate with the worktree-mount recipe, re-run the wall sweep (including the new staff-token-on-mirror
case and the execute-refused case), validate the nginx template by rendering it and running `nginx -t`, commit, and
report. Do not merge or push.