#Requires -Version 5.1
# Phase 4a verification gate
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

Check 'alembic at 0005 head' {
    $out = (& docker compose run --rm migrate alembic current | Out-String)
    if ($out -notmatch '0005_lot_number_seq') { throw "revision: $out" }
}
Check 'api readyz via edge' {
    $rd = ((& curl.exe -sk https://api.rfo.localhost/readyz) -join '')
    if ($rd -notmatch '"db":true') { throw "readyz: $rd" }
}
Check 'pytest suite (lifecycle/dup/rbac/move)' {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & docker compose run --rm api pytest -q tests/test_intake.py; $code = $LASTEXITCODE } finally { $ErrorActionPreference = $prev }
    if ($code -ne 0) { throw "pytest exit=$code" }
}

Write-Host "`nResult: $pass passed, $fail failed" -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
if ($fail -gt 0) { exit 1 }
Write-Host 'PHASE 4A VERIFIED - say "phase 4b".' -ForegroundColor Yellow