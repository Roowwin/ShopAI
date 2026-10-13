"""The Team page's doors: who is on staff, what they may do, and how to take their access away.

WHY THIS IS ITS OWN MODULE. `staff_ops` is the inventory write surface and `staff_agents` is the
agent-identity rail; neither is about the staff table itself. These are the first routes in this
codebase whose SUBJECT is the roster, and appending them to `staff_ops` - already the largest module
in the backend - would have made it larger rather than making this one exist.

EVERY ROUTE IS ADMIN-ONLY, AND THE GUARD IS IN THE BODY AS WELL AS THE DEPENDENCY. The decorator is
how a request is refused; `_require_admin` is how a plain-function dispatch is refused, because
`staff_ai.chat` calls handlers directly and a `Depends` never evaluates there
(`staff_ops._require_role` is the precedent and exists for exactly this reason). None of these
actions is in `GUARDED_ACTIONS`, so no agent grant can reach them - they are not grantable, which is
a fact of the name rather than of the branch order.

THE THREE REFUSALS THAT ARE NOT OBVIOUS, each a way an administrator locks the platform out:

* **Your own role.** An admin who changes their own role loses the screen they are standing on - the
  next request is a 403 from a page that cannot fix itself. Refused, with the fix named: another
  admin does it.
* **The last admin, demoted or suspended.** The role CHECK admits five roles and exactly one can
  administer; a platform whose last admin has just stepped down has no route back in short of a
  database console. Both doors ask the same question - "is this the only active admin?" - and both
  answer with a refusal.
* **Your own password, through this door.** A reset revokes the target's sessions by design (below),
  so an admin resetting themselves would be signed out of the screen they just used. Their own
  password has a normal flow; this one is for someone else's.

A SUSPENSION REVOKES SESSIONS, AND SO DOES A RESET. `staff_users.status` is only consulted when an
access token is exchanged (`deps.get_staff` re-reads the row), so a suspended member's refresh cookie
would keep minting access tokens until that read - and a reset that left the old password's sessions
alive would not be a reset. Both doors revoke the member's live refresh tokens in the same
transaction as the change, so the two are one act or neither.

NOTHING HERE EVER READS A SECRET BACK. The list selects named columns and never `password_hash` or
`totp_secret`. The only plaintext this module emits is a password it has just minted, once, in the
response to the reset that minted it - the same contract `bootstrap_staff.py` keeps with the operator
who runs it.
"""

import secrets

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text

from app.api.v1.deps import require_roles
from app.core import security
from app.core.db import get_db
from app.services.audit import audit

router = APIRouter(prefix="/staff", tags=["staff-team"])

# The five roles an operator may assign. `staff_users.role` also admits 'agent' since 0010 widened
# the CHECK, and it is deliberately NOT offered: a real agent identity is an `agent_tokens` row with
# its own token class (ADR 0007 decision 7), and a staff row carrying role='agent' would be an
# identity that can sign in and reach nothing. That is a confusing state, not a useful one.
ASSIGNABLE_ROLES = ("admin", "manager", "technician", "warehouse", "sales")

STATUSES = ("active", "suspended")


def _require_admin(staff: dict) -> None:
    """The in-body twin of ``Depends(require_roles("admin"))``, with a byte-identical refusal so an
    identity turned away by one guard is indistinguishable from one turned away by the other."""
    if staff.get("role") != "admin":
        raise HTTPException(status_code=403, detail="insufficient role")


async def _member(db, member_id: int):
    row = (await db.execute(text(
        "SELECT id, email, role, status FROM staff_users WHERE id = :i"), {"i": member_id})).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="no such staff user")
    return row


async def _active_admins(db) -> int:
    return (await db.execute(text(
        "SELECT count(*) FROM staff_users WHERE role = 'admin' AND status = 'active'"))).scalar_one()


async def _revoke_sessions(db, member_id: int) -> int:
    """Kill the member's live refresh tokens, and report how many - the audit row records it."""
    res = await db.execute(text(
        "UPDATE refresh_tokens SET revoked_at = now()"
        " WHERE identity_type = 'staff' AND identity_id = :i AND revoked_at IS NULL"), {"i": member_id})
    return res.rowcount or 0


@router.get("/team")
async def list_team(staff: dict = Depends(require_roles("admin")), db=Depends(get_db)):
    """The roster, with what an administrator actually needs to see about each person.

    `sessions` is the count of live refresh tokens: the one piece of state that explains a member's
    experience, so an operator asking "why was Sam signed out" gets the number that answers it.
    `is_you` is computed here rather than left to the page, so the screen that disables your own
    controls and the server that refuses the write agree by construction.
    """
    _require_admin(staff)
    rows = (await db.execute(text(
        "SELECT s.id, s.public_id::text AS public_id, s.email, s.display_name, s.role, s.status,"
        "       s.totp_enabled, s.created_at,"
        "       (SELECT count(*) FROM refresh_tokens t"
        "         WHERE t.identity_type = 'staff' AND t.identity_id = s.id"
        "           AND t.revoked_at IS NULL AND t.expires_at > now()) AS sessions"
        "  FROM staff_users s ORDER BY s.role, s.email"))).mappings().all()
    return {
        "total": len(rows),
        "roles": list(ASSIGNABLE_ROLES),
        "members": [
            {
                "id": r["id"],
                "public_id": r["public_id"],
                "email": r["email"],
                "display_name": r["display_name"],
                "role": r["role"],
                "status": r["status"],
                "totp_enabled": bool(r["totp_enabled"]),
                "sessions": int(r["sessions"]),
                "created_at": r["created_at"].isoformat() if r["created_at"] else None,
                "is_you": r["id"] == staff["id"],
            }
            for r in rows
        ],
    }


