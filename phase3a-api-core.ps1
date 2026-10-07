#Requires -Version 5.1
<# RFO Phase 3a: FastAPI container core - config, async db (pgbouncer-safe),
   security primitives (argon2id, jwt, totp), request-id middleware, health,
   compose api service + nginx wiring. Run from project root. #>
[CmdletBinding()]
param([string]$ProjectRoot = (Get-Location).Path)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
if (-not (Test-Path (Join-Path $ProjectRoot '.env'))) { throw ".env missing" }

function Write-TextFile {
    param([string]$Rel, [string]$Content)
    $full = Join-Path $ProjectRoot $Rel
    $dir = Split-Path $full -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    [IO.File]::WriteAllText($full, ($Content -replace "`r`n", "`n"), $Utf8NoBom)
    Write-Host "  create  $Rel" -ForegroundColor Green
}

Write-TextFile 'apps/backend/requirements.txt' @'
fastapi>=0.115
uvicorn[standard]>=0.30
sqlalchemy[asyncio]>=2.0.30
asyncpg>=0.29
alembic>=1.13
pydantic>=2.7
pydantic-settings>=2.3
argon2-cffi>=23.1
PyJWT>=2.8
pyotp>=2.8
httpx>=0.27
pytest>=8
pytest-asyncio>=0.23
'@

Write-TextFile 'apps/backend/Dockerfile' @'
FROM public.ecr.aws/docker/library/python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
'@

Write-TextFile 'apps/backend/app/__init__.py' ''
Write-TextFile 'apps/backend/app/core/__init__.py' ''

Write-TextFile 'apps/backend/app/core/config.py' @'
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(case_sensitive=True)
    APP_ENV: str = "development"
    LOG_LEVEL: str = "INFO"
    CORS_ORIGINS_STORE: str = "https://shop.rfo.localhost"
    CORS_ORIGINS_STAFF: str = "https://admin.rfo.localhost"
    DATABASE_URL: str
    JWT_SECRET: str
    JWT_ACCESS_TTL_MINUTES: int = 15
    JWT_REFRESH_TTL_DAYS: int = 14
    AI_PROVIDER: str = ""
    AI_ENDPOINT: str = ""
    AI_TEXT_MODEL: str = ""
    AI_VISION_MODEL: str = ""
    AI_EMBED_MODEL: str = ""

    @property
    def cors_origins(self) -> list[str]:
        out = []
        for v in (self.CORS_ORIGINS_STORE, self.CORS_ORIGINS_STAFF):
            out.extend(o.strip() for o in v.split(",") if o.strip())
        return out

    @property
    def is_prod(self) -> bool:
        return self.APP_ENV.lower() in ("production", "prod")

@lru_cache
def get_settings() -> Settings:
    return Settings()
'@

Write-TextFile 'apps/backend/app/core/db.py' @'
from collections.abc import AsyncIterator
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from app.core.config import get_settings

_engine: AsyncEngine | None = None

def get_engine() -> AsyncEngine:
    global _engine
    if _engine is None:
        _engine = create_async_engine(
            get_settings().DATABASE_URL,
            pool_pre_ping=True,
            pool_size=10,
            max_overflow=20,
            pool_recycle=1800,
            # PgBouncer transaction mode: prepared-statement caches stay OFF at app side
            connect_args={"statement_cache_size": 0, "command_cache_size": 0,
                          "server_settings": {"application_name": "rfo-api"}},
        )
    return _engine

_SessionMaker = async_sessionmaker(get_engine(), expire_on_commit=False)

async def get_db() -> AsyncIterator[AsyncSession]:
    async with _SessionMaker() as session:
        yield session
'@

Write-TextFile 'apps/backend/app/core/security.py' @'
import hashlib
import secrets
import uuid as uuidlib
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
import pyotp
from argon2 import PasswordHasher

from app.core.config import get_settings

_ph = PasswordHasher()
_HS = "HS256"

