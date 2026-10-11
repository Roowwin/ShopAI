import re

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import selectinload

from app.api.v1.deps import require_roles
from app.core.db import get_db
from app.models import Asset, Lot, StockMovement
from app.models.catalog import Product
from app.services.audit import audit

router = APIRouter(prefix="/staff", tags=["staff-ops"])

# ---------------------------------------------------------------------------
# Role tuples: ONE source of truth for "which role may do X".
#
# The chat door (`staff_ai.py`) dispatches into the functions below as PLAIN FUNCTION CALLS, so
# the routes' `Depends(require_roles(...))` never evaluates on that path. Two consequences, both
# closed here and in the sibling file:
#   * `staff_ai.TOOL_ROLES` derives from these same constants instead of carrying its own
#     literals, so the chat allow-list cannot drift from the door it dispatches into.
#   * each handler re-checks its tuple in-body via `_require_role`, so the guard holds however
#     the function is invoked (the route's `Depends` stays as well - belt and braces, and it
#     preserves the 403 for the HTTP door).
# For these seven routes the IN-BODY guard is the authoritative one: `Depends` is the weaker twin,
# so editing only the route decorator is a dead edit (the body check runs regardless). Change both,
# from the one constant - do not "fix" the wrong one.
# Keep every set otherwise unchanged: these values ARE live authorization.
# ---------------------------------------------------------------------------
ROLES_CREATE_LOT = ("admin", "manager", "warehouse")
ROLES_ACTIVATE_LOT = ("admin", "manager")
ROLES_SCAN_IN = ("admin", "manager", "warehouse", "technician")
ROLES_GRADE = ("admin", "manager", "technician")
ROLES_MOVE = ("admin", "manager", "warehouse")
ROLES_PRICE = ("admin", "manager", "sales")
# The door behind the chat `test` (received->tested) and `list` (graded->listed) transitions.
# One tuple for both transitions, aligned DOWN to this endpoint's stricter set - the chat
# allow-list no longer grants `test` to technicians or `list` to sales.
ROLES_SET_STATUS = ("admin", "manager", "warehouse")


def _require_role(staff: dict, roles: tuple[str, ...]) -> None:
    """In-body twin of the route's ``Depends(require_roles(*roles))``.

    `staff_ai.chat` calls these handlers as plain functions, which skips every FastAPI
    dependency. Same status and detail as `deps.require_roles`, so both doors refuse alike.
    """
    if staff["role"] not in roles:
        raise HTTPException(status_code=403, detail="insufficient role")


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
async def create_lot(body: LotIn, staff: dict = Depends(require_roles(*ROLES_CREATE_LOT)), db=Depends(get_db)):
    _require_role(staff, ROLES_CREATE_LOT)
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
async def activate_lot(lot_id: int, staff: dict = Depends(require_roles(*ROLES_ACTIVATE_LOT)), db=Depends(get_db)):
    _require_role(staff, ROLES_ACTIVATE_LOT)
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
async def scan_in(body: ScanIn, staff: dict = Depends(require_roles(*ROLES_SCAN_IN)), db=Depends(get_db)):
    _require_role(staff, ROLES_SCAN_IN)
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
async def grade(asset_id: int, body: GradeIn, staff: dict = Depends(require_roles(*ROLES_GRADE)), db=Depends(get_db)):
    _require_role(staff, ROLES_GRADE)
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
async def set_status(asset_id: int, body: StatusIn, staff: dict = Depends(require_roles(*ROLES_SET_STATUS)), db=Depends(get_db)):
    _require_role(staff, ROLES_SET_STATUS)
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
async def move(asset_id: int, body: MoveIn, staff: dict = Depends(require_roles(*ROLES_MOVE)), db=Depends(get_db)):
    _require_role(staff, ROLES_MOVE)
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


# Read walls: lot numbers, serials, grades and storage locations are inventory intelligence, so
# these reads take the same guard as the sibling staff reads (the CMS and newsletter ones) instead
# of being open to everyone. Before job 8 a customer bearer - or no credential at all - answered
# 200 with the inventory.
@router.get("/lots")
async def list_lots(limit: int = Query(20, le=100), offset: int = 0,
                    staff: dict = Depends(require_roles("admin", "manager")), db=Depends(get_db)):
    rows = (await db.execute(select(Lot).options(selectinload(Lot.assets))
                             .order_by(Lot.id.desc()).limit(limit).offset(offset))).scalars().all()
    return [{"id": l.id, "lot_number": l.lot_number, "status": l.status,
             "warehouse": l.warehouse, "asset_count": len(l.assets)} for l in rows]


@router.get("/assets")
async def list_assets(status: str | None = None, lot_number: str | None = None,
                      product_id: int | None = None, limit: int = Query(20, le=100), offset: int = 0,
                      staff: dict = Depends(require_roles("admin", "manager")), db=Depends(get_db)):
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
async def list_movements(asset_id: int | None = None, limit: int = Query(50, le=200), offset: int = 0,
                         staff: dict = Depends(require_roles("admin", "manager")), db=Depends(get_db)):
    q = select(StockMovement).order_by(StockMovement.id.desc()).limit(limit).offset(offset)
    if asset_id:
        q = q.where(StockMovement.asset_id == asset_id)
    rows = (await db.execute(q)).scalars().all()
    return [{"id": m.id, "moved_at": m.moved_at.isoformat(), "asset_id": m.asset_id,
             "qty": m.qty, "reason": m.reason, "actor_staff_id": m.actor_staff_id} for m in rows]
