#Requires -Version 5.1
<# RFO fix: (a) superuser name pg_admin is reserved by PG - rename to rfo_admin everywhere;
   (b) moto image ENTRYPOINT is moto_server - set entrypoint explicitly, pass flags as command. #>
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

# ---- obsolete superseded phase scripts: prevent accidental re-run (they still embed pg_admin) ----
foreach ($old in 'phase1-infra.ps1','phase1-swap-storage.ps1') {
    $p = Join-Path $ProjectRoot $old
    if (Test-Path $p) { Move-Item -Force $p "$p.obsolete"; Write-Host "  rename  $old -> obsolete" -ForegroundColor Yellow }
}

# ---- 1. rename superuser in .env / .env.example ----
foreach ($name in '.env','.env.example') {
    $p = Join-Path $ProjectRoot $name
    if (-not (Test-Path $p)) { continue }
    $raw = [IO.File]::ReadAllText($p)
    $raw = $raw -replace '(?m)^POSTGRES_SUPERUSER=pg_admin\s*$', 'POSTGRES_SUPERUSER=rfo_admin'
    [IO.File]::WriteAllText($p, $raw, $Utf8NoBom)
    Write-Host "  rename  $name -> POSTGRES_SUPERUSER=rfo_admin" -ForegroundColor Green
}

# ---- 2. docker-compose.yml: full rewrite (superuser passthrough + moto entrypoint fix) ----
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
      POSTGRES_SUPERUSER: ${POSTGRES_SUPERUSER:?missing in .env}
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
    entrypoint: ["moto_server"]
    command: ["-H", "0.0.0.0", "-p", "5000"]
    ports:
      - "127.0.0.1:5000:5000"
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
Select-String -Path (Join-Path $ProjectRoot 'docker-compose.yml') -Pattern 'moto_server' | Select-Object -ExpandProperty Line

# ---- 3. pgbouncer entrypoint: admin name from env (single source of truth) ----
Write-TextFile 'infra/pgbouncer/entrypoint.sh' @'
#!/bin/sh
set -e
: "${POSTGRES_SUPERUSER:?POSTGRES_SUPERUSER required}"
: "${POSTGRES_SUPERUSER_PASSWORD:?POSTGRES_SUPERUSER_PASSWORD required}"
: "${DB_MIGRATOR_PASSWORD:?DB_MIGRATOR_PASSWORD required}"
: "${DB_APP_PASSWORD:?DB_APP_PASSWORD required}"
: "${DB_READONLY_PASSWORD:?DB_READONLY_PASSWORD required}"

cat > /etc/pgbouncer/userlist.txt <<EOF
"${POSTGRES_SUPERUSER}"      "${POSTGRES_SUPERUSER_PASSWORD}"
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
admin_users = ${POSTGRES_SUPERUSER}
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

# ---- 4. Test-Phase1: pg_admin -> rfo_admin ----
$tp = Join-Path $ProjectRoot 'scripts\Test-Phase1.ps1'
$raw  = [IO.File]::ReadAllText($tp)
$n = ([regex]::Matches($raw, 'pg_admin')).Count
if ($n -eq 0) { Write-Host '  skip    Test-Phase1 already renamed' -ForegroundColor DarkGray }
else {
    $raw = $raw -replace 'pg_admin', 'rfo_admin'
    [IO.File]::WriteAllText($tp, $raw, $Utf8NoBom)
    Write-Host "  rename  Test-Phase1: pg_admin -> rfo_admin ($n occurrences)" -ForegroundColor Green
}

# ---- validate ----
Push-Location $ProjectRoot
try {
    & docker compose config --quiet *> $null
    if ($LASTEXITCODE -ne 0) { throw 'compose invalid after rewrite' }
    Write-Host "`n  ok      compose valid" -ForegroundColor Green
    & docker compose build pgbouncer | Select-Object -Last 3
    if ($LASTEXITCODE -ne 0) { throw 'pgbouncer build failed' }
    Write-Host '  ok      pgbouncer image rebuilt (entrypoint updated)' -ForegroundColor Green
} finally { Pop-Location }

Write-Host "`nNext: .\scripts\down.ps1  then  .\scripts\up.ps1" -ForegroundColor Yellow
