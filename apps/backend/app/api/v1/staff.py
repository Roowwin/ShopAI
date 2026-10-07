from fastapi import APIRouter, Cookie, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import text

from app.api.v1 import sessions
from app.api.v1.deps import get_mfa_challenge, get_staff, require_roles
from app.core import security
from app.core.config import get_settings
from app.core.db import get_db

router = APIRouter(prefix="/staff", tags=["staff-auth"])

class LoginIn(BaseModel):
    email: str
    password: str

class CodeIn(BaseModel):
    code: str

async def _fetch(db, public_id: str):
    return (await db.execute(text("SELECT id, public_id::text, role, totp_secret, totp_enabled FROM staff_users WHERE public_id = :p"),
                             {"p": public_id})).mappings().first()

@router.post("/auth/login")
async def login(body: LoginIn, response: Response, db=Depends(get_db)):
    row = (await db.execute(text("SELECT s.id, s.public_id::text, s.role, s.status, s.totp_enabled, p.password_hash FROM staff_users s JOIN staff_passwords p ON p.staff_id = s.id WHERE s.email = :e"),
                            {"e": body.email})).mappings().first()
    if row is None or row["status"] != "active" or not security.verify_password(row["password_hash"], body.password):
        raise HTTPException(status_code=401, detail="invalid credentials")
    if row["totp_enabled"]:
        return {"requires_mfa": True,
                "challenge": security.create_access(typ="mfa_challenge", sub=row["public_id"], ttl_minutes=5)}
    return await sessions.issue(db, "staff", row["id"], row["public_id"], row["role"], response)

@router.post("/auth/mfa/verify")
async def mfa_verify(body: CodeIn, response: Response, challenge: dict = Depends(get_mfa_challenge), db=Depends(get_db)):
    row = await _fetch(db, challenge["sub"])
    if row is None or not row["totp_enabled"] or not row["totp_secret"]:
        raise HTTPException(status_code=401, detail="mfa not active")
    if not security.verify_totp(row["totp_secret"], body.code):
        raise HTTPException(status_code=401, detail="invalid code")
    return await sessions.issue(db, "staff", row["id"], row["public_id"], row["role"], response)

@router.post("/auth/mfa/setup")
async def mfa_setup(staff: dict = Depends(get_staff), db=Depends(get_db)):
    if staff["totp_enabled"]:
        raise HTTPException(status_code=400, detail="mfa already enabled")
    secret = security.generate_totp_secret()
    await db.execute(text("UPDATE staff_users SET totp_secret = :s WHERE id = :i"), {"s": secret, "i": staff["id"]})
    await db.commit()
    return {"secret": secret, "uri": security.totp_uri(secret, staff["email"])}

@router.post("/auth/mfa/enable")
async def mfa_enable(body: CodeIn, staff: dict = Depends(get_staff), db=Depends(get_db)):
    row = await _fetch(db, staff["public_id"])
    if row is None or not row["totp_secret"]:
        raise HTTPException(status_code=400, detail="run setup first")
    if not security.verify_totp(row["totp_secret"], body.code):
        raise HTTPException(status_code=401, detail="invalid code")
    await db.execute(text("UPDATE staff_users SET totp_enabled = true WHERE id = :i"), {"i": row["id"]})
    await db.commit()
    return {"enabled": True}

@router.post("/auth/refresh")
async def refresh(response: Response, rfo_rt_staff: str | None = Cookie(default=None), db=Depends(get_db)):
    identity_id = await sessions.rotate(db, "staff", rfo_rt_staff)
    row = (await db.execute(text("SELECT id, public_id::text, role FROM staff_users WHERE id = :i"), {"i": identity_id})).mappings().first()
    if row is None:
        raise HTTPException(status_code=401, detail="account gone")
    return await sessions.issue(db, "staff", row["id"], row["public_id"], row["role"], response)

@router.post("/auth/logout", status_code=204)
async def logout(response: Response, rfo_rt_staff: str | None = Cookie(default=None), db=Depends(get_db)):
    await sessions.revoke(db, "staff", rfo_rt_staff)
    sessions.clear_refresh_cookie(response, "staff")

@router.get("/me")
async def me(staff: dict = Depends(get_staff)):
    return staff

@router.get("/admin/ping")   # scaffold: proves RBAC; replaced by real admin routes in Phase 4
async def admin_ping(staff: dict = Depends(require_roles("admin"))):
    return {"pong": True, "role": staff["role"]}