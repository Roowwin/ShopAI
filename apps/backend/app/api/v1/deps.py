import hashlib
import hmac

from datetime import datetime, timezone

import jwt
from fastapi import Depends, HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import security
from app.core.db import get_db

_bearer = HTTPBearer(auto_error=False)

def _cred(cred: HTTPAuthorizationCredentials | None) -> str:
    if cred is None:
        raise HTTPException(status_code=401, detail="missing bearer token")
    return cred.credentials

async def get_customer(cred: HTTPAuthorizationCredentials | None = Security(_bearer), db: AsyncSession = Depends(get_db)) -> dict:
    try:
        p = security.decode_access(_cred(cred), "customer")
    except (jwt.PyJWTError, ValueError):
        raise HTTPException(status_code=401, detail="invalid token")
    row = (await db.execute(text("SELECT id, public_id::text, email, display_name, status FROM users WHERE public_id = :p"),
                            {"p": p["sub"]})).mappings().first()
    if row is None or row["status"] != "active":
        raise HTTPException(status_code=401, detail="account unavailable")
    return {"id": row["id"], "public_id": row["public_id"], "email": row["email"], "display_name": row["display_name"]}

async def get_staff(cred: HTTPAuthorizationCredentials | None = Security(_bearer), db: AsyncSession = Depends(get_db)) -> dict:
    try:
        p = security.decode_access(_cred(cred), "staff")
    except (jwt.PyJWTError, ValueError):
        raise HTTPException(status_code=401, detail="invalid token")
    row = (await db.execute(text("SELECT id, public_id::text, email, role, status, totp_enabled FROM staff_users WHERE public_id = :p"),
                            {"p": p["sub"]})).mappings().first()
    if row is None or row["status"] != "active":
        raise HTTPException(status_code=401, detail="account unavailable")
    return {"id": row["id"], "public_id": row["public_id"], "email": row["email"], "role": row["role"], "totp_enabled": row["totp_enabled"]}

async def get_agent(cred: HTTPAuthorizationCredentials | None = Security(_bearer), db: AsyncSession = Depends(get_db)) -> dict:
    """The agent identity class (ADR 0007 decision 1), decoded from its own token type.

    A distinct JWT `typ` is the whole wall (ADR 0007 decision 7). `get_staff` only ever accepts
    typ="staff", so an agent bearer is 401 everywhere a staff token is the credential; the ONLY
    door that calls this decoder is the assistant chat surface, which is why an agent cannot carry
    staff reach simply by holding a token. Never mint an agent as a staff token with role="agent":
    get_staff would then accept it on every /staff/* route.

    A row is usable only while it is unrevoked, unexpired, and its stored SHA-256 still matches the
    presented plaintext - that last check is what makes rotate() kill the previous token at once,
    and it is compared in constant time.
    """
    raw = _cred(cred)
    try:
        p = security.decode_access(raw, "agent")
        agent_id = int(p["sub"])
    except (jwt.PyJWTError, ValueError, TypeError):
        raise HTTPException(status_code=401, detail="invalid token")
    row = (await db.execute(text(
        "SELECT t.id, t.name, t.scopes, t.expires_at, t.revoked_at, t.token_hash,"
        "       s.id AS staff_id, s.public_id::text AS staff_public_id, s.email, s.role, s.status"
        " FROM agent_tokens t JOIN staff_users s ON s.id = t.staff_id WHERE t.id = :i"),
        {"i": agent_id})).mappings().first()
    if (row is None or row["revoked_at"] is not None or row["status"] != "active"
            or row["expires_at"] <= datetime.now(timezone.utc)):
        raise HTTPException(status_code=401, detail="agent unavailable")
    if not hmac.compare_digest(row["token_hash"], hashlib.sha256(raw.encode()).hexdigest()):
        raise HTTPException(status_code=401, detail="agent token rotated")
    return {"id": row["id"], "name": row["name"], "scopes": list(row["scopes"] or []),
            "expires_at": row["expires_at"], "staff_id": row["staff_id"],
            "staff_public_id": row["staff_public_id"], "email": row["email"], "role": row["role"]}

def require_roles(*roles: str):
    async def _dep(staff: dict = Depends(get_staff)) -> dict:
        if roles and staff["role"] not in roles:
            raise HTTPException(status_code=403, detail="insufficient role")
        return staff
    return _dep

async def get_mfa_challenge(cred: HTTPAuthorizationCredentials | None = Security(_bearer)) -> dict:
    try:
        return security.decode_access(_cred(cred), "mfa_challenge")
    except (jwt.PyJWTError, ValueError):
        raise HTTPException(status_code=401, detail="invalid mfa challenge")