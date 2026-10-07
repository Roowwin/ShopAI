#Requires -Version 5.1
<#
  RFO Platform - Phase 1: orchestration files (compose, postgres, pgbouncer, redis,
  minio, nginx, ops scripts). Writes infrastructure + scripts; does NOT start the
  stack (run scripts\up.ps1 for that). Re-runs are safe: files are overwritten.
#>
[CmdletBinding()]
param([string]$ProjectRoot = (Get-Location).Path, [switch]$Force)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$envPath   = Join-Path $ProjectRoot '.env'

if (-not (Test-Path $envPath)) { throw ".env not found in $ProjectRoot - run bootstrap.ps1 first" }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'docker CLI not found' }

function Write-TextFile {
    param([string]$RelativePath, [string]$Content)
    $full = Join-Path $ProjectRoot $RelativePath
    $dir  = Split-Path $full -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    [IO.File]::WriteAllText($full, ($Content -replace "`r`n", "`n"), $Utf8NoBom)
    Write-Host "  create  $RelativePath" -ForegroundColor Green
}

# ---------- ADRs for decisions taken this phase ----------
Write-TextFile 'docs/adr/0003-jobs-worker-arq.md' @'
# ADR 0003 - Background jobs: ARQ

Status: accepted

- Async-native, Redis-only broker, minimal ops surface; matches FastAPI event-loop model.
- Rejected: Celery (needs extra infra/options we do not use; heavier ops).
- Outbox drain, reservation TTL release, email, image processing, FTS indexing run here.
'@

Write-TextFile 'docs/adr/0004-performance-slos.md' @'
# ADR 0004 - Performance targets (confirmed)

Status: accepted

- p95 < 200 ms API | 300 req/s peak storefront | 99.9% availability | RPO <= 5 min | RTO <= 1 h.
- Verified in Phase 10 at 2x load; nginx JSON logs + pg_stat_statements + OTel are the evidence chain.
'@

# ---------- docker-compose ----------
Write-Host "`n[1/4] docker-compose.yml" -ForegroundColor Cyan
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
  miniodata: {}

services:
  postgres:
    image: postgres:16-alpine
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
    image: redis:7-alpine
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

  minio:
    image: minio/minio:latest
    restart: unless-stopped
    command: ["server", "/data", "--console-address", ":9001"]
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER:?missing in .env}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD:?missing in .env}
    ports:
      - "127.0.0.1:9000:9000"   # S3 API - loopback only (dev convenience)
      - "127.0.0.1:9001:9001"   # console - loopback only (dev convenience)
    volumes: [miniodata:/data]
    networks: [core]
    # image ships `mc`; if an image build ever lacks it, swap test to: ["CMD","curl","-f","http://localhost:9000/minio/health/live"]
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 10s
      timeout: 5s
      retries: 12
      start_period: 20s
    <<: *logging

  minio-init:
    image: minio/mc:latest
    restart: "no"
    networks: [core]
    depends_on:
      minio: { condition: service_healthy }
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER:?missing in .env}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD:?missing in .env}
    entrypoint: >
      /bin/sh -c "
        mc alias set local http://minio:9000 $$MINIO_ROOT_USER $$MINIO_ROOT_PASSWORD &&
        mc mb --ignore-existing local/rfo-media &&
        mc anonymous set download local/rfo-media &&
        echo MINIO_INIT_DONE
      "
    <<: *logging

  nginx:
    image: nginx:1.27-alpine
    restart: unless-stopped
    depends_on:
      minio: { condition: service_healthy }
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

# ---------- postgres ----------
Write-Host "`n[2/4] PostgreSQL 16 + PgBouncer configs" -ForegroundColor Cyan
Write-TextFile 'infra/postgres/postgresql.conf' @'
# RFO PostgreSQL 16 - write-heavy OLTP baseline (dev defaults; scale with RAM in prod)
listen_addresses = '*'
max_connections = 200
superuser_reserved_connections = 3

