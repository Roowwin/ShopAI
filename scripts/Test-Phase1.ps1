#Requires -Version 5.1
# Phase 1 verification gate v3 (quote-safe native calls; binding-based isolation)
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
function Invoke-NativeQuiet {
    param([scriptblock]$Cmd)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & $Cmd *> $null; return $LASTEXITCODE } finally { $ErrorActionPreference = $prev }
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

Write-Host "`n[2/5] Host-side isolation (published-port bindings)" -ForegroundColor Cyan
Check 'postgres publishes NO host port' {
    $p = (& docker inspect rfo-postgres-1 --format '{{json .NetworkSettings.Ports}}') -join ''
    if ($p -match '"5432/tcp":\[') { throw "postgres published to host: $p" }
}
Check 'redis publishes NO host port' {
    $p = (& docker inspect rfo-redis-1 --format '{{json .NetworkSettings.Ports}}') -join ''
    if ($p -match '"6379/tcp":\[') { throw "redis published to host: $p" }
}
Check 'storage published loopback-only' {
    $p = (& docker inspect rfo-storage-1 --format '{{json .NetworkSettings.Ports}}') -join ''
    if ($p -notmatch '"5000/tcp":\[\{"HostIp":"127\.0\.0\.1"') { throw "storage not loopback-only: $p" }
}

Write-Host "`n[3/5] PostgreSQL via PgBouncer (quote-safe)" -ForegroundColor Cyan
Check 'rfo_app connects via pgbouncer' {
    $out = (& docker compose exec -T pgbouncer sh -c "PGPASSWORD=`$DB_APP_PASSWORD psql -h 127.0.0.1 -p 5432 -U rfo_app -d rfo -tAc 'SELECT current_user'") -join ''
    if ($out.Trim() -ne 'rfo_app') { throw "got '$($out.Trim())'" }
}
Check 'pool_mode=transaction' {
    $cfg = (& docker compose exec -T pgbouncer sh -c "PGPASSWORD=`$POSTGRES_SUPERUSER_PASSWORD psql -h 127.0.0.1 -p 5432 -U rfo_admin -d pgbouncer -tAc 'SHOW CONFIG'") -join ' '
    if ($cfg -notmatch 'pool_mode\s*\|\s*transaction') { throw "no match in: $($cfg.Substring(0, [Math]::Min(120, $cfg.Length)))" }
}
Check 'rfo_app statement_timeout=30s' {
    $out = (& docker compose exec -T pgbouncer sh -c "PGPASSWORD=`$DB_APP_PASSWORD psql -h 127.0.0.1 -p 5432 -U rfo_app -d rfo -tAc 'SHOW statement_timeout'") -join ''
    if ($out.Trim() -notmatch '30s') { throw "got '$($out.Trim())'" }
}
Check 'extensions installed' {
    $exts = (& docker compose exec -T postgres psql -U rfo_admin -d rfo -tAc "SELECT string_agg(extname, '|' ORDER BY extname) FROM pg_extension") -join ''
    foreach ($x in 'pgcrypto','pg_trgm','citext','unaccent','btree_gin','pg_stat_statements') {
        if ($exts -notlike "*$x*") { throw "missing: $x (got: $exts)" }
    }
}
Check 'default privileges wired (migrator->app/ro)' {
    $n = [int]((& docker compose exec -T postgres psql -U rfo_admin -d rfo -tAc "SELECT count(*) FROM pg_default_acl WHERE defaclrole = (SELECT oid FROM pg_roles WHERE rolname = 'rfo_migrator')").Trim())
    $a = (& docker compose exec -T postgres psql -U rfo_admin -d rfo -tAc "SELECT string_agg(defaclacl::text, ',') FROM pg_default_acl WHERE defaclrole = (SELECT oid FROM pg_roles WHERE rolname = 'rfo_migrator')") -join ''
    if ($n -lt 3) { throw "default ACLs=$n (expected >= 3: merged by objtype)" }
    if (($a -notmatch 'rfo_app=') -or ($a -notmatch 'rfo_ro=')) { throw "grantee missing in ACL text: $a" }
}

Write-Host "`n[4/5] Storage (moto S3 emulation)" -ForegroundColor Cyan
Check 'storage S3 API reachable on loopback' {
    $r = Invoke-WebRequest -Uri 'http://127.0.0.1:5000/' -UseBasicParsing -TimeoutSec 10
    if ($r.StatusCode -ne 200) { throw "status=$($r.StatusCode)" }
}
Check 'rfo-media bucket exists' {
    $code = Invoke-NativeQuiet { & docker compose run --rm storage-init verify }
    if ($code -ne 0) { throw "bucket verify exit=$code" }
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
