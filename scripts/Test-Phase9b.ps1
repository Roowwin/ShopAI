#Requires -Version 5.1
<# Phase 9b gate v2: string-match based (no JSON parse to fail); failures carry evidence. #>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Set-Location (Split-Path $PSScriptRoot -Parent)
$pass = 0; $fail = 0
function Check { param([string]$Name, [scriptblock]$Body)
    try { & $Body; $script:pass++; Write-Host "  PASS  $Name" -ForegroundColor Green }
    catch { $script:fail++; Write-Host "  FAIL  $Name - $($_.Exception.Message)" -ForegroundColor Red } }

Check 'prometheus up + scraping postgres exporter' {
    $r = (& curl.exe -s "http://127.0.0.1:9090/api/v1/query?query=up") -join ''
    if ($r -notmatch '"status":"success"') { throw 'prometheus not answering: ' + $r.Substring(0, [Math]::Min(120, $r.Length)) }
    if ($r -notmatch 'exporter') { throw 'exporter not among targets: ' + $r.Substring(0, [Math]::Min(120, $r.Length)) }
}
Check 'metrics contain rfo db' {
    $m = (& docker compose exec -T postgres-exporter wget -qO- http://127.0.0.1:9187/metrics)
    if (-not (($m | Out-String) -match 'pg_stat_database')) { throw 'no pg metrics' }
}
Check 'grafana healthy + datasource provisioned' {
    $sec = (Get-Content .\.env | Where-Object { $_ -match '^GRAFANA_PASSWORD=' }) -replace '^GRAFANA_PASSWORD=', ''
    $g = (& curl.exe -s -u ("admin:" + $sec.Trim()) http://127.0.0.1:3002/api/datasources)
    if (($g | Out-String) -notmatch 'prom-db') { throw 'datasource missing - paste grafana logs' }
}

Write-Host "`nResult: $pass passed, $fail failed" -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
if ($fail -gt 0) { exit 1 }
Write-Host 'PHASE 9B VERIFIED - say "go phase 10".' -ForegroundColor Yellow
