#Requires -Version 5.1
<# RFO Phase 5: redis client, ARQ worker (TTL release), 0007 tsvector search
   columns, worker tests, Test-Phase5. Run from project root. #>
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

Write-TextFile 'apps/backend/alembic/versions/0007_search_vectors.py' @'
from alembic import op

revision = "0007_search_vectors"
down_revision = "0006_sale_price"
branch_labels = None
depends_on = None

SQL = """
ALTER TABLE products ADD COLUMN search_vec tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(model,''))) STORED;
CREATE INDEX products_vec_idx ON products USING GIN (search_vec);
ALTER TABLE assets ADD COLUMN search_vec tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(serial_number,'') || ' ' || coalesce(grade,''))) STORED;
CREATE INDEX assets_vec_idx ON assets USING GIN (search_vec);
"""

def upgrade():
    op.execute(SQL)

def downgrade():
    op.execute("DROP INDEX IF EXISTS assets_vec_idx;")
    op.execute("DROP INDEX IF EXISTS products_vec_idx;")
    op.execute("ALTER TABLE assets DROP COLUMN IF EXISTS search_vec;")
    op.execute("ALTER TABLE products DROP COLUMN IF EXISTS search_vec;")
'@

# requirements: arq + redis
$rp = Join-Path $ProjectRoot 'apps\backend\requirements.txt'
$raw = [IO.File]::ReadAllText($rp)
if ($raw -notmatch '^arq') {
    $raw = $raw.TrimEnd() + "`narq>=0.25`nredis>=5.0`n"
    [IO.File]::WriteAllText($rp, ($raw -replace "`r`n", "`n"), $Utf8NoBom)
    Write-Host '  patched  requirements.txt (arq, redis)' -ForegroundColor Green
} else { Write-Host '  skip    requirements present' -ForegroundColor DarkGray }

# config: REDIS_URL
$cp = Join-Path $ProjectRoot 'apps\backend\app\core\config.py'
$raw = [IO.File]::ReadAllText($cp)
if ($raw -notmatch 'REDIS_URL') {
    $needle = 'PAYMENT_WEBHOOK_SECRET: str = ""'
    if ($raw.IndexOf($needle) -lt 0) { throw 'config needle missing' }
    $raw = $raw.Replace($needle, $needle + "`n" + '    REDIS_URL: str = ""')
    [IO.File]::WriteAllText($cp, ($raw -replace "`r`n", "`n"), $Utf8NoBom)
    Write-Host '  patched  config.py (REDIS_URL)' -ForegroundColor Green
} else { Write-Host '  skip    config present' -ForegroundColor DarkGray }

Write-TextFile 'apps/backend/app/core/redis.py' @'
from redis.asyncio import Redis, from_url

from app.core.config import get_settings

_client: Redis | None = None


def get_redis() -> Redis:
    global _client
    if _client is None:
        _client = from_url(get_settings().REDIS_URL)
    return _client
'@

Write-TextFile 'apps/backend/app/workers/__init__.py' ''
Write-TextFile 'apps/backend/app/workers/worker.py' @'
import json
import logging

from arq import cron
from arq.connections import RedisSettings
from sqlalchemy import text

from app.core.config import get_settings
from app.core.db import get_engine

log = logging.getLogger("rfo.worker")

RELEASE_SQL = text("""
WITH expired AS (
  UPDATE reservations SET status = 'released'
  WHERE status = 'active' AND expires_at < now()
  RETURNING asset_id
)
UPDATE assets SET status = 'listed' WHERE id IN (SELECT asset_id FROM expired)
""")


async def release_expired_reservations(ctx: dict) -> int:
    engine = get_engine()
    async with engine.begin() as conn:
        res = await conn.execute(RELEASE_SQL)
        n = res.rowcount
        if n > 0:
            await conn.execute(
                text("INSERT INTO audit_log (actor_type, entity, action, meta) VALUES ('system','reservation','reservations_released', :m)"),
                {"m": json.dumps({"count": n})})
    log.info("release_expired_reservations: %s released", n)
    return n


