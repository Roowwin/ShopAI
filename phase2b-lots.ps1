#Requires -Version 5.1
<# RFO Phase 2b: lots (unique lot_number, intake/active/completed/cancelled),
   assets.lot_id NOT NULL + backfill, v_storefront_assets view, auto complete/reopen,
   Test-Phase2b.ps1 (7 checks). Run from project root. #>
[CmdletBinding()]
param([string]$ProjectRoot = (Get-Location).Path)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Write-TextFile {
    param([string]$Rel, [string]$Content)
    $full = Join-Path $ProjectRoot $Rel
    $dir = Split-Path $full -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    [IO.File]::WriteAllText($full, ($Content -replace "`r`n", "`n"), $Utf8NoBom)
    Write-Host "  create  $Rel" -ForegroundColor Green
}

Write-TextFile 'apps/backend/alembic/versions/0003_lots.py' @'
from alembic import op

revision = "0003_lots"
down_revision = "0002_seed"
branch_labels = None
depends_on = None

DDL = r'''
CREATE TABLE lots (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  lot_number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'intake' CHECK (status IN ('intake','active','completed','cancelled')),
  warehouse TEXT NULL,
  notes TEXT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE FUNCTION rfo_lots_check_status() RETURNS trigger AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF (OLD.status, NEW.status) IN (
        ('intake','active'),('intake','cancelled'),
        ('active','completed'),('active','cancelled'),
        ('completed','active')) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'illegal lot transition % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_lots_status BEFORE UPDATE ON lots
FOR EACH ROW EXECUTE FUNCTION rfo_lots_check_status();
CREATE TRIGGER trg_lots_touch BEFORE UPDATE ON lots
FOR EACH ROW EXECUTE FUNCTION rfo_touch_updated_at();

ALTER TABLE assets ADD COLUMN lot_id BIGINT NULL REFERENCES lots(id);
CREATE INDEX assets_lot_idx ON assets (lot_id);

INSERT INTO lots (lot_number, status, warehouse)
SELECT * FROM (VALUES
  ('LOT-2026-0001','intake','WH-A'),
  ('LOT-2026-0002','active','WH-A')
) AS v(lot_number, status, warehouse)
WHERE NOT EXISTS (SELECT 1 FROM lots WHERE lot_number IN ('LOT-2026-0001','LOT-2026-0002'));

UPDATE assets SET lot_id = (SELECT id FROM lots WHERE lot_number='LOT-2026-0001') WHERE serial_number='RX-SEED-001';
UPDATE assets SET lot_id = (SELECT id FROM lots WHERE lot_number='LOT-2026-0002') WHERE serial_number LIKE 'RX-BULK-%';

ALTER TABLE assets ALTER COLUMN lot_id SET NOT NULL;

-- 10 units listed so the storefront rule is genuinely testable
UPDATE assets SET status='listed'
WHERE serial_number IN (SELECT 'RX-BULK-' || lpad(g::text,4,'0') FROM generate_series(1,10) g)
  AND status='graded';

CREATE VIEW v_storefront_assets AS
SELECT a.*, l.lot_number, l.updated_at AS lot_updated_at
FROM assets a JOIN lots l ON l.id = a.lot_id
WHERE l.status = 'active' AND a.status = 'listed';

CREATE FUNCTION rfo_lot_status_from_assets() RETURNS trigger AS $$
DECLARE
  v_lot BIGINT := COALESCE(NEW.lot_id, OLD.lot_id);
  v_listed INT;
BEGIN
  SELECT count(*) INTO v_listed FROM assets WHERE lot_id = v_lot AND status = 'listed';
  IF v_listed = 0 THEN
    UPDATE lots SET status='completed' WHERE id = v_lot AND status='active';
  ELSE
    UPDATE lots SET status='active' WHERE id = v_lot AND status='completed';
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_assets_lot_status AFTER INSERT OR UPDATE ON assets
FOR EACH ROW EXECUTE FUNCTION rfo_lot_status_from_assets();
'''

def upgrade():
    op.execute(DDL)

def downgrade():
    op.execute("DROP VIEW IF EXISTS v_storefront_assets;")
    op.execute("DROP TRIGGER IF EXISTS trg_assets_lot_status ON assets;")
    op.execute("DROP TRIGGER IF EXISTS trg_lots_status ON lots;")
    op.execute("DROP TRIGGER IF EXISTS trg_lots_touch ON lots;")
    op.execute("DROP FUNCTION IF EXISTS rfo_lots_check_status, rfo_lot_status_from_assets;")
    op.execute("ALTER TABLE assets ALTER COLUMN lot_id DROP DEFAULT;")
'@)

Write-TextFile 'scripts/Test-Phase2b.ps1' @'
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
'@

# record in state
$st = Join-Path $ProjectRoot 'docs\state.md'
$s2 = [IO.File]::ReadAllText($st)
if ($s2 -notmatch 'Phase 2b:') {
    $s2 = $s2.TrimEnd() + "`nLots model (0003): lot_id NOT NULL, v_storefront_assets view = listed AND active lot, auto-hide on sellout, auto-reopen on relist; intake->active = staff action.`n"
    [IO.File]::WriteAllText($st, $s2, $Utf8NoBom)
}
Push-Location $ProjectRoot
try {
    & docker compose config --quiet *> $null
    if ($LASTEXITCODE -ne 0) { throw 'compose invalid' }
    Write-Host '  ok      compose valid' -ForegroundColor Green
} finally { Pop-Location }
Write-Host "`nNext: migrate + Test-Phase2b" -ForegroundColor Yellow
