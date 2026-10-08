#Requires -Version 5.1
<# Phase 10 FINAL gate. #>
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

Check 'api readyz via edge' {
    $rd = ((& curl.exe -sk https://api.rfo.localhost/readyz) -join '')
    if ($rd -notmatch '"db":true') { throw "readyz: $rd" }
}
Check 'WAL archiving active' {
    $v = ((& docker compose exec -T postgres psql -U rfo_admin -d rfo -tAc "SELECT setting FROM pg_settings WHERE name = 'archive_mode'") | Out-String).Trim()
    if ($v -ne 'on') { throw "archive_mode=$v" }
}
Check 'wal segments archived >= 1' {
    $n = ((& docker compose exec -T postgres psql -U rfo_admin -d rfo -tAc "SELECT archived_count FROM pg_stat_archiver") | Out-String).Trim()
    if ([int]$n -lt 1) { throw "archived=$n" }
}
Check 'production next build (storefront + backoffice)' {
    foreach ($app in 'storefront','backoffice') {
        & docker compose exec -T $app sh -c "cd /app && npm run build" 2>&1 | Out-String | ForEach-Object { ($_ -split "`n") | Where-Object { $_ -match 'error|Error' } | Select-Object -First 3 }
        if ($LASTEXITCODE -ne 0) { throw ($app + " build failed (exit=" + $LASTEXITCODE + ")") }
    }
}
Check 'k6 2x load passes thresholds' {
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    & docker run --rm --network rfo_edge -v (Join-Path (Get-Location) 'loadtests'):/load:ro grafana/k6 run --insecure-skip-tls-verify /load/store-load.js 2>&1 | Out-String | ForEach-Object { ($_ -split "`n") | Where-Object { $_ -match 'http_req_duration|checks:' } | Select-Object -First 4 }
    $code = $LASTEXITCODE; $ErrorActionPreference = $prev
    if ($code -ne 0) { throw ("k6 breached thresholds (exit=" + $code + ")") }
}
Check 'pgbench write throughput >= 100 tps' {
    & docker compose exec -T postgres psql -U rfo_admin -c "DROP DATABASE IF EXISTS bench;" *> $null
    & docker compose exec -T postgres psql -U rfo_admin -c "CREATE DATABASE bench;" *> $null
    & docker compose exec -T postgres pgbench -U rfo_admin -i -s 5 bench *> $null
    $t = (& docker compose exec -T postgres pgbench -U rfo_admin -c 8 -j 2 -T 15 bench) 2>&1 | Out-String
    $tps = [regex]::Match($t, 'tps = ([0-9.]+)').Groups[1].Value
    & docker compose exec -T postgres psql -U rfo_admin -c "DROP DATABASE bench;" *> $null
    if ([double]::Parse($tps, [Globalization.CultureInfo]::InvariantCulture) -lt 100) { throw "tps=$tps" }
    Write-Host ("         (pgbench " + $tps + " tps recorded)") -ForegroundColor DarkGray
}

Write-Host "`nResult: $pass passed, $fail failed" -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
if ($fail -gt 0) { exit 1 }
Write-Host 'PHASE 10 VERIFIED - RFO PLATFORM: GO-LIVE READY.' -ForegroundColor Green