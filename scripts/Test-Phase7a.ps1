#Requires -Version 5.1
# Phase 7a verification gate
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
Check 'catalog via edge' {
    $j = ((& curl.exe -sk https://api.rfo.localhost/store/catalog) -join '')
    if ($j -notmatch 'galaxy-s21') { throw "catalog bad: " + $j.Substring(0, [Math]::Min(100, $j.Length)) }
}
Check 'pytest suite (catalog/search/guest checkout)' {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & docker compose run --rm api pytest -q tests/test_storefront_api.py; $code = $LASTEXITCODE } finally { $ErrorActionPreference = $prev }
    if ($code -ne 0) { throw "pytest exit=$code" }
}

Write-Host "`nResult: $pass passed, $fail failed" -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
if ($fail -gt 0) { exit 1 }
Write-Host 'PHASE 7A VERIFIED - say "phase 7b".' -ForegroundColor Yellow