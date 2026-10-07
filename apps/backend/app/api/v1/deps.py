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