shared_buffers = 512MB           # prod: ~25% of host RAM
effective_cache_size = 1536MB    # prod: ~60% of host RAM
work_mem = 16MB
maintenance_work_mem = 256MB

random_page_cost = 1.1           # SSD
effective_io_concurrency = 200

wal_compression = on
max_wal_size = 2GB
min_wal_size = 512MB
checkpoint_completion_target = 0.9
max_slot_wal_keep_size = 2GB     # stale replication slots (Phase 9) cannot eat the disk

# write-heavy hygiene
autovacuum_vacuum_scale_factor = 0.05
autovacuum_analyze_scale_factor = 0.02
autovacuum_naptime = 30s
idle_in_transaction_session_timeout = '30s'

# observability
shared_preload_libraries = 'pg_stat_statements'
pg_stat_statements.track = all
track_io_timing = on
log_min_duration_statement = 250
log_checkpoints = on
log_lock_waits = on
timezone = 'UTC'
log_timezone = 'UTC'

password_encryption = 'scram-sha-256'
default_text_search_config = 'pg_catalog.english'
'@

Write-TextFile 'infra/postgres/init/01-roles.sh' @'
#!/bin/sh
set -e
echo "==> RFO: roles, grants, extensions"

psql -v ON_ERROR_STOP=1 \
     -v migrator_pwd="$DB_MIGRATOR_PASSWORD" \
     -v app_pwd="$DB_APP_PASSWORD" \
     -v ro_pwd="$DB_READONLY_PASSWORD" \
     --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'EOSQL'
REVOKE ALL ON SCHEMA public FROM PUBLIC;

CREATE ROLE rfo_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'migrator_pwd';
CREATE ROLE rfo_app      LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'app_pwd';
CREATE ROLE rfo_ro       LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'ro_pwd';

GRANT CONNECT ON DATABASE rfo TO rfo_migrator, rfo_app, rfo_ro;
GRANT USAGE, CREATE ON SCHEMA public TO rfo_migrator;
GRANT USAGE ON SCHEMA public TO rfo_app, rfo_ro;

-- everything the migrator creates later is usable by app/ro automatically
ALTER DEFAULT PRIVILEGES FOR ROLE rfo_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO rfo_app;
ALTER DEFAULT PRIVILEGES FOR ROLE rfo_migrator IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO rfo_app;
ALTER DEFAULT PRIVILEGES FOR ROLE rfo_migrator IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO rfo_app;
ALTER DEFAULT PRIVILEGES FOR ROLE rfo_migrator IN SCHEMA public GRANT SELECT ON TABLES TO rfo_ro;

ALTER ROLE rfo_app SET search_path = public;
ALTER ROLE rfo_app SET statement_timeout = '30s';
ALTER ROLE rfo_app SET idle_in_transaction_session_timeout = '20s';
ALTER ROLE rfo_ro SET statement_timeout = '60s';
ALTER ROLE rfo_ro SET default_transaction_read_only = on;

CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS btree_gin;
EOSQL
echo "==> RFO: roles/grants/extensions done"
'@

Write-TextFile 'infra/pgbouncer/Dockerfile' @'
FROM alpine:3.20
RUN apk add --no-cache pgbouncer postgresql16-client
COPY entrypoint.sh /usr/local/bin/rfo-entrypoint.sh
RUN chmod 0755 /usr/local/bin/rfo-entrypoint.sh \
 && mkdir -p /etc/pgbouncer /var/lib/pgbouncer \
 && chown -R pgbouncer:pgbouncer /etc/pgbouncer /var/lib/pgbouncer
USER pgbouncer
ENTRYPOINT ["/usr/local/bin/rfo-entrypoint.sh"]
'@

