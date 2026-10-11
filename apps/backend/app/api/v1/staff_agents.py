"""Agent identity rail - token lifecycle, the agent's own door, and the grant ledger (ADR 0007, ADR 0008).

An agent is a third identity class: an admin mints a rotatable, revocable, expiring token bound to a
staff sponsor, and the agent speaks the assistant with it. The agent's turn reaches the same chat
handler a staff token reaches and produces the same proposals.

What an agent may DO is a grant, never a role (ADR 0008 decision 9). Its execute turn names a
`proposal_id` the server stored, and the staff_ai gate runs it only if the env switch `AI_AUTONOMY`
is on (decision 6) AND an ENABLED grant exists for (this agent, the action the proposal names),
within the action's daily cap and off the fallback model - and never from a client echo of the
action or its args. Absent either switch the turn comes back as a proposal for a human Confirm,
exactly as before; the delegated role is still one no TOOL_ROLES tuple admits, so the role path
stays shut to it.

**In production an agent still cannot execute anything**, and that is now a property of three
deliberate acts rather than of a missing feature: no grant is seeded, a grant this surface creates
is created DISABLED, and `AI_AUTONOMY` defaults false (compose passes it through; absent means off).
All three must be turned on on purpose, and any one of them off returns the rail to propose-only.
`tests/test_autonomy_execute.py` and `tests/test_autonomy_grants.py` prove the machinery with fixture
grants and a monkeypatched switch.

That scoping is not belt-and-braces: `staff_ai.chat` dispatches into `staff_ops` as PLAIN FUNCTION
calls, so the routes' `Depends(require_roles(...))` never evaluates, and `agent_tokens.staff_id` is
the creating admin's own id. Delegating the sponsor's role would have handed every agent the admin
allow-list - including `list` and `price`, which publish a device on the live storefront - which is
why the delegated role is AGENT_ROLE and why the grant branch below is keyed on the AGENT's id and
not on the sponsor's.

Token handling: the plaintext leaves this module exactly once, in the response to create/rotate. The
row keeps a SHA-256 of it - the same treatment refresh_tokens takes - and every read here is written
so the hash cannot be returned by accident: the listing selects named columns and never token_hash.
"""

import hashlib
import secrets
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.api.v1 import staff_ai, staff_ops
from app.api.v1.deps import get_agent, require_roles
from app.core import security
from app.core.db import get_ai_db, get_db
from app.core.redis import get_redis
from app.services.audit import audit

router = APIRouter(prefix="/staff/agents", tags=["staff-agents"])

DEFAULT_TTL_DAYS = 90
MAX_TTL_DAYS = 365

# Role-only action names for the in-body guards on this module's WRITES (ADR 0008 Precondition 4:
# the in-body guard is the authoritative one because a plain-function dispatch skips `Depends`).
# None of these is in `GUARDED_ACTIONS`, so an agent identity is refused by the grant branch before
# any lookup - the intended design for a path that is never grantable, and it is spelled out here
# so the refusal is a fact of the name rather than an accident of the branch order.
ACTION_AGENT_CREATE = "agent_create"
ACTION_AGENT_ROTATE = "agent_rotate"
ACTION_AGENT_REVOKE = "agent_revoke"
ACTION_GRANT_CREATE = "grant_create"
ACTION_GRANT_UPDATE = "grant_update"
ACTION_GRANT_REVOKE = "grant_revoke"


class AgentIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    ttl_days: int = Field(default=DEFAULT_TTL_DAYS, ge=1, le=MAX_TTL_DAYS)


def _mint(agent_id: int, ttl_days: int) -> tuple[str, str, datetime]:
    """Mint a token for `agent_id` and return (plaintext, sha256 hex, expires_at).

    The token's `typ` is "agent" - its own class, never "staff" with role="agent" - so the decoder
    that accepts it is the only one that will, and every staff route keeps refusing it.
    """
    minutes = ttl_days * 24 * 60
    token = security.create_access(typ="agent", sub=str(agent_id), ttl_minutes=minutes)
    return token, hashlib.sha256(token.encode()).hexdigest(), datetime.now(timezone.utc) + timedelta(minutes=minutes)


