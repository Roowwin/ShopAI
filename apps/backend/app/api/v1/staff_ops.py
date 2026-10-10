from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import selectinload

from app.api.v1.deps import require_roles
from app.core.db import get_db
from app.models import Asset, Lot, StockMovement
from app.models.catalog import Product
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
    try:
        await db.flush()
        db.add(StockMovement(asset_id=asset.id, qty=1, reason="intake_scan", actor_staff_id=staff["id"]))
        await audit(db, "staff", entity="asset", entity_id=asset.id, action="scan_in",
                    actor_id=staff["id"], after={"serial": body.serial_number, "lot": lot.lot_number})
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
class PriceIn(BaseModel):
    sale_price_cents: int = Field(ge=0)


@router.post("/assets/{asset_id}/price")
async def set_price(asset_id: int, body: PriceIn, staff: dict = Depends(require_roles("admin", "manager", "sales")), db=Depends(get_db)):
    asset = await db.get(Asset, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="asset not found")
    before = {"sale_price_cents": asset.sale_price_cents}
    asset.sale_price_cents = body.sale_price_cents
    await audit(db, "staff", entity="asset", entity_id=asset.id, action="price",
                actor_id=staff["id"], before=before, after={"sale_price_cents": body.sale_price_cents})
    try:
        await db.commit()
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)
    return {"id": asset.id, "sale_price_cents": asset.sale_price_cents}
class ProductListingIn(BaseModel):
    title: str = Field(max_length=140)
    description: str = Field(max_length=4000)


@router.post("/products/{product_id}/listing")
async def approve_listing(product_id: int, body: ProductListingIn,
                          staff: dict = Depends(require_roles("admin", "manager", "sales")),
                          db=Depends(get_db)):
    prod = await db.get(Product, product_id)
    if prod is None:
        raise HTTPException(status_code=404, detail="product not found")
    before = {"title": prod.title, "description": prod.description}
    prod.title = body.title
    prod.description = body.description
    await audit(db, "staff", entity="product", entity_id=prod.id, action="listing_approved",
                actor_id=staff["id"], before=before, after={"title": body.title})
    try:
        await db.commit()
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)
    return {"id": prod.id, "title": prod.title, "description": prod.description}


# ------------- CMS: website content / offers / featured products -------------
import json
from datetime import datetime, timedelta, timezone

HOME_DEFAULTS = {"hero_title": "Renewed tech. Zero waste.",
                 "hero_sub": "Certified refurbished devices - serialised, graded, warehouse-tracked.",
                 "cta_label": "Shop devices"}


@router.get("/cms/home")
async def cms_get_home(staff: dict = Depends(require_roles("admin", "manager")), db=Depends(get_db)):
    row = (await db.execute(text("SELECT value FROM site_settings WHERE key = 'home'"))).first()
    out = dict(HOME_DEFAULTS)
    if row is not None:
        out.update(row[0])
    return out


@router.put("/cms/home")
async def cms_put_home(body: dict, staff: dict = Depends(require_roles("admin", "manager")), db=Depends(get_db)):
    val = {"hero_title": str(body.get("hero_title") or HOME_DEFAULTS["hero_title"])[:120],
           "hero_sub": str(body.get("hero_sub") or HOME_DEFAULTS["hero_sub"])[:240],
           "cta_label": str(body.get("cta_label") or HOME_DEFAULTS["cta_label"])[:40]}
    await db.execute(text("INSERT INTO site_settings (key, value) VALUES ('home', CAST(:v AS jsonb)) ON CONFLICT (key) DO UPDATE SET value = CAST(:v AS jsonb), updated_at = now()"), {"v": json.dumps(val)})
    await db.commit()
    await audit(db, "staff", entity="cms", action="home_updated", actor_id=staff["id"], after=val)
    await db.commit()
    return val


@router.get("/cms/promotions")
async def cms_list_promotions(staff: dict = Depends(require_roles("admin", "manager")), db=Depends(get_db)):
    rows = (await db.execute(text("SELECT id, name, kind, value, active, starts_at, ends_at FROM promotions ORDER BY id DESC"))).mappings().all()
    return [{"id": r["id"], "name": r["name"], "kind": r["kind"], "value": int(r["value"] or 0),
             "active": bool(r["active"]), "starts_at": r["starts_at"].isoformat(), "ends_at": r["ends_at"].isoformat()} for r in rows]


