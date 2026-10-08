#Requires -Version 5.1
<# Phase 9a gate: backups live, dump present, restore drill passes, CI exists. #>
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
Check 'backups service running' {
    $s = ((& docker inspect rfo-backups-1 --format '{{.State.Status}}' 2>$null) -join '')
    if ($s -ne 'running') { throw "backups=$s" }
}
Check 'dump artifact exists (>=100KB)' {
    $d = Get-ChildItem .\backups\rfo_*.dump | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $d) { throw 'no dump' }
    if ($d.Length -lt 100KB) { throw "dump too small: " + $d.Length }
}
Check 'restore drill passes' {
    & (Join-Path $PSScriptRoot 'restore-drill.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'drill failed' }
}
Check 'CI workflow exists' { if (-not (Test-Path .\.github\workflows\ci.yml)) { throw 'missing' } }

Write-Host "`nResult: $pass passed, $fail failed" -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
if ($fail -gt 0) { exit 1 }
Write-Host 'PHASE 9A VERIFIED - say "phase 9b" (observability)."`n' -ForegroundColor Yellow