@router.get("")
async def list_agents(staff: dict = Depends(require_roles("admin")), db=Depends(get_db)):
    """Identities, newest first. Never the token: named columns only, and no token_hash."""
    rows = (await db.execute(text(
        "SELECT t.id, t.name, t.scopes, t.expires_at, t.revoked_at, t.created_at, s.email"
        " FROM agent_tokens t JOIN staff_users s ON s.id = t.staff_id ORDER BY t.id DESC"))).mappings().all()
    now = datetime.now(timezone.utc)
    return {"total": len(rows), "agents": [
        {"id": r["id"], "name": r["name"], "scopes": list(r["scopes"] or []), "email": r["email"],
         "created_at": r["created_at"].isoformat(), "expires_at": r["expires_at"].isoformat(),
         "revoked_at": r["revoked_at"].isoformat() if r["revoked_at"] else None,
         "active": r["revoked_at"] is None and r["expires_at"] > now} for r in rows]}


@router.post("")
async def create_agent(body: AgentIn, staff: dict = Depends(require_roles("admin")), db=Depends(get_db)):
    """Create an identity and print its token once. Only the hash is stored."""
    await staff_ops._require_role(staff, ("admin",), ACTION_AGENT_CREATE, None)
    new_id = (await db.execute(text(
        "INSERT INTO agent_tokens (staff_id, token_hash, name, expires_at) VALUES (:s, :h, :n, :e) RETURNING id"),
        {"s": staff["id"], "h": "pending:" + secrets.token_hex(16), "n": body.name,
         "e": datetime.now(timezone.utc) + timedelta(days=body.ttl_days)})).scalar_one()
    token, token_hash, expires = _mint(new_id, body.ttl_days)
    await db.execute(text("UPDATE agent_tokens SET token_hash = :h, expires_at = :e WHERE id = :i"),
                     {"h": token_hash, "e": expires, "i": new_id})
    await db.commit()
    return {"id": new_id, "name": body.name, "token": token, "expires_at": expires.isoformat(),
            "scopes": [], "token_shown_once": True}


# The agent's delegated role. A role NO TOOL_ROLES tuple admits, and that is the point: every tuple
# contains "admin", agent_tokens.staff_id is the CREATING ADMIN's id, and the chat door dispatches
# into staff_ops as plain function calls (so a route-level Depends never runs). Delegating the
# sponsor's own role would therefore let an agent token execute `list` or `price` - publishing a
# device on the live storefront at a price - with no grant and no cap.
AGENT_ROLE = "agent"


@router.post("/chat")
async def agent_chat(body: staff_ai.ChatIn, agent: dict = Depends(get_agent), db=Depends(get_db),
                     ai_db=Depends(get_ai_db)):
    """The agent's door into the assistant - the assistant surface, and the only one (ADR 0007 d.7).

    The delegated identity context is built HERE and nowhere else, and it is the whole of the
    agent's claim: `role` is AGENT_ROLE (no TOOL_ROLES tuple admits it), `identity_type`/`identity_id`
    are the agent's OWN id off the `agent_tokens` row, and `id` stays the SPONSOR's staff id because
    the handlers' writes key on a real staff_users row (`stock_movements.actor_staff_id` is a foreign
    key to it). `identity_type`/`identity_id` are what the proposal record is scoped to and what the
    grant lookup is keyed on, so one agent can never spend another's proposal or another's grant.

    An execute turn is not refused here any more: `staff_ai._agent_execute` owns that gate, in one
    place, and refuses or degrades identically for any caller. What it will never do is execute
    something this door did not propose - see its docstring.

    Note the handler still keys its Redis memory, daily cap and `_FALLBACK_PROPOSAL` on the SPONSOR's
    staff id, so an agent, its sponsor and any second agent of that sponsor share one chat-memory
    bucket; the per-(identity, action) autonomy cap does NOT - it is keyed on the agent's own id.
    """
    return await staff_ai.chat(body=body, staff={"id": agent["staff_id"], "email": agent["email"],
                                                "role": AGENT_ROLE, "identity_type": "agent",
                                                "identity_id": agent["id"], "identity_name": agent["name"]},
                               db=db, ai_db=ai_db)