class WorkerSettings:
    functions = [release_expired_reservations]
    cron_jobs = [cron(release_expired_reservations, minute=set(range(0, 60)), run_at_startup=True)]
    max_jobs = 5
    job_timeout = 120
    redis_settings = RedisSettings.from_dsn(get_settings().REDIS_URL or "redis://localhost:6379/0")
'@

# compose: append worker (same image as api)
$ccp = Join-Path $ProjectRoot 'docker-compose.yml'
$raw = [IO.File]::ReadAllText($ccp)
if ($raw -notmatch '(?m)^\s{2}worker:') {
    $block = @'
  worker:
    build: ./apps/backend
    restart: unless-stopped
    command: ["arq", "app.workers.worker.WorkerSettings"]
    environment:
      LOG_LEVEL: ${LOG_LEVEL:-INFO}
      DATABASE_URL: postgresql+asyncpg://rfo_app:${DB_APP_PASSWORD:?missing in .env}@pgbouncer:5432/rfo
      REDIS_URL: redis://:${REDIS_PASSWORD:?missing in .env}@redis:6379/0
      AI_PROVIDER: ${AI_PROVIDER:-}
    networks: [core]
    depends_on:
      pgbouncer: { condition: service_healthy }
      redis: { condition: service_healthy }
    healthcheck:
      test: ["CMD-SHELL", "python -c 'import redis,os; redis.from_url(os.environ['"'"'REDIS_URL'"'"']).ping()'"]
      interval: 10s
      timeout: 5s
      retries: 12
      start_period: 10s
    <<: *logging
'@
    [IO.File]::WriteAllText($ccp, ($raw.TrimEnd() + "`n`n" + $block), $Utf8NoBom)
    Write-Host '  patched  docker-compose.yml (worker service)' -ForegroundColor Green
} else { Write-Host '  skip    worker present' -ForegroundColor DarkGray }

# up.ps1: add worker to health-wait list
$up = Join-Path $ProjectRoot 'scripts\up.ps1'
$raw = [IO.File]::ReadAllText($up)
$old = "`$services = 'postgres','pgbouncer','redis','storage','nginx','api'"
if ($raw.IndexOf($old) -ge 0 -and $raw -notmatch "'worker'") {
    [IO.File]::WriteAllText($up, ($raw.Replace($old, "`$services = 'postgres','pgbouncer','redis','storage','nginx','api','worker'") -replace "`r`n", "`n"), $Utf8NoBom)
    Write-Host '  patched  scripts/up.ps1 (worker in health wait)' -ForegroundColor Green
} else { Write-Host '  skip    up.ps1 already includes worker' -ForegroundColor DarkGray }

Write-TextFile 'apps/backend/tests/test_worker.py' @'
import uuid

from sqlalchemy import text

from app.bootstrap_staff import bootstrap
from app.core.db import get_engine
from app.workers.worker import release_expired_reservations


async def _cleanup():
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("DELETE FROM refresh_tokens WHERE identity_id IN (SELECT id FROM staff_users WHERE email LIKE 'pytest-%')"))
        await c.execute(text("DELETE FROM staff_users WHERE email LIKE 'pytest-%'"))


def _h(tok: str) -> dict:
    return {"Authorization": "Bearer " + tok}


