#Requires -Version 5.1
<# RFO Phase 4a: ORM models, audit service, staff ops APIs (lots/assets/ledger),
   migration 0005 (lot number sequence), lifecycle tests, Test-Phase4 gates.
   Run from project root. #>
[CmdletBinding()]
param([string]$ProjectRoot = (Get-Location).Path)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
if (-not (Test-Path (Join-Path $ProjectRoot '.env'))) { throw ".env missing in $ProjectRoot" }

function Write-TextFile {
    param([string]$Rel, [string]$Content)
    $full = Join-Path $ProjectRoot $Rel
    $dir = Split-Path $full -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    [IO.File]::WriteAllText($full, ($Content -replace "`r`n", "`n"), $Utf8NoBom)
    Write-Host "  create  $Rel" -ForegroundColor Green
}

Write-TextFile 'apps/backend/alembic/versions/0005_lot_number_seq.py' @'
from alembic import op

revision = "0005_lot_number_seq"
down_revision = "0004_refresh_tokens"
branch_labels = None
depends_on = None

def upgrade():
    op.execute("CREATE SEQUENCE IF NOT EXISTS lot_number_seq START 1;")

def downgrade():
    op.execute("DROP SEQUENCE IF EXISTS lot_number_seq;")
'@

Write-TextFile 'apps/backend/app/models/__init__.py' @'
from sqlalchemy.orm import DeclarativeBase

class Base(DeclarativeBase):
    pass

from app.models.warehouse import Asset, AuditEntry, Lot, StockMovement  # noqa: E402,F401
'@

Write-TextFile 'apps/backend/app/models/warehouse.py' @'
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models import Base


class Lot(Base):
    __tablename__ = "lots"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    public_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), unique=True, server_default=text("gen_random_uuid()"))
    lot_number: Mapped[str] = mapped_column(String, unique=True)
    status: Mapped[str] = mapped_column(String)
    warehouse: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    assets: Mapped[list["Asset"]] = relationship(back_populates="lot")


class Asset(Base):
    __tablename__ = "assets"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    public_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), unique=True, server_default=text("gen_random_uuid()"))
    product_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("products.id"), nullable=True)
    serial_number: Mapped[str | None] = mapped_column(Text, nullable=True)
    imei: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String)
    grade: Mapped[str | None] = mapped_column(String, nullable=True)
    cost_cents: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    intake_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    location: Mapped[str | None] = mapped_column(Text, nullable=True)
    condition_report: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    lot_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("lots.id"), nullable=False)

    lot: Mapped["Lot"] = relationship(back_populates="assets")


class StockMovement(Base):
    __tablename__ = "stock_movements"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    moved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True, server_default=func.now())
    asset_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("assets.id"), nullable=False)
    qty: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    actor_staff_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)


class AuditEntry(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    actor_type: Mapped[str] = mapped_column(String)
    actor_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    entity: Mapped[str] = mapped_column(String)
    entity_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    action: Mapped[str] = mapped_column(Text)
    before: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    after: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    meta: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
'@

Write-TextFile 'apps/backend/app/services/__init__.py' ''
Write-TextFile 'apps/backend/app/services/audit.py' @'
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditEntry


async def audit(db: AsyncSession, actor_type: str, entity: str, action: str,
                entity_id: int | None = None, actor_id: int | None = None,
                before: dict[str, Any] | None = None, after: dict[str, Any] | None = None,
                meta: dict[str, Any] | None = None) -> None:
    """Adds an audit row inside the CALLER'S transaction (no commit here)."""
    db.add(AuditEntry(actor_type=actor_type, entity=entity, action=action,
                      entity_id=entity_id, actor_id=actor_id,
                      before=before, after=after, meta=meta))
'@

Write-TextFile 'apps/backend/app/api/v1/staff_ops.py' @'
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import selectinload

from app.api.v1.deps import require_roles
from app.core.db import get_db
from app.models import Asset, Lot, StockMovement
from app.services.audit import audit

router = APIRouter(prefix="/staff", tags=["staff-ops"])

class LotIn(BaseModel):
    lot_number: str | None = None
    warehouse: str | None = None
    notes: str | None = None

class ScanIn(BaseModel):
    serial_number: str
    lot_id: int | None = None
    lot_number: str | None = None
    product_id: int | None = None
    imei: str | None = None
    notes: str | None = None

class GradeIn(BaseModel):
    grade: str
    cost_cents: int | None = None
    condition_report: dict | None = None

class StatusIn(BaseModel):
    status: str
    note: str | None = None

class MoveIn(BaseModel):
    location: str


def _409(e: Exception) -> None:
    orig = getattr(e, "orig", None)
    msg = str(orig).replace("\n", " ")[:200] if orig is not None else str(e)[:200]
    raise HTTPException(status_code=409, detail=msg)


async def _gen_lot_number(db) -> str:
    res = await db.execute(text("SELECT 'LOT-' || to_char(now(),'YYYY') || '-' || lpad(nextval('lot_number_seq')::text, 5, '0')"))
    return res.scalar_one()


@router.post("/lots", status_code=201)
async def create_lot(body: LotIn, staff: dict = Depends(require_roles("admin", "manager", "warehouse")), db=Depends(get_db)):
    ln = body.lot_number or await _gen_lot_number(db)
    lot = Lot(lot_number=ln, status="intake", warehouse=body.warehouse, notes=body.notes)
    db.add(lot)
    await audit(db, "staff", entity="lot", action="lot_create", actor_id=staff["id"], meta={"lot_number": ln})
    try:
        await db.commit()
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)
    return {"id": lot.id, "lot_number": lot.lot_number, "status": lot.status}