class PriceIn(BaseModel):
    sale_price_cents: int = Field(ge=0)


@router.post("/assets/{asset_id}/price")
async def set_price(asset_id: int, body: PriceIn, staff: dict = Depends(require_roles(*ROLES_PRICE)), db=Depends(get_db)):
    _require_role(staff, ROLES_PRICE)
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

DEAL_BADGE = "Deal of the Month"


def _clean_deal_of_month(raw):
    """Normalise the CMS deal_of_month record; None when unset/blank (block off)."""
    if not isinstance(raw, dict):
        return None
    slug = str(raw.get("product_slug") or "").strip()
    if not slug:
        return None
    return {"title": str(raw.get("title") or "").strip()[:140],
            "product_slug": slug[:140],
            "badge": str(raw.get("badge") or "").strip()[:40] or DEAL_BADGE}


@router.get("/cms/home")
async def cms_get_home(staff: dict = Depends(require_roles("admin", "manager")), db=Depends(get_db)):
    row = (await db.execute(text("SELECT value FROM site_settings WHERE key = 'home'"))).first()
    out = dict(HOME_DEFAULTS)
    if row is not None:
        out.update(row[0])
    if _clean_deal_of_month(out.get("deal_of_month")) is None:
        out.pop("deal_of_month", None)
    return out


@router.put("/cms/home")
async def cms_put_home(body: dict, staff: dict = Depends(require_roles("admin", "manager")), db=Depends(get_db)):
    val = {"hero_title": str(body.get("hero_title") or HOME_DEFAULTS["hero_title"])[:120],
           "hero_sub": str(body.get("hero_sub") or HOME_DEFAULTS["hero_sub"])[:240],
           "cta_label": str(body.get("cta_label") or HOME_DEFAULTS["cta_label"])[:40]}
    deal = _clean_deal_of_month(body.get("deal_of_month"))
    if deal is not None:
        val["deal_of_month"] = deal
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


# ------------- Newsletter: public signups, admin read-only list -------------
@router.get("/newsletter")
async def newsletter_list(limit: int = Query(100, le=500), offset: int = 0,
                          staff: dict = Depends(require_roles("admin", "manager")), db=Depends(get_db)):
    total = (await db.execute(text("SELECT count(*) FROM newsletter_subscribers"))).scalar_one()
    rows = (await db.execute(text("""
        SELECT email, created_at FROM newsletter_subscribers
        ORDER BY created_at DESC, id DESC LIMIT :lim OFFSET :off
    """), {"lim": limit, "off": offset})).mappings().all()
    return {"total": int(total),
            "subscribers": [{"email": r["email"], "created_at": r["created_at"].isoformat()} for r in rows]}


# ------------- Catalog: create a product (used by the demo seeder) -------------
def _slugify(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")[:160]


class ProductIn(BaseModel):
    brand_slug: str = Field(min_length=1, max_length=80)
    category_slug: str = Field(min_length=1, max_length=80)
    model: str = Field(min_length=1, max_length=140)
    title: str = Field(min_length=1, max_length=160)
    slug: str | None = Field(default=None, max_length=160)
    description: str = Field(default="", max_length=4000)
    specs: dict = Field(default_factory=dict)


def _product_json(row) -> dict:
    return {"id": row["id"], "public_id": row["public_id"], "brand_id": row["brand_id"],
            "category_id": row["category_id"], "model": row["model"], "title": row["title"],
            "slug": row["slug"], "description": row["description"], "specs": row["specs"],
            "status": row["status"], "created_at": row["created_at"].isoformat()}


@router.post("/products", status_code=201)
async def create_product(body: ProductIn, staff: dict = Depends(require_roles("admin", "manager")), db=Depends(get_db)):
    brand_id = (await db.execute(text("SELECT id FROM brands WHERE slug = :s"),
                                {"s": body.brand_slug})).scalar_one_or_none()
    if brand_id is None:
        raise HTTPException(status_code=422, detail="unknown brand slug")
    category_id = (await db.execute(text("SELECT id FROM categories WHERE slug = :s"),
                                    {"s": body.category_slug})).scalar_one_or_none()
    if category_id is None:
        raise HTTPException(status_code=422, detail="unknown category slug")
    slug = (body.slug or "").strip() or _slugify(body.title)
    if not slug:
        raise HTTPException(status_code=422, detail="slug required (not derivable from title)")
    try:
        # status 'active': a product only reaches the storefront once it has listed stock in an
        # active lot (the catalog query requires it), so going live here cannot publish an
        # empty product - it just lets the intake flow that follows surface it.
        row = (await db.execute(text("""
            INSERT INTO products (brand_id, category_id, model, title, slug, description, specs, status)
            VALUES (:b, :c, :m, :t, :s, :d, CAST(:sp AS jsonb), 'active')
            RETURNING id, public_id::text AS public_id, brand_id, category_id, model, title, slug,
                      description, specs, status, created_at
        """), {"b": brand_id, "c": category_id, "m": body.model, "t": body.title, "s": slug,
               "d": body.description, "sp": json.dumps(body.specs)})).mappings().one()
        await audit(db, "staff", entity="product", entity_id=row["id"], action="product_create",
                    actor_id=staff["id"], after={"slug": slug, "title": body.title})
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="slug already exists")
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)
    return _product_json(row)