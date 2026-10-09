#Requires -Version 5.1
<# Phase 10 FINAL gate v5. #>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Set-Location (Split-Path $PSScriptRoot -Parent)
$pass = 0; $fail = 0
function Check {
    param([string]$Name, [scriptblock]$Body)
    try { & $Body; $script:pass++; Write-Host "  PASS  $Name" -ForegroundColor Green }
    catch { $script:fail++; Write-Host "  FAIL  $Name - $($_.Exception.Message)" -ForegroundColor Red } }

Check 'api readyz via edge' {
    $rd = ((& curl.exe -sk https://api.rfo.localhost/readyz) -join '')
    if ($rd -notmatch '"db":true') { throw "readyz: $rd" } }
Check 'WAL archiving active + segment archived' {
    $prev2 = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $arch = ((& docker compose exec -T postgres psql -U rfo_admin -d rfo -tAc "SELECT archived_count FROM pg_stat_archiver") | Out-String).Trim()
    if ([int]$arch -lt 1) {
        & docker compose exec -T postgres psql -U rfo_admin -d rfo -c "SELECT pg_switch_wal();" *> $null
        Start-Sleep -Seconds 12
        $arch = ((& docker compose exec -T postgres psql -U rfo_admin -d rfo -tAc "SELECT archived_count FROM pg_stat_archiver") | Out-String).Trim() }
    $mount = (& docker inspect rfo-postgres-1 --format '{{range .Mounts}}{{.Destination}};{{end}}' 2>$null) -join ''
    $dir = (& docker compose exec -T postgres sh -c "ls -d /wal_archive 2>&1") -join ''
    $ErrorActionPreference = $prev2
    if ([int]$arch -lt 1) { throw ("archived=" + $arch + " mounts=[" + $mount + "] waldir=" + $dir) } }
Check 'production next builds (EAP-safe)' {
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    & docker compose stop storefront backoffice *> $null
    try {
        foreach ($app in 'storefront','backoffice') {
            & docker compose run --rm $app sh -c "cd /app && rm -rf .next && npm run build" 2>&1 | Out-String | ForEach-Object { ($_ -split "`n") | Where-Object { $_ -match 'erro|Error' } | Select-Object -First 2 }
            if ($LASTEXITCODE -ne 0) { throw ($app + " build failed exit=" + $LASTEXITCODE) } }
        & docker compose start storefront backoffice *> $null
        $deadline = (Get-Date).AddSeconds(300)
        foreach ($svc in 'storefront','backoffice') {
            do { Start-Sleep -Seconds 4; $h = (& docker inspect ("rfo-" + $svc + "-1") --format '{{.State.Health.Status}}' 2>$null) -join '' } while ($h -ne 'healthy' -and (Get-Date) -lt $deadline)
            if ($h -ne 'healthy') { throw ($svc + " unhealthy") } }
    } finally { $ErrorActionPreference = $prev } }
Check 'k6 2x load (prod storefront; breach prints its own evidence)' {
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    & docker pull grafana/k6 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { $ErrorActionPreference = $prev; throw 'k6 image pull failed' }
    & docker rm -f rfo-k6 *> $null
    & docker run --rm -d --entrypoint sleep --name rfo-k6 --network rfo_edge grafana/k6 600 *> $null
    & docker cp .\loadtests\store-load.js rfo-k6:/load.js *> $null
    $k6 = (& docker exec rfo-k6 k6 run --insecure-skip-tls-verify /load.js 2>&1 | Out-String)
    $code = $LASTEXITCODE
    & docker rm -f rfo-k6 *> $null
    $ErrorActionPreference = $prev
    $k6 -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -match 'checks|http_req_duration|threshold|crossed' } | Select-Object -First 6
    if ($code -ne 0) { throw ("k6 breach (exit=" + $code + ") - summary above") } }
Check 'pgbench write throughput >= 100 tps' {
    $prev3 = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    & docker compose exec -T postgres psql -U rfo_admin -d rfo -c "DROP DATABASE IF EXISTS bench;" *> $null
    & docker compose exec -T postgres psql -U rfo_admin -d rfo -c "CREATE DATABASE bench;" *> $null
    & docker compose exec -T postgres pgbench -U rfo_admin -i -s 5 bench *> $null
    $t = (& docker compose exec -T postgres pgbench -U rfo_admin -c 8 -j 2 -T 15 bench) 2>&1 | Out-String
    $tps = [regex]::Match($t, 'tps = ([0-9.]+)').Groups[1].Value
    & docker compose exec -T postgres psql -U rfo_admin -d rfo -c "DROP DATABASE IF EXISTS bench;" *> $null
    $ErrorActionPreference = $prev3
    if ($tps -eq '') { throw "no tps; output: " + $t.Substring(0, [Math]::Min(200, $t.Length)) }
    if ([double]::Parse($tps, [Globalization.CultureInfo]::InvariantCulture) -lt 100) { throw "tps=$tps" }
    Write-Host ("         pgbench: " + $tps + " tps") -ForegroundColor DarkGray }

Write-Host "`nResult: $pass passed, $fail failed" -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
if ($fail -gt 0) { exit 1 }
Write-Host 'PHASE 10 VERIFIED - RFO PLATFORM: GO-LIVE READY.' -ForegroundColor Green
