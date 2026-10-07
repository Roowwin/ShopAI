import hashlib
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, Response
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import security
from app.core.config import get_settings

def zone_type(zone: str) -> str:
    return "customer" if zone == "store" else "staff"

def cookie_name(zone: str) -> str:
    return "rfo_rt_staff" if zone == "staff" else "rfo_rt_store"

def cookie_path(zone: str) -> str:
    return "/staff/auth" if zone == "staff" else "/store/auth"

def set_refresh_cookie(response: Response, zone: str, token: str) -> None:
    response.set_cookie(cookie_name(zone), token,
                        max_age=get_settings().JWT_REFRESH_TTL_DAYS * 86400,
                        httponly=True, secure=True, samesite="lax", path=cookie_path(zone))

def clear_refresh_cookie(response: Response, zone: str) -> None:
    response.delete_cookie(cookie_name(zone), path=cookie_path(zone))

async def issue(db: AsyncSession, zone: str, identity_id: int, public_id: str, role: str | None, response: Response) -> dict:
    access = security.create_access(typ=zone_type(zone), sub=public_id, role=role)
    raw, h = security.create_refresh()
    exp = datetime.now(timezone.utc) + timedelta(days=get_settings().JWT_REFRESH_TTL_DAYS)
    await db.execute(text("INSERT INTO refresh_tokens (identity_type, identity_id, token_hash, expires_at) VALUES (:t, :i, :h, :e)"),
                     {"t": zone_type(zone), "i": identity_id, "h": h, "e": exp})
    await db.commit()
    set_refresh_cookie(response, zone, raw)
    return {"access_token": access, "token_type": "bearer", "expires_in": get_settings().JWT_ACCESS_TTL_MINUTES * 60}

def _hash(refresh: str) -> str:
    return hashlib.sha256(refresh.encode()).hexdigest()

async def rotate(db: AsyncSession, zone: str, refresh: str | None) -> int:
    if not refresh:
        raise HTTPException(status_code=401, detail="missing refresh token")
    row = (await db.execute(text("SELECT id, identity_id, identity_type, expires_at, revoked_at FROM refresh_tokens WHERE token_hash = :h"),
                            {"h": _hash(refresh)})).mappings().first()
    if row is None or row["identity_type"] != zone_type(zone):
        raise HTTPException(status_code=401, detail="invalid session")
    if row["revoked_at"] is not None:
        await db.execute(text("UPDATE refresh_tokens SET revoked_at = now() WHERE identity_type = :t AND identity_id = :i AND revoked_at IS NULL"),
                         {"t": row["identity_type"], "i": row["identity_id"]})
        await db.commit()
        raise HTTPException(status_code=401, detail="session reuse detected - all sessions revoked")
    if row["expires_at"] < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="session expired")
    await db.execute(text("UPDATE refresh_tokens SET revoked_at = now() WHERE id = :i"), {"i": row["id"]})
    await db.commit()
    return row["identity_id"]

async def revoke(db: AsyncSession, zone: str, refresh: str | None) -> None:
    if not refresh:
        return
    await db.execute(text("UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = :h AND revoked_at IS NULL"),
                     {"h": _hash(refresh)})
    await db.commit()