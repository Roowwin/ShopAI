#Requires -Version 5.1
# Phase 2b verification - lots domain rules (7 checks)
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
function Db {
    param([string]$RoleEnv, [string]$Role, [string]$Sql, [switch]$Quiet)
    $qq = [string][char]39
    $esc = $Sql.Replace($qq, $qq + '\' + $qq + $qq)
    $cmd = 'PGPASSWORD=$' + $RoleEnv + ' psql -h 127.0.0.1 -p 5432 -U ' + $Role + ' -d rfo -tAc ' + $qq + $esc + $qq
    $a = @('compose','exec','-T','pgbouncer','sh','-c', $cmd)
    $out = & docker @a
    if ($LASTEXITCODE -ne 0 -and -not $Quiet) { throw ('sql failed: ' + ($out -join ' ')) }
    return ($out | Out-String)
}

Check 'lots seeded (2)' {
    if ((Db -RoleEnv DB_APP_PASSWORD -Role rfo_app 'SELECT count(*) FROM lots').Trim() -ne '2') { throw 'missing lots' }
}
Check 'every asset assigned to a lot' {
    if ((Db -RoleEnv DB_APP_PASSWORD -Role rfo_app 'SELECT count(*) FROM assets WHERE lot_id IS NULL').Trim() -ne '0') { throw 'lot_id NULL exists' }
}
Check 'storefront view shows exactly 10' {
    if ((Db -RoleEnv DB_APP_PASSWORD -Role rfo_app 'SELECT count(*) FROM v_storefront_assets').Trim() -ne '10') { throw 'view count wrong' }
}
Check 'intake lot invisible on storefront' {
    if ((Db -RoleEnv DB_APP_PASSWORD -Role rfo_app 'SELECT count(*) FROM v_storefront_assets WHERE lot_number=''LOT-2026-0001''').Trim() -ne '0') { throw 'intake visible!' }
}
Check 'sellout hides lot (view=0, lot=completed)' {
    $r = Db -RoleEnv DB_APP_PASSWORD -Role rfo_app 'BEGIN; UPDATE assets SET status=''sold'' WHERE status=''listed'' AND lot_id=(SELECT id FROM lots WHERE lot_number=''LOT-2026-0002''); SELECT count(*) FROM v_storefront_assets; SELECT status FROM lots WHERE lot_number=''LOT-2026-0002''; ROLLBACK;'
    $lines = ($r -split "`n") | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' }
    if (($lines.Count -lt 2) -or ($lines[0] -ne '0') -or ($lines[1] -ne 'completed')) { throw "got: $($lines -join ' | ')" }
}
Check 'relist reopens lot (completed->active)' {
    $r = Db -RoleEnv DB_APP_PASSWORD -Role rfo_app 'BEGIN; UPDATE assets SET status=''listed'' WHERE serial_number=''RX-BULK-0050''; SELECT status FROM lots WHERE lot_number=''LOT-2026-0002''; SELECT count(*) FROM v_storefront_assets; ROLLBACK;'
    $lines = ($r -split "`n") | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' }
    if (($lines.Count -lt 2) -or ($lines[0] -ne 'active') -or ($lines[1] -ne '1')) { throw "got: $($lines -join ' | ')" }
}
Check 'illegal lot transition rejected' {
    if ((Invoke-NativeQuiet { Db -RoleEnv DB_APP_PASSWORD -Role rfo_app 'BEGIN; UPDATE lots SET status=''cancelled'' WHERE lot_number=''LOT-2026-0002''; ROLLBACK;' -Quiet }) -eq 0) { throw 'lot guard missing' }
}

Write-Host "`nResult: $pass passed, $fail failed" -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
if ($fail -gt 0) { exit 1 }
Write-Host 'PHASE 2B VERIFIED - say "go phase 3".' -ForegroundColor Yellow
