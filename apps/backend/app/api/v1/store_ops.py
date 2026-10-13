import hashlib
import hmac
import re
import uuid as uuidlib
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError

from app.core import security
from app.core.config import get_settings
from app.core.db import get_db
from app.models import Asset, Lot, StockMovement
from app.models.catalog import Product
from app.models.identity import User
from app.models.orders import Order, OrderLine, OrderTaxLine, Payment, Reservation
from app.services import system_settings as ss
from app.services.audit import audit
from app.services.margin import is_loss_maker

router = APIRouter(prefix="/store", tags=["store-ops"])

# same shape as store.py's register validator - kept local so the two public
# routers stay independently readable.
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


# The GST rates used to be a literal here (``TAX = {"AU": ..., "NZ": ...}``). They now live in the
# settings store, so an operator can change them without a deploy, and the checkout is what reads
# them. `system_settings.get_tax_rate` is total - it falls back to the shipped AU 10% / NZ 15% on a
# missing row or a database error - so the pricing path can never fail because a settings read did.
# The rate that prices an order is ALSO the rate written to its tax line (see `checkout`), which is
# what keeps the total and the setting one fact instead of two that can drift apart.
def _tax_cents(subtotal: int, rate_bp: int) -> int:
    return (subtotal * rate_bp + 5000) // 10000   # half-up to the cent


def _margin_409(asset_id: int, sale_price_cents: int | None, cost_cents: int | None) -> None:
    """Refuse the storefront half of the margin guard.

    The shop already hides a loss-maker (see store_catalog), so this is the belt to that brace: a
    crafted POST that names the id directly must not buy a unit the shop would not display.
    """
    if is_loss_maker(sale_price_cents, cost_cents):
        raise HTTPException(status_code=409,
                            detail=f"unit {asset_id} is priced below its cost and is not for sale")


def _409(e: Exception) -> None:
    orig = getattr(e, "orig", None)
    msg = str(orig).replace("\n", " ")[:200] if orig is not None else str(e)[:200]
    raise HTTPException(status_code=409, detail=msg)


async def _opt_customer(request: Request, db=Depends(get_db)) -> dict | None:
    auth = request.headers.get("authorization") or ""
    if not auth.lower().startswith("bearer "):
        return None
    try:
        p = security.decode_access(auth[7:].strip(), "customer")
    except Exception:
        raise HTTPException(status_code=401, detail="invalid token")
    row = (await db.execute(text("SELECT id, public_id::text, status FROM users WHERE public_id = :p"),
                            {"p": p["sub"]})).mappings().first()
    if row is None or row["status"] != "active":
        raise HTTPException(status_code=401, detail="account unavailable")
    return {"id": row["id"], "public_id": row["public_id"]}


class ReserveIn(BaseModel):
    asset_id: int
    hold_minutes: int = Field(default=15, ge=1, le=60)


@router.post("/reservations", status_code=201)
async def reserve(body: ReserveIn, db=Depends(get_db)):
    row = (await db.execute(text("SELECT a.id, a.status, a.sale_price_cents, a.cost_cents FROM assets a JOIN lots l ON l.id = a.lot_id WHERE a.id = :i AND l.status = 'active' FOR UPDATE OF a SKIP LOCKED"),
                            {"i": body.asset_id})).first()
    if row is None:
        raise HTTPException(status_code=409, detail="unit not available (locked, sold, or lot not active)")
    if row.status != "listed":
        raise HTTPException(status_code=409, detail=f"unit not available (status {row.status})")
    _margin_409(row.id, row.sale_price_cents, row.cost_cents)
    a = await db.get(Asset, row.id)
    exp = datetime.now(timezone.utc) + timedelta(minutes=body.hold_minutes)
    r = Reservation(asset_id=row.id, status="active", expires_at=exp)
    db.add(r)
    a.status = "reserved"
    await audit(db, "system", entity="asset", entity_id=row.id, action="reserve", after={"hold": body.hold_minutes})
    try:
        await db.commit()
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)
    return {"reservation_id": r.id, "asset_id": row.id, "expires_at": exp.isoformat()}


@router.post("/reservations/{rid}/release")
async def release(rid: int, db=Depends(get_db)):
    r = await db.get(Reservation, rid)
    if r is None:
        raise HTTPException(status_code=404, detail="reservation not found")
    if r.status != "active":
        raise HTTPException(status_code=409, detail=f"reservation status {r.status}")
    a = await db.get(Asset, r.asset_id)
    r.status = "released"
    a.status = "listed"
    await audit(db, "system", entity="asset", entity_id=r.asset_id, action="reserve_release")
    try:
        await db.commit()
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)
    return {"reservation_id": r.id, "asset_status": a.status}