def hash_password(pw: str) -> str:
    return _ph.hash(pw)

def verify_password(pw_hash: str, pw: str) -> bool:
    try:
        return _ph.verify(pw_hash, pw)
    except Exception:
        return False

def generate_totp_secret() -> str:
    return pyotp.random_base32()

def totp_uri(secret: str, email: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=email, issuer_name="RFO Staff")

def verify_totp(secret: str, code: str) -> bool:
    return pyotp.TOTP(secret).verify(code, valid_window=1)

def _encode(payload: dict[str, Any]) -> str:
    return jwt.encode(payload, get_settings().JWT_SECRET, algorithm=_HS)

def create_access(typ: str, sub: str, role: str | None = None, ttl_minutes: int | None = None) -> str:
    s = get_settings()
    exp = datetime.now(timezone.utc) + timedelta(minutes=ttl_minutes or s.JWT_ACCESS_TTL_MINUTES)
    payload: dict[str, Any] = {"sub": sub, "typ": typ, "jti": uuidlib.uuid4().hex,
                               "iat": int(datetime.now(timezone.utc).timestamp()),
                               "exp": exp, "iss": "rfo"}
    if role:
        payload["role"] = role
    return _encode(payload)

def decode_access(token: str, expected_typ: str) -> dict[str, Any]:
    payload = jwt.decode(token, get_settings().JWT_SECRET, algorithms=[_HS],
                         options={"require": ["exp", "sub", "typ"]})
    if payload.get("typ") != expected_typ:
        raise ValueError("wrong token type for this zone")
    return payload

def create_refresh() -> tuple[str, str]:
    token = secrets.token_urlsafe(48)
    return token, hashlib.sha256(token.encode()).hexdigest()
'@

Write-TextFile 'apps/backend/app/bootstrap_staff.py' @'
import argparse
import asyncio
import secrets
import sys

from sqlalchemy import text

from app.core.db import get_engine
from app.core.security import hash_password

async def bootstrap(email: str, role: str) -> int:
    pw = secrets.token_urlsafe(18)
    engine = get_engine()
    async with engine.begin() as conn:
        row = await conn.execute(text("SELECT id FROM staff_users WHERE email = :e"), {"e": email})
        sid = row.scalar()
        if sid is not None:
            print(f"OK staff-user exists (id={sid}) - password left unchanged")
            return 0
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
    return 0

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--email", required=True)
    ap.add_argument("--role", default="admin", choices=["admin", "manager", "technician", "warehouse", "sales"])
    a = ap.parse_args()
    sys.exit(asyncio.run(bootstrap(a.email, a.role)))
'@

Write-TextFile 'apps/backend/app/main.py' @'
import logging
import time
import uuid as uuidlib

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.core.config import get_settings
from app.core.db import get_engine

logging.basicConfig(level=get_settings().LOG_LEVEL)

app = FastAPI(title="RFO API", version="0.1.0-phase3a")

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
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
        return JSONResponse(status_code=503, content={"db": False})
'@