@router.post("/{agent_id}/rotate")
async def rotate_agent(agent_id: int, staff: dict = Depends(require_roles("admin")), db=Depends(get_db)):
    """New token, printed once; the previous one stops authenticating on the next request.

    Rotation cannot un-revoke: a revoked identity stays revoked (409) and is replaced by a new one.
    """
    await staff_ops._require_role(staff, ("admin",), ACTION_AGENT_ROTATE, None)
    row = (await db.execute(text("SELECT id, revoked_at FROM agent_tokens WHERE id = :i"),
                            {"i": agent_id})).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="agent not found")
    if row["revoked_at"] is not None:
        raise HTTPException(status_code=409, detail="agent is revoked")
    token, token_hash, expires = _mint(agent_id, DEFAULT_TTL_DAYS)
    await db.execute(text("UPDATE agent_tokens SET token_hash = :h, expires_at = :e WHERE id = :i"),
                     {"h": token_hash, "e": expires, "i": agent_id})
    await db.commit()
    return {"id": agent_id, "token": token, "expires_at": expires.isoformat(), "token_shown_once": True}


@router.post("/{agent_id}/revoke")
async def revoke_agent(agent_id: int, staff: dict = Depends(require_roles("admin")), db=Depends(get_db)):
    """Kill the identity now. get_agent refuses a revoked row on the very next request."""
    await staff_ops._require_role(staff, ("admin",), ACTION_AGENT_REVOKE, None)
    row = (await db.execute(text("SELECT id, revoked_at FROM agent_tokens WHERE id = :i"),
                            {"i": agent_id})).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="agent not found")
    if row["revoked_at"] is None:
        await db.execute(text("UPDATE agent_tokens SET revoked_at = now() WHERE id = :i"), {"i": agent_id})
        await db.commit()
    return {"id": agent_id, "revoked": True}


# ===========================================================================
# The grant ledger's surface (ADR 0008 decisions 2, 3 and 6; Precondition 6).
#
# Autonomy is a grant, never a switch, and grants are administered here by an ADMIN ONLY. Three
# rules from the ADR are enforced in code rather than in the UI:
#
#   * the ACTION CLASS is server-derived (decision 3). `price` and `list` reach the live storefront,
#     so they are `outward`; every other dispatchable action is `inventory`. A class is a fixed fact
#     of this codebase, and a request may not name one - `GrantIn` has no such field, so a body that
#     carries one is ignored rather than trusted (there is nothing to trust it with).
#   * the GRANTABLE ACTION SET is the rail's own - `staff_ops.GUARDED_ACTIONS`, pinned equal to
#     `staff_ai.TOOL_ROLES` by test_chat_tool_roles.py (decision 9's closure). Anything else is a
#     422: a grant for an action no door performs would be a permission with nothing behind it.
#   * a new grant is created DISABLED - the column's own default - so creating one records an
#     intention and arming it is the separate PATCH. Together with `AI_AUTONOMY` false (decision 6),
#     enabling autonomy is three deliberate acts, and no single mistake can put a price on the
#     storefront.
#
# Grants are looked up at execution time by the identity the SERVER decoded from the bearer token
# (decision 2), never by anything a caller sends, so a row written here authorises exactly one
# identity - one agent's grant can never be spent by another, nor by its sponsor.
# ===========================================================================

# outward = reaches the customer (ADR 0008 decision 3). Everything else the rail dispatches is
# inventory, which is why this map lists the exception rather than both halves: a new TOOL_ROLES
# action added without a thought lands on the safe side, and the class is visible in the panel.
ACTION_CLASSES = {"price": "outward", "list": "outward"}
GRANT_MIN_CAP = 1
GRANT_MAX_CAP = 100

