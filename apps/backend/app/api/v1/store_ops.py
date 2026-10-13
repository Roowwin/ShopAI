import re
import uuid as uuidlib
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError

from app.api.v1.deps import get_customer
from app.core import security
from app.core.config import get_settings
from app.core.db import get_db
from app.models import Asset, Lot, StockMovement
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


async def _cart_rows(db, ids: list[int], *, lock: bool) -> list[dict]:
    """The purchasable units behind a cart, priced and TITLED, with the shop's own checks applied.

    ONE implementation for the quote and the charge. The whole promise of showing a total before
    paying is that it is the total that then gets charged, and two copies of these checks would let
    the quote and the checkout disagree about which unit is buyable - the shopper would only find out
    from a 409 after pressing Pay.

    The title rides the same query as a LEFT JOIN rather than a `db.get(Product, ...)` per line, and
    the empty join falls back to the serial exactly as the checkout always did: the order line's
    `sku_title` has to say what was bought, and a unit with no product is identified by its serial.

    `lock=True` is the checkout's own read: `FOR UPDATE OF a SKIP LOCKED` is what stops two shoppers
    buying the same serialised unit, and a row another checkout holds comes back as None, which is
    the "unavailable" branch below. The QUOTE passes False on purpose - it promises nothing, and a
    row lock held across a page a shopper may simply abandon is a lock wasted.
    """
    rows = []
    for aid in ids:
        sql = ("SELECT a.id, a.status, a.grade, a.sale_price_cents, a.cost_cents,"
               " a.settlement_cents, a.serial_number, p.title"
               " FROM assets a JOIN lots l ON l.id = a.lot_id"
               " LEFT JOIN products p ON p.id = a.product_id"
               " WHERE a.id = :i AND l.status = 'active'")
        if lock:
            sql += " FOR UPDATE OF a SKIP LOCKED"
        row = (await db.execute(text(sql), {"i": aid})).first()
        if row is None:
            raise HTTPException(status_code=409, detail=f"unit {aid} unavailable (locked, sold, or lot not active)")
        if row.status != "listed":
            raise HTTPException(status_code=409, detail=f"unit {aid} not purchasable (status {row.status})")
        if row.sale_price_cents is None:
            raise HTTPException(status_code=409, detail=f"unit {aid} has no sale price")
        _margin_409(aid, row.sale_price_cents, row.cost_cents, row.settlement_cents)
        rows.append({"id": row.id,
                     "title": row.title if row.title is not None else (row.serial_number or str(row.id)),
                     "grade": row.grade, "sale_price_cents": int(row.sale_price_cents)})
    return rows


def _cart_ids(body_ids: list[int]) -> list[int]:
    """A cart's unit ids, de-duplicated, refusing a body that named one twice. Shared by the quote
    and the checkout so both answer a doubled cart the same way."""
    ids = sorted(set(body_ids))
    if len(ids) != len(body_ids):
        raise HTTPException(status_code=422, detail="duplicate asset ids")
    return ids


@router.post("/checkout/quote")
async def checkout_quote(body: CheckoutIn, db=Depends(get_db)):
    """What this cart costs, WITHOUT creating anything.

    The checkout screen has to show the shopper what they are about to pay - GST included, because
    the shop's prices are exclusive of it and a total that appears only after the charge is not a
    checkout. The tax rate comes from the same settings read the checkout uses, so the quote and the
    charge cannot disagree; the delivery fields are irrelevant here and are accepted only because the
    screen posts the same body either way.

    Writes nothing at all: no order, no reservation, no audit row. `_cart_rows(lock=False)` is the
    same read without the row locks.
    """
    ids = _cart_ids(body.asset_ids)
    rows = await _cart_rows(db, ids, lock=False)
    sub = sum(r["sale_price_cents"] for r in rows)
    jurisdiction, rate_bp = await ss.get_tax_rate(db, body.shipping_country)
    tax = _tax_cents(sub, rate_bp)
    return {"subtotal_cents": sub, "tax_cents": tax, "shipping_cents": 0,
            "total_cents": sub + tax, "currency": "AUD",
            "shipping_country": body.shipping_country, "jurisdiction": jurisdiction,
            "rate_bp": rate_bp,
            "lines": [{"asset_id": r["id"], "title": r["title"], "grade": r["grade"],
                       "sale_price_cents": int(r["sale_price_cents"])} for r in rows]}