@router.post("/cms/promotions")
async def cms_add_promotion(body: dict, staff: dict = Depends(require_roles("admin", "manager")), db=Depends(get_db)):
    name = str(body.get("name") or "New offer")[:80]
    kind = body.get("kind") or "percent"
    if kind not in ("percent", "fixed"):
        raise HTTPException(status_code=422, detail="kind must be percent or fixed")
    value = int(body.get("value") or 0)
    if value <= 0 or (kind == "percent" and value > 90):
        raise HTTPException(status_code=422, detail="value out of range")
    row = (await db.execute(text("INSERT INTO promotions (name, kind, value, active, starts_at, ends_at) VALUES (:n, :k, :v, true, now(), now() + INTERVAL '30 days') RETURNING id"), {"n": name, "k": kind, "v": value})).first()
    await db.commit()
    await audit(db, "staff", entity="promotion", action="created", entity_id=row[0], actor_id=staff["id"], after={"name": name})
    await db.commit()
    return {"id": row[0], "name": name, "kind": kind, "value": value, "active": True}


@router.patch("/cms/promotions/{pid}")
async def cms_edit_promotion(pid: int, body: dict, staff: dict = Depends(require_roles("admin", "manager")), db=Depends(get_db)):
    changed = {}
    for k in ("name", "kind", "value", "active"):
        if k in body:
            changed[k] = body[k]
            if k == "name":
                await db.execute(text("UPDATE promotions SET name = :v WHERE id = :i"), {"v": str(body[k])[:80], "i": pid})
            elif k == "kind":
                if str(body[k]) not in ("percent", "fixed"):
                    raise HTTPException(status_code=422, detail="bad kind")
                await db.execute(text("UPDATE promotions SET kind = :v WHERE id = :i"), {"v": str(body[k]), "i": pid})
            elif k == "value":
                await db.execute(text("UPDATE promotions SET value = :v WHERE id = :i"), {"v": int(body[k]), "i": pid})
            else:
                await db.execute(text("UPDATE promotions SET active = :v WHERE id = :i"), {"v": bool(body[k]), "i": pid})
    await db.commit()
    await audit(db, "staff", entity="promotion", action="edited", entity_id=pid, actor_id=staff["id"], after=changed)
    await db.commit()
    return {"ok": True, "changed": changed}


@router.get("/cms/products")
async def cms_list_products(staff: dict = Depends(require_roles("admin", "manager")), db=Depends(get_db)):
    rows = (await db.execute(text("""
        SELECT p.id, p.title, p.slug, p.image_url, p.featured, c.name AS category,
               count(a.id) FILTER (WHERE a.status = 'listed') AS units
        FROM products p JOIN categories c ON c.id = p.category_id
        LEFT JOIN assets a ON a.product_id = p.id
        GROUP BY p.id, p.title, p.slug, p.image_url, p.featured, c.name
        ORDER BY p.featured DESC, p.title"""))).mappings().all()
    return [{"id": r["id"], "title": r["title"], "slug": r["slug"], "category": r["category"],
             "image_url": r["image_url"], "featured": bool(r["featured"]), "listed_units": int(r["units"])} for r in rows]


@router.patch("/cms/products/{pid}")
async def cms_edit_product(pid: int, body: dict, staff: dict = Depends(require_roles("admin", "manager")), db=Depends(get_db)):
    upd = []
    params: dict = {"i": pid}
    if "image_url" in body:
        img = str(body["image_url"]).strip()
        upd.append("image_url = :img")
        params["img"] = (img or None)
    if "featured" in body:
        upd.append("featured = :feat")
        params["feat"] = bool(body["featured"])
    if "title" in body:
        upd.append("title = :t")
        params["t"] = str(body["title"])[:140]
    if "description" in body:
        upd.append("description = :d")
        params["d"] = str(body["description"])[:4000]
    if not upd:
        raise HTTPException(status_code=422, detail="nothing to update")
    await db.execute(text("UPDATE products SET " + ", ".join(upd) + ", updated_at = now() WHERE id = :i"), params)
    await db.commit()
    await audit(db, "staff", entity="cms", action="product_updated", entity_id=pid, actor_id=staff["id"], after={k: str(body[k])[:60] for k in body})
    await db.commit()
    return {"ok": True}