GRANT_COLUMNS = "id, identity_id, action, action_class, daily_cap, enabled, created_at"


class GrantIn(BaseModel):
    """A new grant. Deliberately no `action_class` and no `enabled`: see the block comment above."""

    action: str = Field(min_length=1, max_length=40)
    daily_cap: int = Field(ge=GRANT_MIN_CAP, le=GRANT_MAX_CAP)


class GrantPatchIn(BaseModel):
    """A change to an existing grant. At least one field must be present (422 otherwise)."""

    enabled: bool | None = None
    daily_cap: int | None = Field(default=None, ge=GRANT_MIN_CAP, le=GRANT_MAX_CAP)


def _action_class(action: str) -> str:
    """The class of a dispatchable action: outward for what reaches the storefront, inventory else."""
    return ACTION_CLASSES.get(action, "inventory")


async def _agent_row(db, agent_id: int):
    """The identity, or None. `autonomy_grants.identity_id` is deliberately not a foreign key - a
    grant's identity spans two parents - so existence is enforced HERE, on the authorisation path,
    which is exactly what migration 0011 says it is waiting for."""
    return (await db.execute(text("SELECT id, name, revoked_at FROM agent_tokens WHERE id = :i"),
                             {"i": agent_id})).mappings().first()


async def _grant_row(db, grant_id: int):
    return (await db.execute(text("SELECT " + GRANT_COLUMNS + " FROM autonomy_grants WHERE id = :i"),
                             {"i": grant_id})).mappings().first()


async def _grant_json(r, row) -> dict:
    """One grant as this surface reports it, with TODAY's usage read from the cap key.

    `used_today` is the same counter the execution path reserves against (`staff_ai._cap_key`), read
    from the same Redis store - so the number an admin sees is the number the gate enforces, not a
    parallel tally that could drift from it. It is None - not 0 - when Redis could not be read: an
    unavailable counter is not a zero, and the panel says "unknown" instead of a reassuring 0.
    """
    try:
        used = int(await r.get(staff_ai._cap_key("agent", int(row["identity_id"]), row["action"])) or 0)
    except Exception:
        used = None
    return {"id": row["id"], "action": row["action"], "action_class": row["action_class"],
            "daily_cap": row["daily_cap"], "enabled": row["enabled"],
            "created_at": row["created_at"].isoformat(), "used_today": used,
            "remaining_today": None if used is None else max(int(row["daily_cap"]) - used, 0)}


@router.get("/{agent_id}/grants")
async def list_grants(agent_id: int, staff: dict = Depends(require_roles("admin")), db=Depends(get_db)):
    """This identity's grants, with today's usage, and the actions that may be granted at all.

    `grantable_actions` is served rather than hardcoded in the page so the UI cannot offer an action
    the rail cannot dispatch, or show a class the server would not write.
    """
    agent = await _agent_row(db, agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="agent not found")
    rows = (await db.execute(text(
        "SELECT " + GRANT_COLUMNS + " FROM autonomy_grants"
        " WHERE identity_type = 'agent' AND identity_id = :i ORDER BY action"), {"i": agent_id})).mappings().all()
    r = get_redis()
    return {"agent_id": agent_id, "name": agent["name"], "identity_type": "agent",
            "usage_date": date.today().isoformat(),
            "grants": [await _grant_json(r, row) for row in rows],
            "grantable_actions": [{"action": a, "action_class": _action_class(a)}
                                  for a in sorted(staff_ops.GUARDED_ACTIONS)],
            "cap_min": GRANT_MIN_CAP, "cap_max": GRANT_MAX_CAP}