class CheckoutIn(BaseModel):
    asset_ids: list[int] = Field(min_length=1, max_length=10)
    shipping_country: str = Field(pattern="^(AU|NZ)$")
    ship_to_name: str = Field(default="", max_length=120)
    ship_line1: str = Field(default="", max_length=200)
    ship_city: str = Field(default="", max_length=80)
    ship_state: str = Field(default="", max_length=40)
    ship_postcode: str = Field(default="", max_length=12)


@router.post("/checkout")
async def checkout(body: CheckoutIn, customer: dict | None = Depends(_opt_customer), db=Depends(get_db)):
    ids = sorted(set(body.asset_ids))
    if len(ids) != len(body.asset_ids):
        raise HTTPException(status_code=422, detail="duplicate asset ids")
    sub = 0
    locked = []
    for aid in ids:
        row = (await db.execute(text("SELECT a.id, a.status, a.sale_price_cents, a.cost_cents FROM assets a JOIN lots l ON l.id = a.lot_id WHERE a.id = :i AND l.status = 'active' FOR UPDATE OF a SKIP LOCKED"),
                                {"i": aid})).first()
        if row is None:
            raise HTTPException(status_code=409, detail=f"unit {aid} unavailable (locked, sold, or lot not active)")
        if row.status != "listed":
            raise HTTPException(status_code=409, detail=f"unit {aid} not purchasable (status {row.status})")
        if row.sale_price_cents is None:
            raise HTTPException(status_code=409, detail=f"unit {aid} has no sale price")
        _margin_409(aid, row.sale_price_cents, row.cost_cents)
        sub += row.sale_price_cents
        locked.append(await db.get(Asset, aid))
    country = body.shipping_country
    # The rate in force, from the settings store. It prices the order AND is written to the tax line
    # below, so the total and the setting are one number rather than two.
    jurisdiction, rate_bp = await ss.get_tax_rate(db, country)
    tax = _tax_cents(sub, rate_bp)
    order = Order(currency="AUD", status="pending", subtotal_cents=sub, tax_cents=tax,
                  shipping_cents=0, total_cents=sub + tax, shipping_country=country,
                  ship_to_name=body.ship_to_name, ship_line1=body.ship_line1,
                  ship_city=body.ship_city, ship_state=body.ship_state,
                  ship_postcode=body.ship_postcode,
                  customer_id=customer["id"] if customer else None)
    db.add(order)
    await db.flush()
    for a in locked:
        a.status = "reserved"
        prod = await db.get(Product, a.product_id) if a.product_id else None
        title = prod.title if prod is not None else (a.serial_number or str(a.id))
        db.add(OrderLine(order_id=order.id, asset_id=a.id, product_id=a.product_id, qty=1,
                         sku_title=title, unit_price_cents=a.sale_price_cents,
                         line_total_cents=a.sale_price_cents))
        db.add(Reservation(asset_id=a.id, status="active",
                           expires_at=datetime.now(timezone.utc) + timedelta(minutes=15)))
    db.add(OrderTaxLine(order_id=order.id, jurisdiction=jurisdiction,
                        rate_bp=rate_bp, amount_cents=tax))
    await audit(db, "system", entity="order", entity_id=order.id, action="checkout",
                after={"total_cents": sub + tax, "country": country, "units": len(locked),
                       "tax_rate_bp": rate_bp})
    try:
        await db.commit()
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)
    return {"order_public_id": str(order.public_id), "subtotal_cents": sub,
            "tax_cents": tax, "total_cents": sub + tax, "status": order.status}


@router.post("/orders/{public_id}/pay")
async def pay(public_id: str, db=Depends(get_db)):
    o = (await db.execute(text("SELECT id, status, total_cents FROM orders WHERE public_id = :p"),
                          {"p": public_id})).mappings().first()
    if o is None:
        raise HTTPException(status_code=404, detail="order not found")
    if o["status"] != "pending":
        raise HTTPException(status_code=409, detail=f"order status {o['status']}")
    s = get_settings()
    ref = "stub-" + uuidlib.uuid4().hex
    pay = Payment(order_id=o["id"], provider=s.PAYMENT_PROVIDER, provider_ref=ref,
                  idempotency_key=uuidlib.uuid4().hex + "-" + str(o["id"]),
                  amount_cents=o["total_cents"], status="initiated")
    db.add(pay)
    await audit(db, "system", entity="payment", action="initiated",
                entity_id=o["id"], after={"ref": ref})
    try:
        await db.commit()
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)
    return {"payment_ref": ref, "provider": s.PAYMENT_PROVIDER,
            "webhook_url": f"/store/webhooks/payments/{s.PAYMENT_PROVIDER}"}


class WebhookIn(BaseModel):
    ref: str
    event: str = Field(pattern="^payment\\.(succeeded|failed)$")


