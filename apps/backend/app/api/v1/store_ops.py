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
from app.models import Asset, Lot
from app.models.catalog import Product
from app.models.identity import User
from app.models.orders import Order, OrderLine, OrderTaxLine, Payment, Reservation
from app.services import ledger
from app.services import payments as payments_svc
from app.services import system_settings as ss
from app.services.audit import audit
from app.services.margin import is_loss_maker
from app.services.orders import return_lines, settle_lines

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


def _margin_409(asset_id: int, sale_price_cents: int | None, cost_cents: int | None,
                settlement_cents: int | None = None) -> None:
    """Refuse the storefront half of the margin guard.

    The shop already hides a loss-maker (see store_catalog), so this is the belt to that brace: a
    crafted POST that names the id directly must not buy a unit the shop would not display. Same
    rule, same cost basis (services/margin), as the shop's own floor.
    """
    if is_loss_maker(sale_price_cents, cost_cents, settlement_cents):
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
    row = (await db.execute(text("SELECT a.id, a.status, a.sale_price_cents, a.cost_cents, a.settlement_cents FROM assets a JOIN lots l ON l.id = a.lot_id WHERE a.id = :i AND l.status = 'active' FOR UPDATE OF a SKIP LOCKED"),
                            {"i": body.asset_id})).first()
    if row is None:
        raise HTTPException(status_code=409, detail="unit not available (locked, sold, or lot not active)")
    if row.status != "listed":
        raise HTTPException(status_code=409, detail=f"unit not available (status {row.status})")
    _margin_409(row.id, row.sale_price_cents, row.cost_cents, row.settlement_cents)
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
        row = (await db.execute(text("SELECT a.id, a.status, a.sale_price_cents, a.cost_cents, a.settlement_cents FROM assets a JOIN lots l ON l.id = a.lot_id WHERE a.id = :i AND l.status = 'active' FOR UPDATE OF a SKIP LOCKED"),
                                {"i": aid})).first()
        if row is None:
            raise HTTPException(status_code=409, detail=f"unit {aid} unavailable (locked, sold, or lot not active)")
        if row.status != "listed":
            raise HTTPException(status_code=409, detail=f"unit {aid} not purchasable (status {row.status})")
        if row.sale_price_cents is None:
            raise HTTPException(status_code=409, detail=f"unit {aid} has no sale price")
        _margin_409(aid, row.sale_price_cents, row.cost_cents, row.settlement_cents)
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


async def _order_lines(db, order_id: int) -> list:
    return (await db.execute(select(OrderLine).where(OrderLine.order_id == order_id))).scalars().all()


@router.post("/orders/{public_id}/pay")
async def pay(public_id: str, db=Depends(get_db)):
    """Ask the configured provider for something to send the shopper to.

    The provider is chosen by `PAYMENT_PROVIDER`; its credential comes from the Settings API key
    store. The `stub` provider needs no credential and keeps its old behaviour exactly - the
    reference it returns is what the test webhook signs against. A real provider with no key stored
    is a 503, not a pretend charge: `create_checkout` is the only network path in the payment code
    and it must be visibly absent rather than silently failing.
    """
    o = (await db.execute(
        text("SELECT id, public_id::text AS public_id, status, total_cents, currency"
             " FROM orders WHERE public_id = :p"), {"p": public_id})).mappings().first()
    if o is None:
        raise HTTPException(status_code=404, detail="order not found")
    if o["status"] != "pending":
        raise HTTPException(status_code=409, detail=f"order status {o['status']}")
    s = get_settings()
    provider = s.PAYMENT_PROVIDER
    if provider not in payments_svc.PROVIDERS:
        raise HTTPException(status_code=503, detail=f"payment provider {provider!r} is not supported")
    return_url = s.cors_origins[0] if s.cors_origins else "https://shop.rfo.localhost"
    try:
        session = await payments_svc.create_checkout(provider=provider, order=dict(o),
                                                     secret=await payments_svc.api_key(db, provider),
                                                     return_url=return_url)
    except LookupError as e:
        raise HTTPException(status_code=503, detail=str(e))
    ref = session["provider_ref"]
    payment = Payment(order_id=o["id"], provider=provider, provider_ref=ref,
                      idempotency_key=uuidlib.uuid4().hex + "-" + str(o["id"]),
                      amount_cents=o["total_cents"], status="initiated")
    db.add(payment)
    await audit(db, "system", entity="payment", action="initiated",
                entity_id=o["id"], after={"ref": ref, "provider": provider})
    try:
        await db.commit()
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)
    return {"payment_ref": ref, "provider": provider, "redirect_url": session.get("redirect_url"),
            "webhook_url": f"/store/webhooks/payments/{provider}"}