Write-TextFile 'infra/pgbouncer/entrypoint.sh' @'
#!/bin/sh
set -e
: "${POSTGRES_SUPERUSER_PASSWORD:?POSTGRES_SUPERUSER_PASSWORD required}"
: "${DB_MIGRATOR_PASSWORD:?DB_MIGRATOR_PASSWORD required}"
: "${DB_APP_PASSWORD:?DB_APP_PASSWORD required}"
: "${DB_READONLY_PASSWORD:?DB_READONLY_PASSWORD required}"

cat > /etc/pgbouncer/userlist.txt <<EOF
"pg_admin"      "${POSTGRES_SUPERUSER_PASSWORD}"
"rfo_migrator"  "${DB_MIGRATOR_PASSWORD}"
"rfo_app"       "${DB_APP_PASSWORD}"
"rfo_ro"        "${DB_READONLY_PASSWORD}"
EOF
chmod 600 /etc/pgbouncer/userlist.txt

cat > /etc/pgbouncer/pgbouncer.ini <<EOF
[databases]
rfo = host=postgres port=5432 dbname=rfo

[pgbouncer]
listen_addr = 0.0.0.0
listen_port = 5432
auth_type = scram-sha-256
auth_file = /etc/pgbouncer/userlist.txt
admin_users = pg_admin
pool_mode = ${PGBOUNCER_POOL_MODE}
max_client_conn = ${PGBOUNCER_MAX_CLIENT_CONN}
default_pool_size = ${PGBOUNCER_DEFAULT_POOL_SIZE}
max_prepared_statements = 200
server_reset_query = DISCARD ALL
ignore_startup_parameters = extra_float_digits,options,search_path
server_lifetime = 3600
server_idle_timeout = 300
server_connect_timeout = 5s
log_connections = 0
log_disconnections = 0
log_pooler_errors = 1
EOF

exec pgbouncer /etc/pgbouncer/pgbouncer.ini
'@

# ---------- nginx ----------
Write-Host "`n[3/4] Nginx (zones, TLS, headers, media proxy)" -ForegroundColor Cyan
Write-TextFile 'infra/nginx/templates/rfo.conf.template' @'
# Rendered at container start by the official nginx envsubst mechanism:
# ONLY vars defined in the container env are substituted ($request_id etc. survive).

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

upstream rfo-minio { server minio:9000; keepalive 16; }

# ---- catch-all ---------------------------------------------------------------
server {
  listen 80 default_server;
  server_name _;
  location = /healthz { access_log off; return 200 "ok\n"; }
  location / { return 503 "RFO edge up - route not wired\n"; }
}

