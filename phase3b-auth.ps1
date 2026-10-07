#Requires -Version 5.1
<# RFO Phase 3b (full): migration 0004, sessions/dependencies, store + staff routers,
   main rewrite, bootstrap_staff returns creds, pytest suite, Test-Phase3.
   Run from project root AFTER saving via clipboard helper. #>
[CmdletBinding()]
param([string]$ProjectRoot = (Get-Location).Path)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Write-TextFile {
    param([string]$Rel, [string]$Content)
    $full = Join-Path $ProjectRoot $Rel
    $dir = Split-Path $full -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    [IO.File]::WriteAllText($full, ($Content -replace "`r`n", "`n"), $Utf8NoBom)
    Write-Host "  create  $Rel" -ForegroundColor Green
}

Write-TextFile 'apps/backend/alembic/versions/0004_refresh_tokens.py' @'
from alembic import op

revision = "0004_refresh_tokens"
down_revision = "0003_lots"
branch_labels = None
depends_on = None

SQL = """
CREATE TABLE refresh_tokens (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  identity_type TEXT NOT NULL CHECK (identity_type IN ('staff','customer')),
  identity_id BIGINT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_identity_idx ON refresh_tokens (identity_type, identity_id);
CREATE INDEX refresh_tokens_active_idx ON refresh_tokens (identity_type, identity_id) WHERE revoked_at IS NULL;
"""

def upgrade():
    op.execute(SQL)

def downgrade():
    op.execute("DROP TABLE refresh_tokens;")
'@

Write-TextFile 'apps/backend/app/api/__init__.py' ''
Write-TextFile 'apps/backend/app/api/v1/__init__.py' ''

Write-TextFile 'apps/backend/app/api/v1/sessions.py' @'
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
'@

Write-TextFile 'apps/backend/app/api/v1/deps.py' @'
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
'@

Write-TextFile 'apps/backend/app/api/v1/store.py' @'
import re

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.api.v1 import sessions
from app.api.v1.deps import get_customer
from app.core import security
from app.core.config import get_settings
from app.core.db import get_db

router = APIRouter(prefix="/store", tags=["store-auth"])

class RegisterIn(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=10, max_length=128)
    display_name: str = Field(default="", max_length=80)

class LoginIn(BaseModel):
    email: str
    password: str

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

@router.post("/auth/register")
async def register(body: RegisterIn, response: Response, db=Depends(get_db)):
    if not _EMAIL.match(body.email):
        raise HTTPException(status_code=422, detail="invalid email")
    if not (body.password.isalnum() or re.search(r"[A-Za-z]", body.password)) or not re.search(r"[0-9]", body.password):
        raise HTTPException(status_code=422, detail="weak password")
    try:
        row = (await db.execute(text("INSERT INTO users (email, display_name) VALUES (:e, :d) RETURNING id, public_id::text"),
                                {"e": body.email, "d": body.display_name})).mappings().one()
        await db.execute(text("INSERT INTO password_credentials (user_id, password_hash) VALUES (:i, :h)"),
                         {"i": row["id"], "h": security.hash_password(body.password)})
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="email already registered")
    return await sessions.issue(db, "store", row["id"], row["public_id"], None, response)

@router.post("/auth/login")
async def login(body: LoginIn, response: Response, db=Depends(get_db)):
    row = (await db.execute(text("SELECT u.id, u.public_id::text, u.status, c.password_hash FROM users u JOIN password_credentials c ON c.user_id = u.id WHERE u.email = :e"),
                            {"e": body.email})).mappings().first()
    if row is None or row["status"] != "active" or not security.verify_password(row["password_hash"], body.password):
        raise HTTPException(status_code=401, detail="invalid credentials")
    return await sessions.issue(db, "store", row["id"], row["public_id"], None, response)

@router.post("/auth/refresh")
async def refresh(response: Response, rfo_rt_store: str | None = Cookie(default=None), db=Depends(get_db)):
    identity_id = await sessions.rotate(db, "store", rfo_rt_store)
    row = (await db.execute(text("SELECT id, public_id::text FROM users WHERE id = :i"), {"i": identity_id})).mappings().first()
    if row is None:
        raise HTTPException(status_code=401, detail="account gone")
    return await sessions.issue(db, "store", row["id"], row["public_id"], None, response)

@router.post("/auth/logout", status_code=204)
async def logout(response: Response, rfo_rt_store: str | None = Cookie(default=None), db=Depends(get_db)):
    await sessions.revoke(db, "store", rfo_rt_store)
    sessions.clear_refresh_cookie(response, "store")

@router.get("/me")
async def me(customer: dict = Depends(get_customer)):
    return customer
'@

Write-TextFile 'apps/backend/app/api/v1/staff.py' @'
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

def _fetch(db, public_id: str):
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
async def mfa_verify(body: CodeIn, challenge: dict = Depends(get_mfa_challenge), response: Response, db=Depends(get_db)):
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
'@