@router.post("/checkout")
async def checkout(body: CheckoutIn, customer: dict | None = Depends(_opt_customer), db=Depends(get_db)):
    ids = _cart_ids(body.asset_ids)
    rows = await _cart_rows(db, ids, lock=True)
    sub = sum(r["sale_price_cents"] for r in rows)
    locked = [await db.get(Asset, r["id"]) for r in rows]
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
    for a, r in zip(locked, rows):
        a.status = "reserved"
        db.add(OrderLine(order_id=order.id, asset_id=a.id, product_id=a.product_id, qty=1,
                         sku_title=r["title"], unit_price_cents=r["sale_price_cents"],
                         line_total_cents=r["sale_price_cents"]))
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


# ---------------------------------------------------------------------------
# The customer's own orders: the read half of the purchase.
#
# The shop could take an order and never show it again. These two doors are that half - the list a
# signed-in customer sees, and one order addressed by its own id - and they are what the checkout
# confirmation screen and My Orders both read.
#
# WHY THE DETAIL IS PUBLIC BY ID. A cart can be checked out as a GUEST: `customer_id` is NULL for
# anyone who never signed in, which is most of this shop's traffic, so the person who just paid is
# very often not identifiable, and a confirmation page demanding a session would be a page most
# buyers could not open. `public_id` is a v4 UUID - 122 random bits - addressed exactly the way
# `/orders/{id}/pay` and `/orders/{id}/simulate-payment` already are, and it is the only credential
# the link carries. That is enough for "here is your order"; it is NOT enough for the delivery
# address, which is why the address is masked below.
# ---------------------------------------------------------------------------

ORDER_DETAIL_SQL = """
SELECT o.id, o.public_id::text AS public_id, o.customer_id, o.status, o.currency,
       o.subtotal_cents, o.tax_cents, o.shipping_cents, o.total_cents, o.shipping_country,
       o.ship_to_name, o.ship_line1, o.ship_line2, o.ship_city, o.ship_state, o.ship_postcode,
       o.placed_at,
       (SELECT p.status FROM payments p WHERE p.order_id = o.id ORDER BY p.id DESC LIMIT 1)
           AS payment_status,
       (SELECT t.jurisdiction FROM order_tax_lines t WHERE t.order_id = o.id ORDER BY t.id LIMIT 1)
           AS tax_jurisdiction,
       (SELECT t.rate_bp FROM order_tax_lines t WHERE t.order_id = o.id ORDER BY t.id LIMIT 1)
           AS tax_rate_bp,
       -- The parcel (0018_logistics). One per order, so a plain LEFT JOIN is the whole story of
       -- "has this been dispatched"; the columns are null until the fulfil door writes a row.
       sh.id AS shipment_id, sh.carrier, sh.service, sh.tracking_ref,
       sh.dispatched_at, sh.promised_at, sh.delivered_at
FROM orders o LEFT JOIN shipments sh ON sh.order_id = o.id
WHERE o.public_id = :p
"""


def _shipment_payload(row) -> dict | None:
    """The parcel as the buyer may see it, or None when nothing has been dispatched yet."""
    if row["shipment_id"] is None:
        return None
    return {"carrier": row["carrier"], "service": row["service"],
            "tracking_ref": row["tracking_ref"],
            "dispatched_at": (row["dispatched_at"].isoformat() if row["dispatched_at"] else None),
            "promised_at": (row["promised_at"].isoformat() if row["promised_at"] else None),
            "delivered_at": (row["delivered_at"].isoformat() if row["delivered_at"] else None)}


def _order_id_or_404(public_id: str) -> str:
    """The id as the database will be asked for it, or a 404.

    `orders.public_id` is a UUID and the path segment is free text, so a mistyped or truncated link
    is an ordinary thing for this endpoint to be handed. Without this it reaches asyncpg as an
    unparseable uuid and comes back a 500 - the wrong answer twice over, because a bad URL is not a
    server fault and the shopper cannot tell the difference.
    """
    try:
        return str(uuidlib.UUID(public_id))
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(status_code=404, detail="order not found")