@router.post("/lots/{lot_id}/activate")
async def activate_lot(lot_id: int, staff: dict = Depends(require_roles("admin", "manager")), db=Depends(get_db)):
    lot = await db.get(Lot, lot_id)
    if lot is None:
        raise HTTPException(status_code=404, detail="lot not found")
    before = {"status": lot.status}
    lot.status = "active"
    await audit(db, "staff", entity="lot", entity_id=lot.id, action="lot_activate",
                actor_id=staff["id"], before=before, after={"status": "active"})
    try:
        await db.commit()
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)
    return {"id": lot.id, "status": lot.status}


@router.post("/assets/scan-in", status_code=201)
async def scan_in(body: ScanIn, staff: dict = Depends(require_roles("admin", "manager", "warehouse", "technician")), db=Depends(get_db)):
    if (body.lot_id is None) == (body.lot_number is None):
        raise HTTPException(status_code=422, detail="provide exactly one of lot_id / lot_number")
    lot = (await db.execute(select(Lot).where(Lot.id == body.lot_id) if body.lot_id
                            else select(Lot).where(Lot.lot_number == body.lot_number))).scalars().first()
    if lot is None:
        raise HTTPException(status_code=404, detail="lot not found")
    asset = Asset(serial_number=body.serial_number, imei=body.imei, product_id=body.product_id,
                  notes=body.notes, status="received", lot_id=lot.id)
    db.add(asset)
    await db.flush()
    db.add(StockMovement(asset_id=asset.id, qty=1, reason="intake_scan", actor_staff_id=staff["id"]))
    await audit(db, "staff", entity="asset", entity_id=asset.id, action="scan_in",
                actor_id=staff["id"], after={"serial": body.serial_number, "lot": lot.lot_number})
    try:
        await db.commit()
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)
    return {"id": asset.id, "public_id": str(asset.public_id), "serial_number": asset.serial_number,
            "lot_number": lot.lot_number, "status": asset.status}


@router.post("/assets/{asset_id}/grade")
async def grade(asset_id: int, body: GradeIn, staff: dict = Depends(require_roles("admin", "manager", "technician")), db=Depends(get_db)):
    asset = await db.get(Asset, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="asset not found")
    before = {"status": asset.status, "grade": asset.grade}
    asset.status = "graded"
    asset.grade = body.grade
    if body.cost_cents is not None:
        asset.cost_cents = body.cost_cents
    if body.condition_report is not None:
        asset.condition_report = body.condition_report
    await audit(db, "staff", entity="asset", entity_id=asset.id, action="grade",
                actor_id=staff["id"], before=before, after={"status": "graded", "grade": body.grade})
    try:
        await db.commit()
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)
    return {"id": asset.id, "status": asset.status, "grade": asset.grade}