@router.post("/{agent_id}/grants", status_code=201)
async def create_grant(agent_id: int, body: GrantIn,
                       staff: dict = Depends(require_roles("admin")), db=Depends(get_db)):
    """Grant one dispatchable action to this identity, disabled. Audited (agent/grant_create)."""
    await staff_ops._require_role(staff, ("admin",), ACTION_GRANT_CREATE, None)
    agent = await _agent_row(db, agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="agent not found")
    if body.action not in staff_ops.GUARDED_ACTIONS:
        raise HTTPException(status_code=422, detail="action is not one the rail can dispatch")
    action_class = _action_class(body.action)
    try:
        row = (await db.execute(text(
            "INSERT INTO autonomy_grants (identity_type, identity_id, action, action_class, daily_cap)"
            " VALUES ('agent', :i, :a, :c, :cap) RETURNING " + GRANT_COLUMNS),
            {"i": agent_id, "a": body.action, "c": action_class, "cap": body.daily_cap})).mappings().one()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="this identity already has a grant for that action")
    await audit(db, "staff", entity="agent", entity_id=row["id"], action="grant_create",
                actor_id=staff["id"], after={"identity_type": "agent", "identity_id": agent_id,
                                             "action": row["action"], "action_class": row["action_class"],
                                             "daily_cap": row["daily_cap"], "enabled": row["enabled"]})
    await db.commit()
    return await _grant_json(get_redis(), row)


@router.patch("/{grant_id}")
async def update_grant(grant_id: int, body: GrantPatchIn,
                       staff: dict = Depends(require_roles("admin")), db=Depends(get_db)):
    """Arm, disarm or re-cap one grant. Audited (agent/grant_updated).

    Disarming stops the NEXT execution and nothing else: an action already dispatched is not undone
    (ADR 0008 decision 10), and the audit row is what records who changed it and when.

    The path names the grant, not the identity, so it sits beside `/{agent_id}/rotate` in the same
    `/staff/agents` namespace - the verbs keep them apart, and a grant id that names nothing is a
    404 rather than a silent no-op.
    """
    await staff_ops._require_role(staff, ("admin",), ACTION_GRANT_UPDATE, None)
    before = await _grant_row(db, grant_id)
    if before is None:
        raise HTTPException(status_code=404, detail="grant not found")
    sets, params = [], {"i": grant_id}
    if body.enabled is not None:
        sets.append("enabled = :e")
        params["e"] = body.enabled
    if body.daily_cap is not None:
        sets.append("daily_cap = :c")
        params["c"] = body.daily_cap
    if not sets:
        raise HTTPException(status_code=422, detail="nothing to update")
    after = (await db.execute(text("UPDATE autonomy_grants SET " + ", ".join(sets) +
                                   " WHERE id = :i RETURNING " + GRANT_COLUMNS), params)).mappings().one()
    await audit(db, "staff", entity="agent", entity_id=grant_id, action="grant_updated",
                actor_id=staff["id"],
                before={"enabled": before["enabled"], "daily_cap": before["daily_cap"]},
                after={"enabled": after["enabled"], "daily_cap": after["daily_cap"]})
    await db.commit()
    return await _grant_json(get_redis(), after)


@router.delete("/{grant_id}")
async def revoke_grant(grant_id: int, staff: dict = Depends(require_roles("admin")), db=Depends(get_db)):
    """Remove a grant outright. Audited (agent/grant_revoked).

    Disabling and deleting differ in one way that matters: a disabled row keeps its cap history
    attached to the (identity, action) pair, while a deleted one lets the pair be created fresh.
    Both gate the future only - ADR 0008 decision 10 is the operator-facing half of this response.
    """
    await staff_ops._require_role(staff, ("admin",), ACTION_GRANT_REVOKE, None)
    row = await _grant_row(db, grant_id)
    if row is None:
        raise HTTPException(status_code=404, detail="grant not found")
    await db.execute(text("DELETE FROM autonomy_grants WHERE id = :i"), {"i": grant_id})
    await audit(db, "staff", entity="agent", entity_id=grant_id, action="grant_revoked",
                actor_id=staff["id"],
                before={"action": row["action"], "action_class": row["action_class"],
                        "daily_cap": row["daily_cap"], "enabled": row["enabled"]})
    await db.commit()
    return {"id": grant_id, "revoked": True, "action": row["action"],
            "note": "the next execution is refused; an action already dispatched is not undone"}