def _ship_to_for(row, customer: dict | None) -> dict:
    """The delivery address AS THIS CALLER MAY SEE IT.

    Full for the order's own customer; otherwise the DESTINATION only (city, state, postcode,
    country) with no name and no street lines. The order link is a UUID, and a UUID leaks the way
    links leak - a screenshot, a forwarded email, a browser history on a shared machine. Whoever
    holds one may read the order's status and its totals; what they may not read is where a stranger
    lives. The buyer loses nothing by this: they typed the address a moment ago, and My Orders -
    which IS behind a session - shows it in full.
    """
    full = (customer is not None and row["customer_id"] is not None
            and customer["id"] == row["customer_id"])
    out = {"city": row["ship_city"], "state": row["ship_state"], "postcode": row["ship_postcode"],
           "country": row["shipping_country"], "full": full}
    if full:
        out.update({"name": row["ship_to_name"], "line1": row["ship_line1"],
                    "line2": row["ship_line2"]})
    return out


@router.get("/orders")
async def my_orders(limit: int = Query(50, le=100), offset: int = 0,
                    customer: dict = Depends(get_customer), db=Depends(get_db)):
    """The signed-in customer's own orders, newest first.

    Scoped by `customer_id` in the WHERE and nowhere else, so the list cannot show a stranger's
    order whatever the caller sends: the identity comes from the bearer token, never from the query.

    `first_title` is the model on the order's first line, so a row reads as the thing that was bought
    rather than as a UUID - and it is the first line BY ID rather than `min()` over the titles, since
    a title-sorted "first" would name whichever product sorts first alphabetically, which is not the
    order the shopper built.
    """
    rows = (await db.execute(text("""
        SELECT o.public_id::text AS public_id, o.status, o.currency, o.total_cents, o.placed_at,
               count(ol.id) AS item_count,
               (array_agg(ol.sku_title ORDER BY ol.id))[1] AS first_title
        FROM orders o LEFT JOIN order_lines ol ON ol.order_id = o.id
        WHERE o.customer_id = :c
        GROUP BY o.id, o.public_id, o.status, o.currency, o.total_cents, o.placed_at
        ORDER BY o.placed_at DESC, o.id DESC
        LIMIT :lim OFFSET :off
    """), {"c": customer["id"], "lim": limit, "off": offset})).mappings().all()
    return [{"public_id": r["public_id"], "status": r["status"], "currency": r["currency"],
             "total_cents": int(r["total_cents"]), "placed_at": r["placed_at"].isoformat(),
             "item_count": int(r["item_count"]), "first_title": r["first_title"]}
            for r in rows]


@router.get("/orders/{public_id}")
async def order_detail(public_id: str,
                       customer: dict | None = Depends(_opt_customer), db=Depends(get_db)):
    """One order, by its own unguessable id - the confirmation screen and the order page both read it.

    `paid` is DERIVED from the order's status rather than read off the payment row, because the order
    is what the shop's own state machine moves (the webhook writes `paid`) and a refund or a failure
    would otherwise leave a confirmation screen still claiming the money arrived.
    """
    pid = _order_id_or_404(public_id)
    row = (await db.execute(text(ORDER_DETAIL_SQL), {"p": pid})).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="order not found")
    lines = (await db.execute(text("""
        SELECT ol.id, ol.asset_id, ol.qty, ol.sku_title, ol.unit_price_cents, ol.line_total_cents,
               a.grade, right(a.serial_number::text, 4) AS serial_tail
        FROM order_lines ol LEFT JOIN assets a ON a.id = ol.asset_id
        WHERE ol.order_id = :o ORDER BY ol.id
    """), {"o": row["id"]})).mappings().all()
    return {
        "public_id": row["public_id"], "status": row["status"], "currency": row["currency"],
        "placed_at": row["placed_at"].isoformat(),
        "subtotal_cents": int(row["subtotal_cents"]), "tax_cents": int(row["tax_cents"]),
        "shipping_cents": int(row["shipping_cents"]), "total_cents": int(row["total_cents"]),
        "tax": {"jurisdiction": row["tax_jurisdiction"],
                "rate_bp": (int(row["tax_rate_bp"]) if row["tax_rate_bp"] is not None else None)},
        "paid": row["status"] in ("paid", "shipped", "delivered"),
        "payment_status": row["payment_status"],
        "ship_to": _ship_to_for(row, customer),
        "shipment": _shipment_payload(row),
        "lines": [{"title": ln["sku_title"], "qty": int(ln["qty"]), "grade": ln["grade"],
                   "serial_tail": ln["serial_tail"],
                   "unit_price_cents": int(ln["unit_price_cents"]),
                   "line_total_cents": int(ln["line_total_cents"])} for ln in lines],
    }