@router.post("/assets/{asset_id}/status")
async def set_status(asset_id: int, body: StatusIn, staff: dict = Depends(require_roles("admin", "manager", "warehouse")), db=Depends(get_db)):
    if body.status == "graded":
        raise HTTPException(status_code=422, detail="use /grade to enter graded state")
    asset = await db.get(Asset, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="asset not found")
    before = {"status": asset.status}
    asset.status = body.status
    await audit(db, "staff", entity="asset", entity_id=asset.id, action="status",
                actor_id=staff["id"], before=before, after={"status": body.status, "note": body.note})
    try:
        await db.commit()   # trigger enforces legal transitions; lot auto-complete/reopen fires here
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)
    return {"id": asset.id, "status": asset.status}


@router.post("/assets/{asset_id}/move")
async def move(asset_id: int, body: MoveIn, staff: dict = Depends(require_roles("admin", "manager", "warehouse")), db=Depends(get_db)):
    asset = await db.get(Asset, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="asset not found")
    before = {"location": asset.location}
    asset.location = body.location
    await audit(db, "staff", entity="asset", entity_id=asset.id, action="move",
                actor_id=staff["id"], before=before, after={"location": body.location})
    try:
        await db.commit()
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)
    return {"id": asset.id, "location": asset.location}


@router.get("/lots")
async def list_lots(limit: int = Query(20, le=100), offset: int = 0, db=Depends(get_db)):
    rows = (await db.execute(select(Lot).options(selectinload(Lot.assets))
                             .order_by(Lot.id.desc()).limit(limit).offset(offset))).scalars().all()
    return [{"id": l.id, "lot_number": l.lot_number, "status": l.status,
             "warehouse": l.warehouse, "asset_count": len(l.assets)} for l in rows]


@router.get("/assets")
async def list_assets(status: str | None = None, lot_number: str | None = None,
                      product_id: int | None = None, limit: int = Query(20, le=100), offset: int = 0,
                      db=Depends(get_db)):
    q = select(Asset).options(selectinload(Asset.lot))
    if status:
        q = q.where(Asset.status == status)
    if lot_number:
        q = q.where(Asset.lot.has(Lot.lot_number == lot_number))
    if product_id:
        q = q.where(Asset.product_id == product_id)
    rows = (await db.execute(q.order_by(Asset.id.desc()).limit(limit).offset(offset))).scalars().all()
    return [{"id": a.id, "public_id": str(a.public_id), "serial_number": a.serial_number,
             "status": a.status, "grade": a.grade, "lot_number": a.lot.lot_number} for a in rows]


@router.get("/movements")
async def list_movements(asset_id: int | None = None, limit: int = Query(50, le=200), offset: int = 0, db=Depends(get_db)):
    q = select(StockMovement).order_by(StockMovement.id.desc()).limit(limit).offset(offset)
    if asset_id:
        q = q.where(StockMovement.asset_id == asset_id)
    rows = (await db.execute(q)).scalars().all()
    return [{"id": m.id, "moved_at": m.moved_at.isoformat(), "asset_id": m.asset_id,
             "qty": m.qty, "reason": m.reason, "actor_staff_id": m.actor_staff_id} for m in rows]
'@

Write-TextFile 'apps/backend/app/main.py' @'
import logging
import time
import uuid as uuidlib

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.api.v1 import staff, staff_ops, store
from app.core.config import get_settings
from app.core.db import get_engine

s = get_settings()
logging.basicConfig(level=s.LOG_LEVEL)

docs = None if s.is_prod else "/docs"
app = FastAPI(title="RFO API", version="0.1.0-phase4a", docs_url=docs, redoc_url=None)

app.add_middleware(
    CORSMiddleware,
    allow_origins=s.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
    expose_headers=["X-Request-ID"],
)

@app.middleware("http")
async def request_context(request: Request, call_next):
    rid = request.headers.get("X-Request-ID") or uuidlib.uuid4().hex
    t0 = time.perf_counter()
    response = await call_next(request)
    response.headers["X-Request-ID"] = rid
    logging.info("%s %s %s %.1fms rid=%s", request.method, request.url.path,
                 response.status_code, (time.perf_counter() - t0) * 1000, rid)
    return response

app.include_router(staff.router)
app.include_router(staff_ops.router)
app.include_router(store.router)

@app.get("/healthz")
async def healthz() -> dict:
    return {"status": "ok"}