@router.post("/webhooks/payments/{provider}")
async def payment_webhook(provider: str, request: Request, db=Depends(get_db)):
    """A provider event. Signature first, then the event log, then the lifecycle.

    The order of those three matters and is the design. VERIFY against the provider secret; RECORD
    the event under `UNIQUE (provider, event_id)` and stop if it is a redelivery, so a duplicated
    delivery cannot reach the lifecycle twice; only then move the order. The old handler inferred
    "already handled" from the payment row status, which cannot tell a repeated `succeeded` apart
    from a `succeeded` followed by a `refunded`.
    """
    s = get_settings()
    if provider not in payments_svc.PROVIDERS:
        raise HTTPException(status_code=404, detail="unknown payment provider")
    raw = await request.body()
    try:
        payments_svc.verify(provider, raw, request.headers,
                            await payments_svc.signing_secret(db, provider, s.PAYMENT_WEBHOOK_SECRET))
        event = payments_svc.parse(provider, raw)
    except payments_svc.WebhookRejected as e:
        raise HTTPException(status_code=401, detail=str(e))

    p = (await db.execute(
        text("SELECT id, status, order_id, amount_cents, refunded_cents FROM payments"
             " WHERE provider_ref = :r AND provider = :pv"),
        {"r": event["provider_ref"], "pv": provider})).mappings().first()
    if p is None:
        raise HTTPException(status_code=404, detail="payment not found")
    order_id = p["order_id"]
    if not await payments_svc.record_event(db, provider=provider, event=event,
                                           payment_id=p["id"], order_id=order_id):
        return {"status": "already processed"}      # a redelivery of an event already handled

    order = await db.get(Order, order_id)
    payment = await db.get(Payment, p["id"])
    lines = await _order_lines(db, order_id)
    now = datetime.now(timezone.utc)

    if event["type"] == payments_svc.EV_SUCCEEDED:
        if payment.status == "succeeded":
            await db.commit()                       # keep the event row; change nothing else
            return {"status": "already processed"}
        payment.status = "succeeded"
        order.status = "paid"
        order.paid_at = now
        await settle_lines(db, order_id, lines)
        # The invoice is issued in the SAME transaction as the sale it documents.
        await ledger.ensure_invoice(db, order_id)
        await audit(db, "system", entity="order", entity_id=order.id, action="payment_succeeded")

    elif event["type"] == payments_svc.EV_FAILED:
        if payment.status in ("succeeded", "failed", "refunded"):
            await db.commit()
            return {"status": "already processed"}
        payment.status = "failed"
        reason = str((event["payload"] or {}).get("failure_reason") or "").strip()
        payment.failure_reason = reason[:400] or None
        order.status = "cancelled"
        order.cancelled_at = now
        await return_lines(db, order_id, lines, reason="order_cancelled")
        await audit(db, "system", entity="order", entity_id=order.id, action="payment_failed")

    elif event["type"] == payments_svc.EV_REFUNDED:
        outstanding = int(p["amount_cents"]) - int(p["refunded_cents"])
        if outstanding <= 0:
            await db.commit()
            return {"status": "already processed"}
        # The provider figure when it sent one, else the whole outstanding balance - and never more
        # than the payment holds, which `payments_refunded_check` backstops.
        amount = event.get("amount_cents")
        payment.refunded_cents = int(p["refunded_cents"]) + (int(amount) if amount else outstanding)
        if payment.refunded_cents >= int(p["amount_cents"]):
            payment.refunded_cents = int(p["amount_cents"])
            payment.status = "refunded"
        order.status = "refunded"
        await return_lines(db, order_id, lines, reason="order_refunded")
        await audit(db, "system", entity="order", entity_id=order.id, action="payment_refunded",
                    after={"refunded_cents": payment.refunded_cents})

    else:
        # A recorded-but-inert event: a provider type this app does not act on. It stays in the log
        # so "we saw it and it meant nothing to us" is answerable later.
        await audit(db, "system", entity="payment", entity_id=p["id"], action="payment_event_ignored",
                    after={"type": (event["payload"] or {}).get("type") or provider})

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
    o = (await db.execute(text("SELECT id, status FROM orders WHERE public_id = :p"),
                          {"p": public_id})).mappings().first()
    if o is None:
        raise HTTPException(status_code=404, detail="order not found")
    if o["status"] != "pending":
        raise HTTPException(status_code=409, detail=f"order status {o['status']}")
    p = (await db.execute(text("SELECT id FROM payments WHERE order_id = :i ORDER BY id DESC LIMIT 1"),
                          {"i": o["id"]})).mappings().first()
    if p is None:
        raise HTTPException(status_code=409, detail="no payment initiated")
    payment = await db.get(Payment, p["id"])
    order = await db.get(Order, o["id"])
    payment.status = "succeeded"
    order.status = "paid"
    order.paid_at = datetime.now(timezone.utc)
    # The same two calls the webhook makes, so the dev shortcut and the real path cannot diverge.
    await settle_lines(db, o["id"], await _order_lines(db, o["id"]))
    await ledger.ensure_invoice(db, o["id"])
    await audit(db, "system", entity="order", entity_id=o["id"], action="payment_succeeded",
                meta={"simulated": True})
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