Write-TextFile 'apps/backend/app/main.py' @'
import logging
import time
import uuid as uuidlib

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.api.v1 import staff, store
from app.core.config import get_settings
from app.core.db import get_engine

s = get_settings()
logging.basicConfig(level=s.LOG_LEVEL)

docs = None if s.is_prod else "/docs"
app = FastAPI(title="RFO API", version="0.1.0-phase3b", docs_url=docs, redoc_url=None)

app.add_middleware(
    CORSMiddleware,
    allow_origins=s.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
    expose_headers=["X-Request-ID"],
)

@app.middleware("http")
async def request_context(request: Request, call_next):
    rid = request.headers.get("X-Request-ID") or uuidlib.uuid4().hex
    t0 = time.perf_counter()
    response = await call_next(request)
    response.headers["X-Request-ID"] = rid
    logging.info("%s %s %s %.1fms rid=%s", request.method, request.url.path,
                 response.status_code, (time.perf_counter() - t0) * 1000, rid)
    return response

app.include_router(staff.router)
app.include_router(store.router)

@app.get("/healthz")
async def healthz() -> dict:
    return {"status": "ok"}

@app.get("/readyz")
async def readyz():
    try:
        async with get_engine().connect() as conn:
            await conn.execute(text("SELECT 1"))
        return {"db": True}
    except Exception:
        logging.exception("readyz db check failed")
        return JSONResponse(status_code=503, content={"db": False})
'@

Write-TextFile 'apps/backend/app/bootstrap_staff.py' @'
import argparse
import asyncio
import hashlib
import secrets
import sys

from sqlalchemy import text

from app.core.db import get_engine
from app.core.security import hash_password, create_refresh

async def bootstrap(email: str, role: str) -> tuple[int, str | None]:
    pw = secrets.token_urlsafe(18)
    engine = get_engine()
    async with engine.begin() as conn:
        row = await conn.execute(text("SELECT id FROM staff_users WHERE email = :e"), {"e": email})
        sid = row.scalar()
        if sid is not None:
            print(f"OK staff-user exists (id={sid}) - password left unchanged")
            return sid, None
        res = await conn.execute(
            text("INSERT INTO staff_users (email, display_name, role) VALUES (:e, :dn, :role) RETURNING id"),
            {"e": email, "dn": email.split("@")[0], "role": role})
        sid = res.scalar_one()
        await conn.execute(text("INSERT INTO staff_passwords (staff_id, password_hash) VALUES (:i, :h)"),
                           {"i": sid, "h": hash_password(pw)})
    await engine.dispose()
    print(f"CREATED staff id={sid}")
    print(f"EMAIL: {email}")
    print(f"PASSWORD: {pw}")
    print("STORE CREDENTIALS SAFELY - shown once only")
    return sid, pw

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--email", required=True)
    ap.add_argument("--role", default="admin", choices=["admin", "manager", "technician", "warehouse", "sales"])
    a = ap.parse_args()
    sys.exit(0 if asyncio.run(bootstrap(a.email, a.role)) is not None else 1)
'@

Write-TextFile 'apps/backend/pytest.ini' @'
[pytest]
asyncio_mode = auto
'@

Write-TextFile 'apps/backend/tests/conftest.py' @'
import pytest_asyncio
import httpx

from app.main import app

@pytest_asyncio.fixture
async def client():
    # base_url uses https so httpx actually SENDS our Secure refresh cookies
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="https://t") as c:
        yield c
'@

Write-TextFile 'apps/backend/tests/test_auth.py' @'
import uuid
from urllib.parse import quote

import pyotp
import pytest
from sqlalchemy import text

from app.core.db import get_engine
from app.bootstrap_staff import bootstrap

async def _cleanup():
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("DELETE FROM refresh_tokens WHERE identity_id IN (SELECT id FROM staff_users WHERE email LIKE 'pytest-%') OR identity_id IN (SELECT id FROM users WHERE email LIKE 'pytest-%')"))
        await c.execute(text("DELETE FROM staff_users WHERE email LIKE 'pytest-%'"))
        await c.execute(text("DELETE FROM users WHERE email LIKE 'pytest-%'"))

async def test_health(client):
    r = await client.get("/healthz")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
    r = await client.get("/readyz")
    assert r.status_code == 200 and r.json()["db"] is True

async def test_store_register_login_me(client):
    await _cleanup()
    email = "pytest-" + uuid.uuid4().hex + "@test.rfo"
    r = await client.post("/store/auth/register", json={"email": email, "password": "Str0ngPass!23", "display_name": "T"})
    assert r.status_code == 200, r.text
    access = r.json()["access_token"]
    r2 = await client.post("/store/auth/login", json={"email": email, "password": "Str0ngPass!23"})
    assert r2.status_code == 200
    r3 = await client.get("/store/me", headers={"Authorization": "Bearer " + access})
    assert r3.status_code == 200 and r3.json()["email"] == email