# ---- http -> https ------------------------------------------------------------
server {
  listen 80;
  server_name ${DOMAIN_STORE} ${DOMAIN_ADMIN} ${DOMAIN_API};
  location = /healthz { access_log off; return 200 "ok\n"; }
  location /.well-known/acme-challenge/ { root /var/www/certbot; }
  location / { return 301 https://$host$request_uri; }
}

# ---- API (upstream wired in Phase 3) -------------------------------------------
server {
  listen 443 ssl;
  http2 on;
  server_name ${DOMAIN_API};
  include /etc/nginx/snippets/tls.conf;
  include /etc/nginx/snippets/headers.conf;
  location = /healthz { access_log off; return 200 "ok\n"; }
  location / { limit_req zone=staff burst=20 nodelay; return 503 "API not wired yet (Phase 3)\n"; }
}

# ---- Storefront (Phase 7) -------------------------------------------------------
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

# ---- Backoffice (Phase 6) -------------------------------------------------------
server {
  listen 443 ssl;
  http2 on;
  server_name ${DOMAIN_ADMIN};
  include /etc/nginx/snippets/tls.conf;
  include /etc/nginx/snippets/headers.conf;
  location / { limit_req zone=staff burst=20 nodelay; return 503 "Backoffice not wired yet (Phase 6)\n"; }
}
'@

Write-TextFile 'infra/nginx/snippets/tls.conf' @'
ssl_certificate     /etc/nginx/certs/fullchain.pem;
ssl_certificate_key /etc/nginx/certs/key.pem;
ssl_protocols       TLSv1.2 TLSv1.3;
ssl_session_cache   shared:SSL:10m;
ssl_session_timeout 1d;
ssl_session_tickets off;
'@

Write-TextFile 'infra/nginx/snippets/headers.conf' @'
add_header X-Content-Type-Options nosniff always;
add_header X-Frame-Options DENY always;
add_header Referrer-Policy strict-origin-when-cross-origin always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;
add_header Strict-Transport-Security "max-age=31536000" always;
add_header X-Request-ID $request_id always;
'@

# ---------- ops scripts ----------
Write-Host "`n[4/4] PowerShell ops scripts" -ForegroundColor Cyan
Write-TextFile 'scripts/New-TlsCerts.ps1' @'
#Requires -Version 5.1
# Local TLS for *.rfo.localhost. mkcert preferred (trusted by browsers); openssl fallback warns.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$certs = Join-Path (Split-Path $PSScriptRoot -Parent) 'infra\nginx\certs'
New-Item -ItemType Directory -Force -Path $certs | Out-Null

if (Get-Command mkcert -ErrorAction SilentlyContinue) {
    & mkcert -install
    & mkcert -cert-file (Join-Path $certs 'fullchain.pem') -key-file (Join-Path $certs 'key.pem') '*.rfo.localhost' 'rfo.localhost'
} else {
    Write-Warning 'mkcert not found - generating self-signed cert (browsers will warn).'
    Write-Warning 'For trusted local TLS: winget install -e --id FiloSottile.mkcert'
    & docker run --rm -v "${certs}:/certs" nginx:alpine sh -c "openssl req -x509 -nodes -newkey rsa:2048 -days 825 -keyout /certs/key.pem -out /certs/fullchain.pem -subj '/CN=rfo.local' -addext 'subjectAltName=DNS:*.rfo.localhost,DNS:rfo.localhost'"
}
if ($LASTEXITCODE -ne 0) { throw 'certificate generation failed' }
& icacls (Join-Path $certs 'key.pem') /inheritance:r /grant:r "$($env:USERDOMAIN)\$($env:USERNAME):F" *> $null
Write-Host "Certificates written to $certs" -ForegroundColor Green
'@

Write-TextFile 'scripts/Set-Hosts.ps1' @'
#Requires -Version 5.1
#Requires -RunAsAdministrator
# Adds *.rfo.localhost -> 127.0.0.1 (Windows does not resolve subdomains of localhost natively).
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$vars = @{}
Get-Content (Join-Path $root '.env') | ForEach-Object {
    if ($_ -match '^([A-Z0-9_]+)=(.*)$') { $vars[$Matches[1]] = $Matches[2] }
}
$domains = @($vars['DOMAIN_STORE'], $vars['DOMAIN_ADMIN'], $vars['DOMAIN_API'])
if ($domains -contains $null) { throw 'DOMAIN_* missing in .env' }
$marker = '# RFO local domains'
$hfile  = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
if (-not (Select-String -Path $hfile -Pattern ([regex]::Escape($marker)) -Quiet)) {
    Add-Content -Path $hfile -Value ("`n$marker`n127.0.0.1`t" + ($domains -join ' ')) -Encoding ascii
    Write-Host 'hosts entries added' -ForegroundColor Green
} else {
    Write-Host 'hosts entries already present' -ForegroundColor DarkGray
}
'@

Write-TextFile 'scripts/up.ps1' @'
#Requires -Version 5.1
# Starts the full Phase 1 stack: certs (auto) -> hosts entries -> compose up --wait -> verification.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$scripts = $PSScriptRoot
Set-Location (Split-Path $scripts -Parent)

if (-not (Test-Path '.\infra\nginx\certs\fullchain.pem')) {
    Write-Host 'TLS certs missing - generating...' -ForegroundColor Yellow
    & (Join-Path $scripts 'New-TlsCerts.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'cert generation failed' }
}
try { & (Join-Path $scripts 'Set-Hosts.ps1') *> $null } catch {
    Write-Warning 'hosts entries not set (needs admin) - run scripts\Set-Hosts.ps1 manually'
}

& docker compose up -d --wait
if ($LASTEXITCODE -ne 0) { throw 'docker compose up failed - inspect with: docker compose logs' }
& docker compose ps
& (Join-Path $scripts 'Test-Phase1.ps1')
'@

Write-TextFile 'scripts/down.ps1' @'
#Requires -Version 5.1
# Stops the stack. -PurgeData ALSO deletes volumes (required after secret rotation).
[CmdletBinding()]
param([switch]$PurgeData)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if ($PurgeData) {
    Write-Warning 'PURGING ALL DATA VOLUMES (postgres/redis/minio)'
    & docker compose down -v --remove-orphans
} else {
    & docker compose down --remove-orphans
}
if ($LASTEXITCODE -ne 0) { throw 'docker compose down failed' }
'@

Write-TextFile 'scripts/Test-Phase1.ps1' @'
#Requires -Version 5.1
# Phase 1 verification gate. Exits non-zero on any failure.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

$pass = 0; $fail = 0
function Check {
    param([string]$Name, [scriptblock]$Body)
    try { & $Body; $script:pass++; Write-Host "  PASS  $Name" -ForegroundColor Green }
    catch { $script:fail++; Write-Host "  FAIL  $Name - $($_.Exception.Message)" -ForegroundColor Red }
}
function TcpOpen {
    param([string]$Host, [int]$Port)
    $tcp = New-Object Net.Sockets.TcpClient
    try {
        $ar = $tcp.BeginConnect($Host, $Port, $null, $null)
        return ($ar.AsyncWaitHandle.WaitOne(1500) -and $tcp.Connected)
    } finally { $tcp.Close() }
}

Write-Host "`n[1/5] Container health" -ForegroundColor Cyan
foreach ($svc in 'postgres','pgbouncer','redis','minio','nginx') {
    Check "$svc healthy" {
        $id = (& docker compose ps -q $svc) -join ''
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

Write-Host "`n[4/5] Redis / MinIO" -ForegroundColor Cyan
Check 'redis PONG + AOF=yes' {
    $ping = (& docker compose exec -T redis sh -c 'redis-cli -a $REDIS_PASSWORD --no-auth-warning ping').Trim()
    $aof  = (& docker compose exec -T redis sh -c 'redis-cli -a $REDIS_PASSWORD --no-auth-warning config get appendonly') | Select-Object -Last 1
    if ($ping -ne 'PONG') { throw "ping=$ping" }
    if ("$aof".Trim() -ne 'yes') { throw "appendonly=$aof" }
}
Check 'minio health + rfo-media bucket' {
    $r = Invoke-WebRequest -Uri 'http://127.0.0.1:9000/minio/health/live' -UseBasicParsing -TimeoutSec 10
    if ($r.StatusCode -ne 200) { throw "status=$($r.StatusCode)" }
    & docker compose run --rm --entrypoint /bin/sh minio-init -c 'mc ls local/rfo-media' *> $null
    if ($LASTEXITCODE -ne 0) { throw 'mc ls rfo-media failed' }
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
    if ($code -ne '200') { throw "got $code (missing certs? run scripts\New-TlsCerts.ps1)" }
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

# ---------- static validation ----------
Write-Host "`nValidating compose file..." -ForegroundColor Cyan
Push-Location $ProjectRoot
try {
    & docker compose config --quiet *> $null
    if ($LASTEXITCODE -ne 0) { throw 'docker compose config reports errors' }
    Write-Host '  ok      compose file valid + all .env vars resolve' -ForegroundColor Green
} finally { Pop-Location }

Write-Host "`nDone. Start everything with: .\scripts\up.ps1" -ForegroundColor Cyan