# compose: append api service (guard)
$ccPath = Join-Path $ProjectRoot 'docker-compose.yml'
$cc = [IO.File]::ReadAllText($ccPath)
if ($cc -notmatch '(?m)^\s{2}api:') {
    $block = @'
  api:
    build: ./apps/backend
    restart: unless-stopped
    environment:
      APP_ENV: ${APP_ENV:-development}
      LOG_LEVEL: ${LOG_LEVEL:-INFO}
      DATABASE_URL: postgresql://rfo_app:${DB_APP_PASSWORD:?missing in .env}@pgbouncer:5432/rfo
      JWT_SECRET: ${JWT_SECRET:?missing in .env}
      JWT_ACCESS_TTL_MINUTES: ${JWT_ACCESS_TTL_MINUTES:-15}
      JWT_REFRESH_TTL_DAYS: ${JWT_REFRESH_TTL_DAYS:-14}
      CORS_ORIGINS_STORE: ${CORS_ORIGINS_STORE:?missing in .env}
      CORS_ORIGINS_STAFF: ${CORS_ORIGINS_STAFF:?missing in .env}
      AI_PROVIDER: ${AI_PROVIDER:-}
      AI_ENDPOINT: ${AI_ENDPOINT:-}
      AI_TEXT_MODEL: ${AI_TEXT_MODEL:-}
      AI_VISION_MODEL: ${AI_VISION_MODEL:-}
      AI_EMBED_MODEL: ${AI_EMBED_MODEL:-}
    extra_hosts: ["host.docker.internal:host-gateway"]
    networks: [edge, core]
    depends_on:
      pgbouncer: { condition: service_healthy }
    healthcheck:
      test: ["CMD-SHELL", "python -c 'import urllib.request as u; u.urlopen(\"http://127.0.0.1:8000/healthz\", timeout=5)'"]
      interval: 10s
      timeout: 5s
      retries: 12
      start_period: 10s
    <<: *logging
'@
    [IO.File]::WriteAllText($ccPath, ($cc.TrimEnd() + "`n`n" + $block), $Utf8NoBom)
    Write-Host '  patched docker-compose.yml (api service)' -ForegroundColor Green
}

# up.ps1: include api in health-wait list
$upPath = Join-Path $ProjectRoot 'scripts\up.ps1'
$upraw = [IO.File]::ReadAllText($upPath)
$old = "`$services = 'postgres','pgbouncer','redis','storage','nginx'"
if (($upraw.IndexOf($old) -ge 0) -and ($upraw -notmatch "'api'")) {
    $upraw = $upraw.Replace($old, "`$services = 'postgres','pgbouncer','redis','storage','nginx','api'")
    [IO.File]::WriteAllText($upPath, ($upraw -replace "`r`n", "`n"), $Utf8NoBom)
    Write-Host '  patched scripts/up.ps1 (api in health wait)' -ForegroundColor Green
}

# nginx template: full rewrite with api wired (zones + login limits + request id)
Write-TextFile 'infra/nginx/templates/rfo.conf.template' @'
gzip on;
gzip_comp_level 5;
gzip_types text/plain text/css application/javascript application/json image/svg+xml;
gzip_min_length 1024;

limit_req_zone  $binary_remote_addr zone=store:10m  rate=${RATE_LIMIT_STORE_RPS}r/s;
limit_req_zone  $binary_remote_addr zone=staff:10m  rate=${RATE_LIMIT_STAFF_RPS}r/s;
limit_req_zone  $binary_remote_addr zone=login:10m  rate=${RATE_LIMIT_LOGIN_RPM}r/m;
limit_conn_zone $binary_remote_addr zone=perip:10m;

log_format json_main escape=json '{"ts":"$time_iso8601","req_id":"$request_id","remote":"$remote_addr","method":"$request_method","uri":"$request_uri","status":$status,"bytes":$body_bytes_sent,"rt":$request_time,"u_rt":"$upstream_response_time"}';
access_log /var/log/nginx/access.log json_main;
error_log  /var/log/nginx/error.log warn;

upstream rfo-api { server api:8000; keepalive 32; }
upstream rfo-minio { server storage:5000; keepalive 16; }

server {
  listen 80 default_server;
  server_name _;
  location = /healthz { access_log off; return 200 "ok\n"; }
  location / { return 503 "RFO edge up - route not wired\n"; }
}

