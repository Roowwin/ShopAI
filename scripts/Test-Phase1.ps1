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