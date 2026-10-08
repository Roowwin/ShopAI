#Requires -Version 5.1
# Phase 5 verification gate
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

Check 'alembic at 0007 head' {
    $out = (& docker compose run --rm migrate alembic current | Out-String)
    if ($out -notmatch '0007_search_vectors') { throw "revision: $out" }
}
Check 'search vectors + GIN indexes exist' {
    $n = ((& docker compose exec -T postgres psql -U rfo_admin -d rfo -tAc "SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname IN ('products_vec_idx','assets_vec_idx')") | Out-String).Trim()
    if ($n -ne '2') { throw "gin indexes=$n" }
}
Check 'worker service healthy + redis reachable' {
    $h = (& docker inspect rfo-worker-1 --format '{{.State.Health.Status}}' 2>$null) -join ''
    if ($h -ne 'healthy') { throw "worker health=$h - paste docker compose logs worker --tail 30" }
}
Check 'pytest suite (ttl release)' {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & docker compose run --rm api pytest -q tests/test_worker.py; $code = $LASTEXITCODE } finally { $ErrorActionPreference = $prev }
    if ($code -ne 0) { throw "pytest exit=$code" }
}

Write-Host "`nResult: $pass passed, $fail failed" -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
if ($fail -gt 0) { exit 1 }
Write-Host 'PHASE 5 VERIFIED - say "go phase 6".' -ForegroundColor Yellow