async def test_ttl_release_and_idempotence(client):
    await _cleanup()
    email = "pytest-" + uuid.uuid4().hex + "@test.rfo"
    sid, pw = await bootstrap(email, "admin")
    r = await client.post("/staff/auth/login", json={"email": email, "password": pw})
    tok = r.json()["access_token"]

    r = await client.post("/staff/lots", json={"notes": "pytest"}, headers=_h(tok))
    ln = r.json()["lot_number"]
    sn = "pytest-" + uuid.uuid4().hex
    r = await client.post("/staff/assets/scan-in", json={"lot_number": ln, "serial_number": sn}, headers=_h(tok))
    aid = r.json()["id"]
    await client.post(f"/staff/assets/{aid}/status", json={"status": "tested"}, headers=_h(tok))
    await client.post(f"/staff/assets/{aid}/grade", json={"grade": "A"}, headers=_h(tok))
    await client.post(f"/staff/assets/{aid}/price", json={"sale_price_cents": 19900}, headers=_h(tok))
    await client.post(f"/staff/assets/{aid}/status", json={"status": "listed"}, headers=_h(tok))

    r = await client.post("/store/reservations", json={"asset_id": aid, "hold_minutes": 5})
    assert r.status_code == 201, r.text

    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("UPDATE reservations SET expires_at = now() - INTERVAL '1 minute' WHERE asset_id = :i"),
                        {"i": aid})

    n = await release_expired_reservations({})
    assert n == 1, f"expected 1 release, got {n}"
    async with eng.begin() as c:
        st = (await c.execute(text("SELECT status FROM assets WHERE id = :i"), {"i": aid})).scalar_one()
        rs = (await c.execute(text("SELECT status FROM reservations WHERE asset_id = :i"), {"i": aid})).scalar_one()
    assert st == "listed" and rs == "released", (st, rs)

    n2 = await release_expired_reservations({})
    assert n2 == 0, "second run must release nothing (idempotent)"
'@

Write-TextFile 'scripts/Test-Phase5.ps1' @'
#Requires -Version 5.1
# Phase 5 verification gate
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

Check 'alembic at 0007 head' {
    $out = (& docker compose run --rm migrate alembic current | Out-String)
    if ($out -notmatch '0007_search_vectors') { throw "revision: $out" }
}
Check 'search vectors + GIN indexes exist' {
    $n = ((& docker compose exec -T postgres psql -U rfo_admin -d rfo -tAc "SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname IN ('products_vec_idx','assets_vec_idx')") | Out-String).Trim()
    if ($n -ne '2') { throw "gin indexes=$n" }
}
Check 'worker service healthy + redis reachable' {
    $h = (& docker inspect rfo-worker-1 --format '{{.State.Health.Status}}' 2>$null) -join ''
    if ($h -ne 'healthy') { throw "worker health=$h - paste docker compose logs worker --tail 30" }
}
Check 'pytest suite (ttl release)' {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & docker compose run --rm api pytest -q tests/test_worker.py; $code = $LASTEXITCODE } finally { $ErrorActionPreference = $prev }
    if ($code -ne 0) { throw "pytest exit=$code" }
}

Write-Host "`nResult: $pass passed, $fail failed" -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
if ($fail -gt 0) { exit 1 }
Write-Host 'PHASE 5 VERIFIED - say "go phase 6".' -ForegroundColor Yellow
'@

Push-Location $ProjectRoot
try {
    & docker compose config --quiet *> $null
    if ($LASTEXITCODE -ne 0) { throw 'compose invalid' }
    Write-Host '  ok      compose valid' -ForegroundColor Green
} finally { Pop-Location }

$st = Join-Path $ProjectRoot 'docs\state.md'
$s2 = [IO.File]::ReadAllText($st)
if ($s2 -notmatch 'Phase 5 ') {
    $s2 = $s2.TrimEnd() + "`nPhase 5 delivered: 0007 tsvector search cols + GIN; redis client; ARQ worker (cron TTL release w/ audit) - worker container on api image.`n"
    [IO.File]::WriteAllText($st, ($s2 -replace "`r`n", "`n"), $Utf8NoBom)
}

Write-Host "`nDONE. Next:" -ForegroundColor Yellow
Write-Host '  1) docker compose run --rm migrate alembic upgrade head'
Write-Host '  2) docker compose run --rm migrate alembic current    # gate: 0007_search_vectors (head)'
Write-Host '  3) .\scripts\up.ps1                                   # builds/starts worker + waits healthy'
Write-Host '  4) .\scripts\Test-Phase5.ps1'
Write-Host '  5) if green: git add -A ; git commit -m "feat(infra): phase 5 - redis, ARQ worker, TTL release, tsvector search"'
