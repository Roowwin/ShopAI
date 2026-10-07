#Requires -Version 5.1
<# RFO Phase 1 (cont.): swap dev storage MinIO -> moto (S3 emulation), per ADR 0005.
   Rewrites docker-compose.yml, Test-Phase1.ps1, adds init.py, patches nginx template.
   Run from the project root. #>
[CmdletBinding()]
param([string]$ProjectRoot = (Get-Location).Path)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

if (-not (Test-Path (Join-Path $ProjectRoot '.env'))) { throw ".env not found in $ProjectRoot" }

function Write-TextFile {
    param([string]$RelativePath, [string]$Content)
    $full = Join-Path $ProjectRoot $RelativePath
    $dir = Split-Path $full -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    [IO.File]::WriteAllText($full, ($Content -replace "`r`n", "`n"), $Utf8NoBom)
    Write-Host "  create  $RelativePath" -ForegroundColor Green
}

Write-TextFile 'docs/adr/0005-dev-storage-moto.md' @'
# ADR 0005 - Dev storage: moto S3 emulation

Status: accepted

- MinIO images are no longer anonymously pullable here (Docker Hub withdrawn, quay login-gated, no ECR mirror) - probes documented in Phase 1 log.
- Dev stack uses motoserver/moto S3 emulation; the app-facing contract stays "S3-compatible API", so backend code and production (real MinIO/S3 on Linux) are unchanged.
- Dev caveats: moto is in-memory (bucket/objects vanish on restart; storage-init re-creates each up); no anonymous-policy emulation needed (unsigned reads allowed in server mode); pre-sign semantics validated for real in Phase 5.
- Dev-only image is :latest deliberately (pinning exception, documented); CI digests everything in Phase 10.
- Reversible: free quay.io account + Set-MinioPinned restores real MinIO in dev.
'@

Write-TextFile 'infra/storage/init.py' @'
import os, sys, time
import urllib.request, urllib.error

endpoint = os.environ.get("STORAGE_ENDPOINT", "http://storage:5000").rstrip("/")
bucket   = os.environ.get("BUCKET", "rfo-media")
url      = endpoint + "/" + bucket

if "verify" in sys.argv:
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            if r.status == 200:
                print("verify ok: " + bucket)
    except urllib.error.HTTPError as e:
        print("verify FAILED: bucket missing (HTTP " + str(e.code) + ")")
        sys.exit(1)
    sys.exit(0)

for attempt in range(5):
    try:
        req = urllib.request.Request(url, method="PUT")
        with urllib.request.urlopen(req, timeout=10) as r:
            print("bucket ready: " + bucket + " (status " + str(r.status) + ")")
        print("STORAGE_INIT_DONE")
        sys.exit(0)
    except urllib.error.HTTPError as e:
        if e.code == 409:
            print("bucket already exists: " + bucket)
            print("STORAGE_INIT_DONE")
            sys.exit(0)
        print("retry " + str(attempt + 1) + ": " + str(e))
        time.sleep(2)
    except Exception as e:
        print("retry " + str(attempt + 1) + ": " + str(e))
        time.sleep(2)
print("init failed after retries")
sys.exit(1)
'@

Write-TextFile 'docker-compose.yml' @'
name: rfo

x-logging: &logging
  logging: { driver: json-file, options: { max-size: "10m", max-file: "3" } }

networks:
  edge: {}
  core: {}
  db: {}

volumes:
  pgdata: {}
  redisdata: {}