# ---------------------------------------------------------------------------
# THE PUBLIC TRACKING PAGE'S READ.
#
# "Anyone with a tracking number can see their order status" - and the operative word is ANYONE.
# A carrier's reference is a short, guessable, often sequential-looking string, nowhere near the
# 122 random bits of an order's UUID, so this door answers with the parcel's MOVEMENT and nothing
# else. It does not return the order, the items, the amounts or the destination: a tracking
# reference is not a credential, and the page it serves is meant to be safe to paste into a chat.
#
# AMBIGUITY IS REFUSED, NOT GUESSED. `shipments.tracking_ref` carries no uniqueness (0018 leaves that
# alone on purpose - two carriers may issue the same number), so a reference matching more than one
# parcel answers 409 and NAMES the carriers rather than picking the newest and showing a stranger's
# delivery. A caller who knows which carrier can disambiguate.
# ---------------------------------------------------------------------------

TRACKING_MAX_REF = 64


@router.get("/track/{ref}")
async def track_parcel(ref: str, carrier: str | None = Query(None, max_length=60),
                       db=Depends(get_db)):
    """Where a parcel has got to, addressed by its carrier's reference."""
    wanted = (ref or "").strip()
    if not wanted or len(wanted) > TRACKING_MAX_REF:
        raise HTTPException(status_code=422,
                            detail=f"a tracking reference must be 1..{TRACKING_MAX_REF} characters")

    # Compared case-insensitively and trimmed on both sides: a reference is read off a label and
    # typed the way the label prints it, and carriers do not agree on case. The carrier clause is
    # BRANCHED IN PYTHON rather than written as `(:carrier IS NULL OR ...)`, because a bare
    # parameter in a text() statement has no type for Postgres to infer and asyncpg refuses the
    # statement before it ever runs.
    where = "upper(btrim(sh.tracking_ref)) = :r"
    params: dict = {"r": wanted.upper()}
    if carrier and carrier.strip():
        where += " AND lower(sh.carrier) = lower(:c)"
        params["c"] = carrier.strip()

    rows = (await db.execute(text("""
        SELECT sh.carrier, sh.service, sh.tracking_ref, sh.dispatched_at, sh.promised_at,
               sh.delivered_at, o.status AS order_status
        FROM shipments sh JOIN orders o ON o.id = sh.order_id
        WHERE """ + where + """
        ORDER BY sh.dispatched_at DESC, sh.id DESC
        LIMIT 5
    """), params)).mappings().all()
    if not rows:
        raise HTTPException(status_code=404, detail="no parcel matches that tracking reference")
    if len(rows) > 1:
        raise HTTPException(status_code=409, detail=(
            "that reference matches more than one parcel - say which carrier with ?carrier=: "
            + ", ".join(sorted({r["carrier"] for r in rows}))))
    row = rows[0]
    return {"tracking_ref": row["tracking_ref"], "carrier": row["carrier"],
            "service": row["service"], "order_status": row["order_status"],
            "status": "delivered" if row["delivered_at"] is not None else "in_transit",
            "dispatched_at": row["dispatched_at"].isoformat(),
            "promised_at": (row["promised_at"].isoformat() if row["promised_at"] else None),
            "delivered_at": (row["delivered_at"].isoformat() if row["delivered_at"] else None)}
