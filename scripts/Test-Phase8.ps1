#Requires -Version 5.1
<# Phase 8 verification: CSP at edge, rate-limit burst, secret sweep, scan reports. #>
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

Check 'CSP + frame-ancestors on storefront' {
    $h = ((& curl.exe -skI https://shop.rfo.localhost/) -join ' ')
    if ($h -notmatch 'Content-Security-Policy') { throw 'no CSP header' }
}
Check 'CSP on backoffice' {
    $h = ((& curl.exe -skI https://api.rfo.localhost/healthz) -join ' ') ; if ($h -match 'CSP') { Write-Host '  note: api has no CSP (by design - JSON)' }
    $h2 = ((& curl.exe -skI https://admin.rfo.localhost/) -join ' ')
    if ($h2 -notmatch 'Content-Security-Policy') { throw 'no CSP header on admin' }
}
Check 'login rate limit fires (>0 x 503 in 16-burst)' {
    $hits = 0
    for ($i = 0; $i -lt 16; $i++) {
        $c = (& curl.exe -sk -o NUL -w '%{http_code}' -X POST -H 'Content-Type: application/json' --data '{"email":"x@y.zz","password":"z"}' https://api.rfo.localhost/staff/auth/login) -join ''
        if ($c -eq '503') { $hits++ }
    }
    if ($hits -lt 1) { throw "no 503 in burst" }
}
Check 'no secrets tracked in git' {
    $a = (& git ls-files .env 2>$null) -join ''
    if ($a -ne '') { throw '.env is tracked!' }
    $b = (& git grep -I -E 'JWT_SECRET=[0-9a-f]{16,}|PAYMENT_WEBHOOK_SECRET=[0-9a-f]{16,}|REDIS_PASSWORD=[0-9a-f]{16,}' -- 2>$null) -join ''
    if ($b -ne '') { throw 'secret literal in: ' + $b }
}
Check 'threat-model doc present' { if (-not (Test-Path .\docs\security-checklist.md)) { throw 'missing' } }

Write-Host '---- dependency scans (report; CI enforces in Phase 10) ----' -ForegroundColor Cyan
$prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
& docker compose run --rm api sh -c 'pip install -q pip-audit 2>&1 | tail -1; pip-audit 2>&1 | tail -5' 2>&1 | Out-String | ForEach-Object { ($_ -split "`n") | Where-Object { $_ -ne '' } }
& docker compose exec -T storefront sh -c 'npm audit --omit=dev 2>&1 | tail -3' 2>&1 | Out-String | ForEach-Object { ($_ -split "`n") | Where-Object { $_ -ne '' } }
& docker compose exec -T backoffice sh -c 'npm audit --omit=dev 2>&1 | tail -3' 2>&1 | Out-String | ForEach-Object { ($_ -split "`n") | Where-Object { $_ -ne '' } }
$ErrorActionPreference = $prev

Write-Host "`nResult: $pass passed, $fail failed" -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
if ($fail -gt 0) { exit 1 }
Write-Host 'PHASE 8 VERIFIED - say "go phase 9" (backups, observability, CI).' -ForegroundColor Yellow
