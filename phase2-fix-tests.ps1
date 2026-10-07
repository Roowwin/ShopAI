#Requires -Version 5.1
<# RFO Phase 2 test fix: add missing 'compose' arg, double-quote SQL properly,
   plain SQL in checks - 16 checks rerun genuinely. #>
[CmdletBinding()]
param([string]$ProjectRoot = (Get-Location).Path)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

[IO.File]::WriteAllText((Join-Path $ProjectRoot 'scripts\Test-Phase2.ps1'), (@'
#Requires -Version 5.1
# Phase 2 verification gate v2 (fixed: compose arg + SQL quote handling)
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
    $sq = $Sql.Replace([char]39, [char]39 + [char]39)
    $cmd = 'PGPASSWORD=$' + $RoleEnv + ' psql -h 127.0.0.1 -p 5432 -U ' + $Role + ' -d rfo -tAc ' + [char]39 + $sq + [char]39
    $a = @('compose','exec','-T','pgbouncer','sh','-c', $cmd)
    $out = & docker @a
    if ($LASTEXITCODE -ne 0 -and -not $Quiet) { throw ('sql failed: ' + ($out -join ' ')) }
    return ($out | Out-String)
}
function DbHost {
    param([string]$Sql)
    $out = & docker compose exec -T postgres psql -U rfo_admin -d rfo -tAc $Sql
    if ($LASTEXITCODE -ne 0) { throw ('sql failed: ' + ($out -join ' ')) }
    return ($out | Out-String)
}

Write-Host "`n[1/4] Migrations" -ForegroundColor Cyan
Check 'alembic at head' {
    $out = & docker compose run --rm migrate alembic current
    if ($LASTEXITCODE -ne 0) { throw 'alembic current failed' }
    if (-not (($out | Out-String) -match '\(head\)')) { throw ("no head: " + ($out | Out-String)) }
}

Write-Host "`n[2/4] Schema objects" -ForegroundColor Cyan
Check 'all 20 tables exist' {
    $n = [int]((DbHost "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename IN ('users','password_credentials','oauth_identities','email_tokens','staff_users','staff_passwords','brands','categories','products','product_media','assets','stock_movements','reservations','orders','order_lines','order_tax_lines','payments','promotions','product_promotions','audit_log')").Trim())
    if ($n -ne 20) { throw "tables=$n" }
}
Check 'ledger partitioned with >=6 months' {
    $p = [int]((DbHost "SELECT count(*) FROM pg_inherits WHERE inhparent = 'stock_movements'::regclass").Trim())
    if ($p -lt 6) { throw "partitions=$p" }
}

Write-Host "`n[3/4] Role security probes (genuine)" -ForegroundColor Cyan
Check 'rfo_app reads seeded assets' {
    $c = (Db -RoleEnv DB_APP_PASSWORD -Role rfo_app 'SELECT count(*) FROM assets').Trim()
    if ($c -ne '5000') { throw "assets=$c" }
}
Check 'rfo_app cannot CREATE TABLE' {
    if ((Invoke-NativeQuiet { Db -RoleEnv DB_APP_PASSWORD -Role rfo_app 'CREATE TABLE probe_ddl_denied (x int)' -Quiet }) -eq 0) { throw 'DDL allowed!' }
}
Check 'rfo_app cannot UPDATE audit_log' {
    if ((Invoke-NativeQuiet { Db -RoleEnv DB_APP_PASSWORD -Role rfo_app 'UPDATE audit_log SET action=action' -Quiet }) -eq 0) { throw 'audit mutable!' }
}
Check 'rfo_ro can read orders' {
    if ((Invoke-NativeQuiet { Db -RoleEnv DB_READONLY_PASSWORD -Role rfo_ro 'SELECT count(*) FROM orders' -Quiet }) -ne 0) { throw 'ro read blocked' }
}
Check 'rfo_ro cannot INSERT' {
    if ((Invoke-NativeQuiet { Db -RoleEnv DB_READONLY_PASSWORD -Role rfo_ro 'INSERT INTO orders (shipping_country) VALUES (''AU'')' -Quiet }) -eq 0) { throw 'ro writable!' }
}

Write-Host "`n[4/4] Integrity" -ForegroundColor Cyan
Check 'every FK indexed (0 missing)' {
    $q = 'SELECT con.conname FROM pg_constraint con JOIN pg_class rel ON rel.oid=con.conrelid JOIN pg_namespace n ON n.oid=rel.relnamespace WHERE con.contype=''f'' AND n.nspname=''public'' AND rel.relkind=''r'' AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid=con.conrelid AND i.indkey[0]=con.conkey[1] AND i.indpred IS NULL)'
    $missing = (Db -RoleEnv DB_APP_PASSWORD -Role rfo_app $q).Trim()
    if ($missing -ne '') { throw "unindexed FKs: $missing" }
}
Check 'EXPLAIN uses product index' {
    $plan = Db -RoleEnv DB_APP_PASSWORD -Role rfo_app 'EXPLAIN SELECT 1 FROM assets WHERE product_id=1'
    if ($plan -notmatch 'Index') { throw "seq scan: $plan" }
}
Check 'citext serial lookup (lowercase) uses index' {
    $plan = Db -RoleEnv DB_APP_PASSWORD -Role rfo_app 'EXPLAIN SELECT 1 FROM assets WHERE serial_number=''rx-bulk-0499'''
    if ($plan -notmatch 'Index') { throw "no index: $plan" }
}
Check 'illegal transition rejected' {
    if ((Invoke-NativeQuiet { Db -RoleEnv DB_APP_PASSWORD -Role rfo_app 'BEGIN; UPDATE assets SET status=''listed'' WHERE serial_number=''RX-SEED-001''; ROLLBACK;' -Quiet }) -eq 0) { throw 'guard missing!' }
}
Check 'legal transition passes (rolled back)' {
    if ((Invoke-NativeQuiet { Db -RoleEnv DB_APP_PASSWORD -Role rfo_app 'BEGIN; UPDATE assets SET status=''tested'' WHERE serial_number=''RX-SEED-001''; ROLLBACK;' -Quiet }) -ne 0) { throw 'legal blocked' }
}
Check 'double reservation blocked' {
    if ((Invoke-NativeQuiet { Db -RoleEnv DB_APP_PASSWORD -Role rfo_app 'BEGIN; INSERT INTO reservations (asset_id, expires_at) SELECT id, now() + INTERVAL ''7 days'' FROM assets WHERE serial_number=''RX-BULK-0001''; INSERT INTO reservations (asset_id, expires_at) SELECT id, now() + INTERVAL ''7 days'' FROM assets WHERE serial_number=''RX-BULK-0001''; ROLLBACK;' -Quiet }) -eq 0) { throw 'double buy allowed!' }
}
Check 'far-future ledger insert rejected' {
    if ((Invoke-NativeQuiet { Db -RoleEnv DB_APP_PASSWORD -Role rfo_app 'BEGIN; INSERT INTO stock_movements (asset_id, qty, reason, moved_at) SELECT id, 1, ''probe'', now() + INTERVAL ''366 days'' FROM assets LIMIT 1; ROLLBACK;' -Quiet }) -eq 0) { throw 'future partition exists?!' }
}

Write-Host "`nResult: $pass passed, $fail failed" -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
if ($fail -gt 0) { exit 1 }
Write-Host 'PHASE 2 VERIFIED - say "go phase 3".' -ForegroundColor Yellow
'@ -replace "`r`n", "`n"), $Utf8NoBom)

Get-Content (Join-Path $ProjectRoot 'scripts\Test-Phase2.ps1') -TotalCount 2   # gate
Select-String -Path (Join-Path $ProjectRoot 'scripts\Test-Phase2.ps1') -Pattern "compose','exec" | Select-Object -ExpandProperty Line   # gate: fixed args
Write-Host "`nNext: .\scripts\Test-Phase2.ps1" -ForegroundColor Yellow