services:
  postgres:
    image: public.ecr.aws/docker/library/postgres:16-alpine
    restart: unless-stopped
    stop_grace_period: 30s
    command: ["postgres", "-c", "config_file=/etc/postgresql/postgresql.conf"]
    environment:
      POSTGRES_USER: ${POSTGRES_SUPERUSER:?missing in .env}
      POSTGRES_PASSWORD: ${POSTGRES_SUPERUSER_PASSWORD:?missing in .env}
      POSTGRES_DB: ${POSTGRES_DB:?missing in .env}
      DB_MIGRATOR_PASSWORD: ${DB_MIGRATOR_PASSWORD:?missing in .env}
      DB_APP_PASSWORD: ${DB_APP_PASSWORD:?missing in .env}
      DB_READONLY_PASSWORD: ${DB_READONLY_PASSWORD:?missing in .env}
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./infra/postgres/postgresql.conf:/etc/postgresql/postgresql.conf:ro
      - ./infra/postgres/init/01-roles.sh:/docker-entrypoint-initdb.d/01-roles.sh:ro
    networks: [db]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB"]
      interval: 5s
      timeout: 5s
      retries: 12
      start_period: 30s
    <<: *logging

  pgbouncer:
    build: ./infra/pgbouncer
    restart: unless-stopped
    environment:
      POSTGRES_SUPERUSER_PASSWORD: ${POSTGRES_SUPERUSER_PASSWORD:?missing in .env}
      DB_APP_PASSWORD: ${DB_APP_PASSWORD:?missing in .env}
      DB_MIGRATOR_PASSWORD: ${DB_MIGRATOR_PASSWORD:?missing in .env}
      DB_READONLY_PASSWORD: ${DB_READONLY_PASSWORD:?missing in .env}
      PGBOUNCER_POOL_MODE: ${PGBOUNCER_POOL_MODE:-transaction}
      PGBOUNCER_DEFAULT_POOL_SIZE: ${PGBOUNCER_DEFAULT_POOL_SIZE:-25}
      PGBOUNCER_MAX_CLIENT_CONN: ${PGBOUNCER_MAX_CLIENT_CONN:-1000}
    networks: [core, db]
    depends_on:
      postgres: { condition: service_healthy }
    healthcheck:
      test: ["CMD-SHELL", "PGPASSWORD=$$DB_APP_PASSWORD psql -h 127.0.0.1 -p 5432 -U rfo_app -d rfo -tAc 'SELECT 1'"]
      interval: 5s
      timeout: 5s
      retries: 12
      start_period: 30s
    <<: *logging

  redis:
    image: public.ecr.aws/docker/library/redis:7-alpine
    restart: unless-stopped
    command: ["sh", "-c", "exec redis-server --appendonly yes --appendfsync everysec --save '' --maxmemory 512mb --maxmemory-policy noeviction --requirepass \"$$REDIS_PASSWORD\""]
    environment:
      REDIS_PASSWORD: ${REDIS_PASSWORD:?missing in .env}
    volumes: [redisdata:/data]
    networks: [core]
    healthcheck:
      test: ["CMD-SHELL", "redis-cli -a $$REDIS_PASSWORD --no-auth-warning ping"]
      interval: 5s
      timeout: 3s
      retries: 12
    <<: *logging

  # Dev-only S3 emulation (ADR 0005). In-memory: storage-init re-creates buckets on each up.
  # Prod = real MinIO/S3 on Linux hosts; credentials in .env (MINIO_*) are the prod contract.
  storage:
    image: motoserver/moto:latest
    restart: unless-stopped
    command: ["moto_server", "-H", "0.0.0.0", "-p", "5000"]
    ports:
      - "127.0.0.1:5000:5000"   # S3 API - loopback only (dev)
    networks: [core]
    healthcheck:
      test: ["CMD-SHELL", "python -c 'import urllib.request as u; u.urlopen(\"http://127.0.0.1:5000/\", timeout=5)'"]
      interval: 10s
      timeout: 5s
      retries: 12
      start_period: 20s
    <<: *logging

  storage-init:
    image: motoserver/moto:latest
    restart: "no"
    networks: [core]
    depends_on:
      storage: { condition: service_healthy }
    environment:
      STORAGE_ENDPOINT: http://storage:5000
      BUCKET: ${MINIO_BUCKET_MEDIA:?missing in .env}
    volumes:
      - ./infra/storage/init.py:/init.py:ro
    entrypoint: ["python", "/init.py"]
    <<: *logging

  nginx:
    image: public.ecr.aws/docker/library/nginx:1.27-alpine
    restart: unless-stopped
    depends_on:
      storage: { condition: service_healthy }
    ports:
      - "80:80"
      - "443:443"
    environment:
      DOMAIN_STORE: ${DOMAIN_STORE:?missing in .env}
      DOMAIN_ADMIN: ${DOMAIN_ADMIN:?missing in .env}
      DOMAIN_API: ${DOMAIN_API:?missing in .env}
      RATE_LIMIT_STORE_RPS: ${RATE_LIMIT_STORE_RPS:-20}
      RATE_LIMIT_STAFF_RPS: ${RATE_LIMIT_STAFF_RPS:-10}
      RATE_LIMIT_LOGIN_RPM: ${RATE_LIMIT_LOGIN_RPM:-10}
    volumes:
      - ./infra/nginx/templates:/etc/nginx/templates:ro
      - ./infra/nginx/conf.d:/etc/nginx/conf.d
      - ./infra/nginx/snippets:/etc/nginx/snippets:ro
      - ./infra/nginx/certs:/etc/nginx/certs:ro
    networks: [edge, core]
    healthcheck:
      test: ["CMD-SHELL", "wget -qO /dev/null http://127.0.0.1/healthz || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 6
    <<: *logging
'@

$t = Get-Content (Join-Path $ProjectRoot 'infra\nginx\templates\rfo.conf.template') -Raw
$t = $t -replace 'upstream rfo-minio \{ server [^;]+; keepalive 16; \}', 'upstream rfo-minio { server storage:5000; keepalive 16; }'
[IO.File]::WriteAllText((Join-Path $ProjectRoot 'infra\nginx\templates\rfo.conf.template'), $t, $Utf8NoBom)
Write-Host '  patched infra/nginx/templates/rfo.conf.template (upstream -> storage:5000)' -ForegroundColor Green
Select-String -Path (Join-Path $ProjectRoot 'infra\nginx\templates\rfo.conf.template') -Pattern 'upstream rfo-minio' | Select-Object -ExpandProperty Line

Write-TextFile 'scripts/Test-Phase1.ps1' @'
#Requires -Version 5.1
# Phase 1 verification gate (moto storage edition). Exits non-zero on failure.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

$pass = 0; $fail = 0
function Check {
    param([string]$Name, [scriptblock]$Body)
    try { & $Body; $script:pass++; Write-Host "  PASS  $Name" -ForegroundColor Green }
    catch { $script:fail++; Write-Host "  FAIL  $Name - $($_.Exception.Message)" -ForegroundColor Red }
}
function TcpOpen {
    param([string]$Target, [int]$Port)
    $tcp = New-Object Net.Sockets.TcpClient
    try {
        $ar = $tcp.BeginConnect($Target, $Port, $null, $null)
        return ($ar.AsyncWaitHandle.WaitOne(1500) -and $tcp.Connected)
    } finally { $tcp.Close() }
}

Write-Host "`n[1/5] Container health" -ForegroundColor Cyan
foreach ($svc in 'postgres','pgbouncer','redis','storage','nginx') {
    $svcLocal = $svc
    Check "$svcLocal healthy" {
        $id = (& docker compose ps -q $svcLocal) -join ''
        if ([string]::IsNullOrWhiteSpace($id)) { throw 'not running' }
        $h = (& docker inspect --format '{{.State.Health.Status}}' $id) -join ''
        if ($h -ne 'healthy') { throw "health=$h" }
    }
}

Write-Host "`n[2/5] Trust zones (internal stores NOT reachable from host)" -ForegroundColor Cyan
Check 'postgres:5432 closed on host' { if (TcpOpen '127.0.0.1' 5432) { throw 'port IS open - isolation broken' } }
Check 'redis:6379 closed on host'    { if (TcpOpen '127.0.0.1' 6379) { throw 'port IS open - isolation broken' } }

Write-Host "`n[3/5] PostgreSQL via PgBouncer only" -ForegroundColor Cyan
Check 'rfo_app connects via pgbouncer' {
    $out = (& docker compose exec -T pgbouncer sh -c 'PGPASSWORD=$DB_APP_PASSWORD psql -h 127.0.0.1 -p 5432 -U rfo_app -d rfo -tAc "SELECT current_user"').Trim()
    if ($out -ne 'rfo_app') { throw "got '$out'" }
}
Check 'pool_mode=transaction' {
    $cfg = (& docker compose exec -T pgbouncer sh -c 'PGPASSWORD=$POSTGRES_SUPERUSER_PASSWORD psql -h 127.0.0.1 -p 5432 -U pg_admin -d pgbouncer -tAc "SHOW CONFIG"') -join ' '
    if ($cfg -notmatch 'pool_mode\s*\|\s*transaction') { throw 'pool_mode mismatch' }
}
Check 'rfo_app statement_timeout=30s' {
    $out = (& docker compose exec -T pgbouncer sh -c 'PGPASSWORD=$DB_APP_PASSWORD psql -h 127.0.0.1 -p 5432 -U rfo_app -d rfo -tAc "SHOW statement_timeout"').Trim()
    if ($out -notmatch '30s') { throw "got '$out'" }
}
Check 'extensions installed' {
    $exts = (& docker compose exec -T postgres psql -U pg_admin -d rfo -tAc "SELECT string_agg(extname, '|' ORDER BY extname)") -join ''
    foreach ($x in 'pgcrypto','pg_trgm','citext','unaccent','btree_gin','pg_stat_statements') {
        if ($exts -notlike "*$x*") { throw "missing: $x" }
    }
}
Check 'default privileges wired (migrator->app/ro)' {
    $n = [int]((& docker compose exec -T postgres psql -U pg_admin -d rfo -tAc "SELECT count(*) FROM pg_default_acl WHERE defaclrole = (SELECT oid FROM pg_roles WHERE rolname = 'rfo_migrator')").Trim())
    if ($n -lt 4) { throw "default ACLs=$n (expected >= 4)" }
}

Write-Host "`n[4/5] Storage (moto S3 emulation)" -ForegroundColor Cyan
Check 'storage S3 API reachable on loopback' {
    $r = Invoke-WebRequest -Uri 'http://127.0.0.1:5000/' -UseBasicParsing -TimeoutSec 10
    if ($r.StatusCode -ne 200) { throw "status=$($r.StatusCode)" }
}
Check 'rfo-media bucket exists' {
    & docker compose run --rm storage-init verify *> $null
    if ($LASTEXITCODE -ne 0) { throw 'bucket verify failed' }
}

Write-Host "`n[5/5] Edge: Nginx + TLS" -ForegroundColor Cyan
Check 'hosts entries present' {
    $h = Get-Content (Join-Path $env:SystemRoot 'System32\drivers\etc\hosts') -Raw
    if ($h -notmatch 'rfo\.localhost') { throw 'run scripts\Set-Hosts.ps1 as admin' }
}
Check 'http -> https redirect (301)' {
    $code = (& curl.exe -s -o NUL -w '%{http_code}' http://api.rfo.localhost/somewhere).Trim()
    if ($code -ne '301') { throw "got $code" }
}
Check 'TLS 200 on api healthz' {
    $code = (& curl.exe -sk -o NUL -w '%{http_code}' https://api.rfo.localhost/healthz).Trim()
    if ($code -ne '200') { throw "got $code" }
}
Check 'security headers present' {
    $hdr = (& curl.exe -skI https://api.rfo.localhost/healthz) -join ' '
    foreach ($x in 'X-Content-Type-Options','X-Frame-Options','Referrer-Policy','X-Request-ID') {
        if ($hdr -notmatch [regex]::Escape($x)) { throw "missing: $x" }
    }
}
Check 'storefront 503 placeholder until Phase 7' {
    $code = (& curl.exe -sk -o NUL -w '%{http_code}' https://shop.rfo.localhost/).Trim()
    if ($code -ne '503') { throw "expected 503, got $code" }
}

Write-Host "`nResult: $pass passed, $fail failed" -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
if ($fail -gt 0) { exit 1 }
Write-Host 'PHASE 1 VERIFIED - say "go phase 2".' -ForegroundColor Yellow
'@

Push-Location $ProjectRoot
try {
    & docker compose config --quiet *> $null
    if ($LASTEXITCODE -ne 0) { throw 'docker compose config reports errors' }
    Write-Host "`n  ok      compose valid" -ForegroundColor Green
    Write-Host "`nImage gate (read, do not run - moto appears TWICE by design):" -ForegroundColor Cyan
    (Select-String -Path .\docker-compose.yml -Pattern '^\s*image:').Line
    if ((Select-String -Path .\docker-compose.yml -Pattern '^\s*image:' | Where-Object { $_.Line -match 'minio|quay' })) { throw 'stale registry references remain' }
} finally { Pop-Location }

Write-Host "`nStorage swapped. Next: .\scripts\up.ps1" -ForegroundColor Yellow
