"""Agent identity rail - token lifecycle and the agent's own door (ADR 0007, identity plumbing only).

An agent is a third identity class: an admin mints a rotatable, revocable, expiring token bound to a
staff sponsor, and the agent speaks the assistant with it. Nothing here grants autonomy. The agent's
turn goes through the same chat handler a staff token reaches, so it can propose and it can execute
only what a human confirms; the grant-scoped authorisation branch, the caps and the audit marker are
ADR 0008's Preconditions and are deliberately NOT built here.

Token handling: the plaintext leaves this module exactly once, in the response to create/rotate. The
row keeps a SHA-256 of it - the same treatment refresh_tokens takes - and every read here is written
so the hash cannot be returned by accident: the listing selects named columns and never token_hash.
"""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.api.v1 import staff_ai
from app.api.v1.deps import get_agent, require_roles
from app.core import security
from app.core.db import get_ai_db, get_db

router = APIRouter(prefix="/staff/agents", tags=["staff-agents"])

DEFAULT_TTL_DAYS = 90
MAX_TTL_DAYS = 365


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


@router.post("/chat")
async def agent_chat(body: staff_ai.ChatIn, agent: dict = Depends(get_agent), db=Depends(get_db),
                     ai_db=Depends(get_ai_db)):
    """The agent's door into the assistant - the assistant surface, and the only one (ADR 0007 d.7).

    The agent speaks as its bound staff sponsor, through the SAME chat handler a staff token reaches:
    same TOOL_ROLES gate, same propose/execute split, so a write still needs the human Confirm. The
    grant-scoped branch of ADR 0008 decision 9 - the one that would let an agent past TOOL_ROLES -
    is not here and must not be added until that ADR's Preconditions are met.
    """
    return await staff_ai.chat(body=body, staff={"id": agent["staff_id"], "email": agent["email"],
                                                "role": agent["role"]}, db=db, ai_db=ai_db)


@router.post("/{agent_id}/rotate")
async def rotate_agent(agent_id: int, staff: dict = Depends(require_roles("admin")), db=Depends(get_db)):
    """New token, printed once; the previous one stops authenticating on the next request.

    Rotation cannot un-revoke: a revoked identity stays revoked (409) and is replaced by a new one.
    """
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
    row = (await db.execute(text("SELECT id, revoked_at FROM agent_tokens WHERE id = :i"),
                            {"i": agent_id})).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="agent not found")
    if row["revoked_at"] is None:
        await db.execute(text("UPDATE agent_tokens SET revoked_at = now() WHERE id = :i"), {"i": agent_id})
        await db.commit()
    return {"id": agent_id, "revoked": True}