class RoleIn(BaseModel):
    role: str


@router.patch("/team/{member_id}/role")
async def set_role(member_id: int, body: RoleIn, staff: dict = Depends(require_roles("admin")), db=Depends(get_db)):
    """Assign a role. The role is the ONLY thing that decides what a member can reach - every
    `/staff/*` door reads it per request - so this is the platform's whole authorisation surface."""
    _require_admin(staff)
    if body.role not in ASSIGNABLE_ROLES:
        raise HTTPException(status_code=422, detail="role must be one of " + ", ".join(ASSIGNABLE_ROLES))
    if member_id == staff["id"]:
        raise HTTPException(status_code=409, detail="you cannot change your own role - ask another admin")
    row = await _member(db, member_id)
    if row["role"] == body.role:
        return {"member_id": member_id, "email": row["email"], "role": body.role, "changed": False}
    if row["role"] == "admin" and await _active_admins(db) <= 1:
        raise HTTPException(status_code=409, detail="this is the last active admin - promote someone else first")
    await db.execute(text("UPDATE staff_users SET role = :r, updated_at = now() WHERE id = :i"),
                     {"r": body.role, "i": member_id})
    await audit(db, "staff", entity="staff", entity_id=member_id, action="role_changed",
                actor_id=staff["id"], before={"role": row["role"]}, after={"role": body.role},
                meta={"email": row["email"]})
    await db.commit()
    return {"member_id": member_id, "email": row["email"], "role": body.role, "changed": True}


class StatusIn(BaseModel):
    status: str


@router.patch("/team/{member_id}/status")
async def set_status(member_id: int, body: StatusIn, staff: dict = Depends(require_roles("admin")), db=Depends(get_db)):
    """Suspend or reinstate a member. Suspension revokes their sessions in the same transaction: a
    suspended account that can still refresh is not suspended."""
    _require_admin(staff)
    if body.status not in STATUSES:
        raise HTTPException(status_code=422, detail="status must be active or suspended")
    if member_id == staff["id"]:
        raise HTTPException(status_code=409, detail="you cannot suspend your own account")
    row = await _member(db, member_id)
    if row["status"] == body.status:
        return {"member_id": member_id, "email": row["email"], "status": body.status,
                "changed": False, "sessions_revoked": 0}
    if body.status == "suspended" and row["role"] == "admin" and await _active_admins(db) <= 1:
        raise HTTPException(status_code=409, detail="this is the last active admin - promote someone else first")
    await db.execute(text("UPDATE staff_users SET status = :s, updated_at = now() WHERE id = :i"),
                     {"s": body.status, "i": member_id})
    revoked = await _revoke_sessions(db, member_id) if body.status == "suspended" else 0
    await audit(db, "staff", entity="staff", entity_id=member_id, action="status_changed",
                actor_id=staff["id"], before={"status": row["status"]}, after={"status": body.status},
                meta={"email": row["email"], "sessions_revoked": revoked})
    await db.commit()
    return {"member_id": member_id, "email": row["email"], "status": body.status,
            "changed": True, "sessions_revoked": revoked}


@router.post("/team/{member_id}/password-reset")
async def reset_password(member_id: int, staff: dict = Depends(require_roles("admin")), db=Depends(get_db)):
    """Mint a new password for a member and hand it back exactly once.

    The plaintext exists in this function, in the response, and nowhere else: the row stores only
    `hash_password`, and the audit row records THAT a reset happened, never what it set. The member's
    sessions die with the old password, so a stolen cookie does not outlive the credential it was
    taken with.
    """
    _require_admin(staff)
    if member_id == staff["id"]:
        raise HTTPException(status_code=409, detail="use the sign-in flow to change your own password")
    row = await _member(db, member_id)
    pw = secrets.token_urlsafe(18)
    await db.execute(text(
        "INSERT INTO staff_passwords (staff_id, password_hash) VALUES (:i, :h)"
        " ON CONFLICT (staff_id) DO UPDATE SET password_hash = EXCLUDED.password_hash"),
        {"i": member_id, "h": security.hash_password(pw)})
    revoked = await _revoke_sessions(db, member_id)
    await audit(db, "staff", entity="staff", entity_id=member_id, action="password_reset",
                actor_id=staff["id"], meta={"email": row["email"], "sessions_revoked": revoked})
    await db.commit()
    return {"member_id": member_id, "email": row["email"], "password": pw,
            "shown_once": True, "sessions_revoked": revoked}