@router.post("/webhooks/payments/{provider}")
async def payment_webhook(provider: str, body: WebhookIn, request: Request, db=Depends(get_db)):
    s = get_settings()
    if s.PAYMENT_WEBHOOK_SECRET:
        raw = (await request.body()).decode()
        sig = request.headers.get("x-stub-signature", "")
        expect = hmac.new(s.PAYMENT_WEBHOOK_SECRET.encode(), raw.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expect):
            raise HTTPException(status_code=401, detail="bad webhook signature")
    p = (await db.execute(text("SELECT id, status, order_id FROM payments WHERE provider_ref = :r AND provider = :pv"),
                          {"r": body.ref, "pv": provider})).mappings().first()
    if p is None:
        raise HTTPException(status_code=404, detail="payment not found")
    pay = await db.get(Payment, p["id"])
    order = await db.get(Order, p["order_id"])
    lines = (await db.execute(select(OrderLine).where(OrderLine.order_id == p["order_id"]))).scalars().all()

    if body.event == "payment.succeeded":
        if pay.status == "succeeded":
            return {"status": "already processed"}     # idempotent replay: no double side effects
        pay.status = "succeeded"
        order.status = "paid"
        for l in lines:
            if l.asset_id is None:
                continue
            a = await db.get(Asset, l.asset_id)
            if a is not None and a.status == "reserved":
                a.status = "sold"
            db.add(StockMovement(asset_id=l.asset_id, qty=-1, reason="sale"))
            await db.execute(text("UPDATE reservations SET status='converted' WHERE asset_id = :i AND status='active'"),
                             {"i": l.asset_id})
        await audit(db, "system", entity="order", entity_id=order.id, action="payment_succeeded")
        try:
            await db.commit()
        except SQLAlchemyError as e:
            await db.rollback(); _409(e)
        return {"status": "processed", "order": order.status}

    if pay.status in ("succeeded", "failed"):
        return {"status": "already processed"}
    pay.status = "failed"
    order.status = "cancelled"
    for l in lines:
        if l.asset_id is None:
            continue
        a = await db.get(Asset, l.asset_id)
        if a is not None and a.status == "reserved":
            a.status = "listed"        # back to storefront
        await db.execute(text("UPDATE reservations SET status='released' WHERE asset_id = :i AND status='active'"),
                         {"i": l.asset_id})
    await audit(db, "system", entity="order", entity_id=order.id, action="payment_failed")
    try:
        await db.commit()
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)
    return {"status": "processed", "order": order.status}
@router.post("/orders/{public_id}/simulate-payment")
async def simulate_payment(public_id: str, db=Depends(get_db)):
    # DEV ONLY: pretends the provider fired the webhook. Returns 404 in production env.
    if get_settings().is_prod:
        raise HTTPException(status_code=404, detail="not found")
    o = (await db.execute(text("SELECT id, status FROM orders WHERE public_id = :p"), {"p": public_id})).mappings().first()
    if o is None:
        raise HTTPException(status_code=404, detail="order not found")
    if o["status"] != "pending":
        raise HTTPException(status_code=409, detail=f"order status {o['status']}")
    p = (await db.execute(text("SELECT id FROM payments WHERE order_id = :i ORDER BY id DESC LIMIT 1"),
                          {"i": o["id"]})).mappings().first()
    if p is None:
        raise HTTPException(status_code=409, detail="no payment initiated")
    pay = await db.get(Payment, p["id"])
    order = await db.get(Order, o["id"])
    pay.status = "succeeded"
    order.status = "paid"
    lines = (await db.execute(select(OrderLine).where(OrderLine.order_id == o["id"]))).scalars().all()
    for l in lines:
        if l.asset_id is None:
            continue
        a = await db.get(Asset, l.asset_id)
        if a is not None and a.status == "reserved":
            a.status = "sold"
        db.add(StockMovement(asset_id=l.asset_id, qty=-1, reason="sale"))
        await db.execute(text("UPDATE reservations SET status='converted' WHERE asset_id = :i AND status='active'"), {"i": l.asset_id})
    await audit(db, "system", entity="order", entity_id=o["id"], action="payment_succeeded", meta={"simulated": True})
    try:
        await db.commit()
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)
    return {"status": "paid", "order": order.status}


class NewsletterIn(BaseModel):
    email: str = Field(min_length=5, max_length=254)


@router.post("/newsletter/subscribe")
async def newsletter_subscribe(body: NewsletterIn, db=Depends(get_db)):
    email = body.email.strip().lower()
    if not _EMAIL.match(email):
        raise HTTPException(status_code=422, detail="invalid email")
    # Idempotent by design: the UNIQUE(email) constraint absorbs a repeat signup via
    # ON CONFLICT DO NOTHING, so a duplicate is a plain success - same status, same body
    # as a first-time signup. The response never reveals whether the address was new
    # (that would turn this into a "is this person subscribed" oracle) and never 500s.
    await db.execute(text("INSERT INTO newsletter_subscribers (email) VALUES (:e) ON CONFLICT (email) DO NOTHING"),
                     {"e": email})
    await db.commit()
    return {"status": "subscribed"}