async def test_refresh_rotation_theft(client):
    await _cleanup()
    email = "pytest-" + uuid.uuid4().hex + "@test.rfo"
    r = await client.post("/store/auth/register", json={"email": email, "password": "Str0ngPass!23"})
    assert r.status_code == 200
    old = client.cookies.get("rfo_rt_store")
    assert old
    r2 = await client.post("/store/auth/refresh")             # rotate -> new cookie in jar
    assert r2.status_code == 200
    client.cookies.set("rfo_rt_store", old)                    # replay the OLD token
    r3 = await client.post("/store/auth/refresh")
    assert r3.status_code == 401
    r4 = await client.post("/store/auth/refresh")              # new token also dead (theft revoke-all)
    assert r4.status_code == 401
    r5 = await client.post("/store/auth/login", json={"email": email, "password": "Str0ngPass!23"})
    assert r5.status_code == 200
    r6 = await client.post("/store/auth/refresh")              # fresh chain works again
    assert r6.status_code == 200

async def test_staff_mfa_flow(client):
    await _cleanup()
    email = "pytest-" + uuid.uuid4().hex + "@test.rfo"
    sid, pw = await bootstrap(email, "admin")
    assert pw
    r = await client.post("/staff/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200
    h = {"Authorization": "Bearer " + r.json()["access_token"]}
    r = await client.post("/staff/auth/mfa/setup", headers=h)
    assert r.status_code == 200, r.text
    secret = r.json()["secret"]
    r = await client.post("/staff/auth/mfa/enable", json={"code": pyotp.TOTP(secret).now()}, headers=h)
    assert r.status_code == 200 and r.json()["enabled"] is True
    r2 = await client.post("/staff/auth/login", json={"email": email, "password": pw})
    assert r2.status_code == 200 and r2.json().get("requires_mfa") is True
    r3 = await client.post("/staff/auth/mfa/verify",
                           json={"code": pyotp.TOTP(secret).now()},
                           headers={"Authorization": "Bearer " + r2.json()["challenge"]})
    assert r3.status_code == 200, r3.text
    r4 = await client.get("/staff/me", headers={"Authorization": "Bearer " + r3.json()["access_token"]})
    assert r4.status_code == 200 and r4.json()["role"] == "admin"

async def test_rbac_403(client):
    await _cleanup()
    email = "pytest-" + uuid.uuid4().hex + "@test.rfo"
    sid, pw = await bootstrap(email, "technician")
    assert pw
    r = await client.post("/staff/auth/login", json={"email": email, "password": pw})
    h = {"Authorization": "Bearer " + r.json()["access_token"]}
    r = await client.get("/staff/admin/ping", headers=h)
    assert r.status_code == 403
'@

Write-TextFile 'scripts/Test-Phase3.ps1' @'
#Requires -Version 5.1
# Phase 3 verification gate
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Set-Location (Split-Path $PSScriptRoot -Parent)

$pass = 0; $fail = 0
function Check {
    param([string]$Name, [scriptblock]$Body)
    try { & $Body; $script:pass++; Write-Host "  PASS  $Name" -ForegroundColor Green }
    catch { $script:fail++; Write-Host "  FAIL  $Name - $($_.Exception.Message)" -ForegroundColor Red }
}

Check 'alembic at 0004 head' {
    $out = (& docker compose run --rm migrate alembic current | Out-String)
    if ($out -notmatch '0004_refresh_tokens') { throw "revision: $out" }
}
Check 'api readyz via edge' {
    $rd = ((& curl.exe -sk https://api.rfo.localhost/readyz) -join '')
    if ($rd -notmatch '"db":true') { throw "readyz: $rd" }
}
Check 'pytest suite (health, store auth, rotation+theft, mfa, rbac)' {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & docker compose run --rm api pytest -q -x; $code = $LASTEXITCODE } finally { $ErrorActionPreference = $prev }
    if ($code -ne 0) { throw "pytest exit=$code" }
}

Write-Host "`nResult: $pass passed, $fail failed" -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
if ($fail -gt 0) { exit 1 }
Write-Host 'PHASE 3 VERIFIED - say "go phase 4".' -ForegroundColor Yellow
'@

Push-Location $ProjectRoot
try {
    & docker compose config --quiet *> $null
    if ($LASTEXITCODE -ne 0) { throw 'compose invalid' }
    Write-Host '  ok      compose valid' -ForegroundColor Green
    & docker compose build api
    if ($LASTEXITCODE -ne 0) { throw 'api build failed' }
    & docker compose up -d
    $deadline = (Get-Date).AddSeconds(120)
    do {
        Start-Sleep -Seconds 3
        $h = (& docker inspect rfo-api-1 --format '{{.State.Health.Status}}' 2>$null) -join ''
        Write-Host "  api health: $h"
    } while ($h -ne 'healthy' -and (Get-Date) -lt $deadline)
    if ($h -ne 'healthy') { throw 'api unhealthy - paste docker compose logs api --tail 40' }
    Write-Host '  ok      api healthy with routers' -ForegroundColor Green
} finally { Pop-Location }

Write-Host "`nNext: migrate 0004, bootstrap admin, then Test-Phase3" -ForegroundColor Yellow