@app.get("/readyz")
async def readyz():
    try:
        async with get_engine().connect() as conn:
            await conn.execute(text("SELECT 1"))
        return {"db": True}
    except Exception:
        logging.exception("readyz db check failed")
        return JSONResponse(status_code=503, content={"db": False})
'@

Write-TextFile 'apps/backend/tests/test_intake.py' @'
import uuid

from sqlalchemy import text

from app.bootstrap_staff import bootstrap
from app.core.db import get_engine


async def _cleanup():
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("DELETE FROM stock_movements WHERE asset_id IN (SELECT id FROM assets WHERE serial_number LIKE 'pytest-%')"))
        await c.execute(text("DELETE FROM assets WHERE serial_number LIKE 'pytest-%'"))
        await c.execute(text("DELETE FROM lots WHERE notes = 'pytest'"))
        await c.execute(text("DELETE FROM refresh_tokens WHERE identity_id IN (SELECT id FROM staff_users WHERE email LIKE 'pytest-%')"))
        await c.execute(text("DELETE FROM staff_users WHERE email LIKE 'pytest-%'"))


def _h(tok: str) -> dict:
    return {"Authorization": "Bearer " + tok}


async def _staff(client, role: str) -> str:
    email = "pytest-" + uuid.uuid4().hex + "@test.rfo"
    sid, pw = await bootstrap(email, role)
    r = await client.post("/staff/auth/login", json={"email": email, "password": pw})
    return r.json()["access_token"]


async def test_full_asset_lifecycle(client):
    await _cleanup()
    tok = await _staff(client, "admin")
    r = await client.post("/staff/lots", json={"warehouse": "WH-T", "notes": "pytest"}, headers=_h(tok))
    assert r.status_code == 201, r.text
    lot = r.json()
    assert lot["status"] == "intake" and lot["lot_number"].startswith("LOT-")

    sn1 = "pytest-" + uuid.uuid4().hex
    r1 = await client.post("/staff/assets/scan-in", json={"lot_number": lot["lot_number"], "serial_number": sn1}, headers=_h(tok))
    r2 = await client.post("/staff/assets/scan-in", json={"lot_number": lot["lot_number"], "serial_number": "pytest-" + uuid.uuid4().hex}, headers=_h(tok))
    assert r1.status_code == 201 and r2.status_code == 201, (r1.text, r2.text)
    a1 = r1.json()

    mv = (await client.get("/staff/movements?asset_id=" + str(a1["id"]), headers=_h(tok))).json()
    assert len(mv) >= 1 and mv[0]["qty"] == 1 and mv[0]["reason"] == "intake_scan"

    r = await client.post(f"/staff/assets/{a1['id']}/grade", json={"grade": "A"}, headers=_h(tok))
    assert r.status_code == 409, "received -> graded must be rejected by trigger"

    r = await client.post(f"/staff/assets/{a1['id']}/status", json={"status": "tested"}, headers=_h(tok))
    assert r.status_code == 200
    r = await client.post(f"/staff/assets/{a1['id']}/grade", json={"grade": "A", "cost_cents": 15000}, headers=_h(tok))
    assert r.status_code == 200 and r.json()["grade"] == "A"

    eng = get_engine()
    async with eng.begin() as c:
        n = (await c.execute(text("SELECT count(*) FROM audit_log WHERE entity = :e AND entity_id = :i"),
                             {"e": "asset", "i": a1["id"]})).scalar_one()
    assert n >= 1, "audit rows missing"

    r = await client.post(f"/staff/assets/{a1['id']}/status", json={"status": "listed"}, headers=_h(tok))
    assert r.status_code == 200
    r = await client.post(f"/staff/lots/{lot['id']}/activate", headers=_h(tok))
    assert r.status_code == 200
    async with eng.begin() as c:
        n = (await c.execute(text("SELECT count(*) FROM v_storefront_assets WHERE serial_number = :s"),
                             {"s": sn1})).scalar_one()
    assert n == 1, "listed asset not on storefront view"

    r = await client.post(f"/staff/assets/{a1['id']}/status", json={"status": "sold"}, headers=_h(tok))
    assert r.status_code == 200
    async with eng.begin() as c:
        n = (await c.execute(text("SELECT count(*) FROM v_storefront_assets WHERE serial_number = :s"),
                             {"s": sn1})).scalar_one()
        ls = (await c.execute(text("SELECT status FROM lots WHERE lot_number = :l"),
                              {"l": lot["lot_number"]})).scalar_one()
    assert n == 0 and ls == "completed", "sellout rule failed"


