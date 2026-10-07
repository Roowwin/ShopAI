#Requires -Version 5.1
# Phase 2 verification gate v1
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
# quote-safe psql through pgbouncer (PS 5.1 strips embedded double quotes in native args)
function Db {
    param([string]$RoleEnv, [string]$Role, [string]$Sql, [switch]$Quiet)
    $args = @('exec','-T','pgbouncer','sh','-c',
        ('PGPASSWORD=$' + $RoleEnv + ' psql -h 127.0.0.1 -p 5432 -U ' + $Role + ' -d rfo -tAc ' + [char]39 + $Sql + [char]39))
    $out = & docker @args
    if ($LASTEXITCODE -ne 0 -and -not $Quiet) { throw "sql failed: $($out -join ' ')" }
    return ($out | Out-String)
}
function DbHost {   # direct psql inside postgres container (local socket, for admin checks)
    param([string]$Sql)
    $out = & docker compose exec -T postgres psql -U rfo_admin -d rfo -tAc $Sql
    if ($LASTEXITCODE -ne 0) { throw "sql failed: $($out -join ' ')" }
    return ($out | Out-String)
}

Write-Host "`n[1/4] Migrations" -ForegroundColor Cyan
Check 'alembic at head' {
    $out = & docker compose run --rm migrate alembic current
    if ($LASTEXITCODE -ne 0) { throw 'alembic current failed' }
    if (-not (($out | Out-String) -match '\(head\)')) { throw "no head: $($out | Out-String)" }
}

Write-Host "`n[2/4] Schema objects" -ForegroundColor Cyan
Check 'all 20 tables exist' {
    $n = [int]((DbHost "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename IN
        ('users','password_credentials','oauth_identities','email_tokens','staff_users','staff_passwords',
         'brands','categories','products','product_media','assets','stock_movements','reservations',
         'orders','order_lines','order_tax_lines','payments','promotions','product_promotions','audit_log')").Trim())
    if ($n -ne 20) { throw "tables=$n" }
}
Check 'ledger partitioned with >=6 months' {
    $p = [int]((DbHost "SELECT count(*) FROM pg_inherits WHERE inhparent = 'stock_movements'::regclass").Trim())
    if ($p -lt 6) { throw "partitions=$p" }
}

Write-Host "`n[3/4] Role security probes" -ForegroundColor Cyan
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
    if ((Invoke-NativeQuiet { Db -RoleEnv DB_READONLY_PASSWORD -Role rfo_ro 'INSERT INTO orders (shipping_country) VALUES (' + [char]39 + 'AU' + [char]39 + ')' -Quiet }) -eq 0) { throw 'ro writable!' }
}
Check 'rfo_app reads seeded assets' {
    $out = Db -RoleEnv DB_APP_PASSWORD -Role rfo_app 'SELECT count(*) FROM assets'
    if ($out.Trim() -ne '5000') { throw "assets=$($out.Trim())" }
}

Write-Host "`n[4/4] Integrity" -ForegroundColor Cyan
Check 'every FK indexed (0 missing)' {
    $q = 'SELECT con.conname FROM pg_constraint con JOIN pg_class rel ON rel.oid=con.conrelid JOIN pg_namespace n ON n.oid=rel.relnamespace WHERE con.contype=' + [char]39 + 'f' + [char]39 + ' AND n.nspname=' + [char]39 + 'public' + [char]39 + ' AND rel.relkind=' + [char]39 + 'r' + [char]39 + ' AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid=con.conrelid AND i.indkey[0]=con.conkey[1] AND i.indpred IS NULL)'
    $missing = (Db -RoleEnv DB_APP_PASSWORD -Role rfo_app $q).Trim()
    if ($missing -ne '') { throw "unindexed FKs: $missing" }
}
Check 'EXPLAIN uses product index' {
    $plan = (Db -RoleEnv DB_APP_PASSWORD -Role rfo_app 'EXPLAIN SELECT 1 FROM assets WHERE product_id=1' | Out-String)
    if ($plan -notmatch 'Index') { throw "seq scan: $plan" }
}
Check 'citext serial lookup uses index' {
    $plan = (Db -RoleEnv DB_APP_PASSWORD -Role rfo_app 'EXPLAIN SELECT 1 FROM assets WHERE serial_number=' + [char]39 + 'rx-bulk-0499' + [char]39 | Out-String)
    if ($plan -notmatch 'Index') { throw "no index: $plan" }
}
Check 'illegal transition rejected' {
    if ((Invoke-NativeQuiet { Db -RoleEnv DB_APP_PASSWORD -Role rfo_app 'BEGIN; UPDATE assets SET status=' + [char]39 + 'listed' + [char]39 + ' WHERE serial_number=' + [char]39 + 'RX-SEED-001' + [char]39 + '; ROLLBACK;' -Quiet }) -eq 0) { throw 'guard missing!' }
}
Check 'legal transition passes (rolled back)' {
    if ((Invoke-NativeQuiet { Db -RoleEnv DB_APP_PASSWORD -Role rfo_app 'BEGIN; UPDATE assets SET status=' + [char]39 + 'tested' + [char]39 + ' WHERE serial_number=' + [char]39 + 'RX-SEED-001' + [char]39 + '; ROLLBACK;' -Quiet }) -ne 0) { throw 'legal transition blocked' }
}
Check 'double reservation blocked' {
    if ((Invoke-NativeQuiet { Db -RoleEnv DB_APP_PASSWORD -Role rfo_app 'BEGIN; INSERT INTO reservations (asset_id, expires_at) SELECT id, now() + INTERVAL ' + [char]39 + '7 days' + [char]39 + ' FROM assets WHERE serial_number=' + [char]39 + 'RX-BULK-0001' + [char]39 + '; INSERT INTO reservations (asset_id, expires_at) SELECT id, now() + INTERVAL ' + [char]39 + '7 days' + [char]39 + ' FROM assets WHERE serial_number=' + [char]39 + 'RX-BULK-0001' + [char]39 + '; ROLLBACK;' -Quiet }) -eq 0) { throw 'double buy allowed!' }
}
Check 'far-future ledger insert rejected' {
    if ((Invoke-NativeQuiet { Db -RoleEnv DB_APP_PASSWORD -Role rfo_app 'BEGIN; INSERT INTO stock_movements (asset_id, qty, reason, moved_at) SELECT id, 1, ' + [char]39 + 'probe' + [char]39 + ', now() + INTERVAL ' + [char]39 + '366 days' + [char]39 + ' FROM assets LIMIT 1; ROLLBACK;' -Quiet }) -eq 0) { throw 'future partition exists?!' }
}

Write-Host "`nResult: $pass passed, $fail failed" -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
if ($fail -gt 0) { exit 1 }
Write-Host 'PHASE 2 VERIFIED - say "go phase 3".' -ForegroundColor Yellow