server {
  listen 80;
  server_name ${DOMAIN_STORE} ${DOMAIN_ADMIN} ${DOMAIN_API};
  location = /healthz { access_log off; return 200 "ok\n"; }
  location /.well-known/acme-challenge/ { root /var/www/certbot; }
  location / { return 301 https://$host$request_uri; }
}

server {
  listen 443 ssl;
  http2 on;
  server_name ${DOMAIN_API};
  include /etc/nginx/snippets/tls.conf;
  include /etc/nginx/snippets/headers.conf;
  client_max_body_size 25m;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto https;
  proxy_set_header X-Request-ID $request_id;
  proxy_set_header Connection "";

  location ~ ^/staff/auth/login$ { limit_req zone=login burst=5 nodelay; proxy_pass http://rfo-api; }
  location ~ ^/store/auth/login$ { limit_req zone=login burst=5 nodelay; proxy_pass http://rfo-api; }
  location ~ ^/staff/ { limit_req zone=staff burst=20 nodelay; proxy_pass http://rfo-api; }
  location ~ ^/store/ { limit_req zone=store burst=40 nodelay; proxy_pass http://rfo-api; }
  location / { proxy_pass http://rfo-api; }
}

server {
  listen 443 ssl;
  http2 on;
  server_name ${DOMAIN_STORE};
  include /etc/nginx/snippets/tls.conf;
  include /etc/nginx/snippets/headers.conf;
  location /media/ {
    proxy_pass http://rfo-minio/rfo-media/;
    proxy_set_header Connection "";
    expires 365d;
    add_header Cache-Control "public, immutable" always;
  }
  location / { return 503 "Storefront not wired yet (Phase 7)\n"; }
}

server {
  listen 443 ssl;
  http2 on;
  server_name ${DOMAIN_ADMIN};
  include /etc/nginx/snippets/tls.conf;
  include /etc/nginx/snippets/headers.conf;
  location / { return 503 "Backoffice not wired yet (Phase 6)\n"; }
}
'@

Push-Location $ProjectRoot
try {
    & docker compose config --quiet *> $null
    if ($LASTEXITCODE -ne 0) { throw 'compose invalid' }
    Write-Host '  ok      compose valid' -ForegroundColor Green

    & docker compose build api
    if ($LASTEXITCODE -ne 0) { throw 'api image build failed' }
    Write-Host '  ok      api image built' -ForegroundColor Green

    & docker compose up -d
    if ($LASTEXITCODE -ne 0) { throw 'compose up failed' }

    $deadline = (Get-Date).AddSeconds(120)
    do {
        Start-Sleep -Seconds 3
        $h = (& docker inspect rfo-api-1 --format '{{.State.Health.Status}}' 2>$null) -join ''
        Write-Host "  api health: $h"
    } while ($h -ne 'healthy' -and (Get-Date) -lt $deadline)
    if ($h -ne 'healthy') { throw 'api unhealthy - paste: docker compose logs api' }

    & docker compose up -d --force-recreate nginx
    do {
        Start-Sleep -Seconds 3
        $h = (& docker inspect rfo-nginx-1 --format '{{.State.Health.Status}}' 2>$null) -join ''
        Write-Host "  nginx health: $h"
    } while ($h -ne 'healthy' -and (Get-Date) -lt $deadline)
    if ($h -ne 'healthy') { throw 'nginx unhealthy - paste: docker compose logs nginx' }
    Write-Host '  ok      api + nginx healthy' -ForegroundColor Green
} finally { Pop-Location }

$hz = ((& curl.exe -sk https://api.rfo.localhost/healthz) -join '')
if ($hz -notmatch 'ok') { throw "healthz via edge: $hz" }
$rd = ((& curl.exe -sk https://api.rfo.localhost/readyz) -join '')
if ($rd -notmatch '"db":true') { throw "readyz via edge: $rd" }
$rt = ((& curl.exe -skI https://api.rfo.localhost/healthz) -join ' ')
if ($rt -notmatch 'X-Request-ID') { throw 'request-id missing at edge' }
Write-Host "`nPHASE 3A VERIFIED - API live through TLS edge with pooled DB." -ForegroundColor Green
Write-Host 'Next message: "phase 3b" (auth routers, MFA, refresh rotation, tests).' -ForegroundColor Yellow