async def test_dup_serial_409(client):
    await _cleanup()
    tok = await _staff(client, "warehouse")
    r = await client.post("/staff/lots", json={"notes": "pytest"}, headers=_h(tok))
    ln = r.json()["lot_number"]
    sn = "pytest-" + uuid.uuid4().hex
    a = await client.post("/staff/assets/scan-in", json={"lot_number": ln, "serial_number": sn}, headers=_h(tok))
    assert a.status_code == 201
    b = await client.post("/staff/assets/scan-in", json={"lot_number": ln, "serial_number": sn}, headers=_h(tok))
    assert b.status_code == 409


async def test_rbac_scan_in_sales_403(client):
    await _cleanup()
    tok_sales = await _staff(client, "sales")
    tok_wh = await _staff(client, "warehouse")
    r2 = await client.post("/staff/lots", json={"notes": "pytest"}, headers=_h(tok_wh))
    assert r2.status_code == 201
    r3 = await client.post("/staff/assets/scan-in",
                           json={"lot_number": r2.json()["lot_number"], "serial_number": "pytest-" + uuid.uuid4().hex},
                           headers=_h(tok_sales))
    assert r3.status_code == 403


async def test_move_audited(client):
    await _cleanup()
    tok = await _staff(client, "warehouse")
    r = await client.post("/staff/lots", json={"notes": "pytest"}, headers=_h(tok))
    ln = r.json()["lot_number"]
    a = await client.post("/staff/assets/scan-in", json={"lot_number": ln, "serial_number": "pytest-" + uuid.uuid4().hex}, headers=_h(tok))
    aid = a.json()["id"]
    m = await client.post(f"/staff/assets/{aid}/move", json={"location": "WH-B-02"}, headers=_h(tok))
    assert m.status_code == 200 and m.json()["location"] == "WH-B-02"
    eng = get_engine()
    async with eng.begin() as c:
        n = (await c.execute(text("SELECT count(*) FROM audit_log WHERE entity = :e AND entity_id = :i AND action = :a"),
                             {"e": "asset", "i": aid, "a": "move"})).scalar_one()
    assert n >= 1
'@

Write-TextFile 'scripts/Test-Phase4.ps1' @'
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
'@

Push-Location $ProjectRoot
try {
    & docker compose config --quiet *> $null
    if ($LASTEXITCODE -ne 0) { throw 'compose invalid' }
    & docker compose build api
    if ($LASTEXITCODE -ne 0) { throw 'api build failed' }
    & docker compose up -d
    $deadline = (Get-Date).AddSeconds(150)
    do {
        Start-Sleep -Seconds 3
        $h = (& docker inspect rfo-api-1 --format '{{.State.Health.Status}}' 2>$null) -join ''
        Write-Host "  api health: $h"
    } while ($h -ne 'healthy' -and (Get-Date) -lt $deadline)
    if ($h -ne 'healthy') { throw 'api unhealthy - paste docker compose logs api --tail 30 (last 12 lines)' }
    Write-Host '  ok      api healthy' -ForegroundColor Green
} finally { Pop-Location }

$st = Join-Path $ProjectRoot 'docs\state.md'
$s2 = [IO.File]::ReadAllText($st)
if ($s2 -notmatch 'Phase 4a ') {
    $s2 = $s2.TrimEnd() + "`nPhase 4a COMPLETE: ORM models + audit service + staff ops APIs (lots, scan-in, grade, transitions, moves, lists) + 0005 lot_number_seq.`n"
    [IO.File]::WriteAllText($st, ($s2 -replace "`r`n", "`n"), $Utf8NoBom)
}

Write-Host "`nDONE. Next:" -ForegroundColor Yellow
Write-Host '  1) docker compose run --rm migrate alembic upgrade head'
Write-Host '  2) docker compose run --rm migrate alembic current   # gate: 0005_lot_number_seq (head)'
Write-Host '  3) .\scripts\Test-Phase4.ps1'
Write-Host '  4) if green: git add -A ; git commit -m "feat(api): phase 4a - warehouse spine"'
