"""The order lifecycle: pending -> paid -> shipped -> delivered, and the two ways out.

WHY THIS FILE EXISTS. `orders.status` has carried six states since 0001 and only two were ever
written: the payment webhook moved pending -> paid on success and pending -> cancelled on failure.
Nothing could mark an order shipped, nothing could deliver it, nothing could cancel one that had
already been paid, and nothing could refund one. A shop whose orders stop at "paid" has taken money
and never records that the goods left the building - which is also the half of the lifecycle that
`stock_movements` cannot see, because the -1 already happened at the sale.

THE TRANSITION MAP IS THE AUTHORITY. One table below says what may follow what, and a move it does
not name is a 409 naming the current status rather than a silent write. The states the schema
already allows but no one should reach (a delivered order going back to shipped) are simply absent.

WHO MAY DO WHAT. Fulfilment is admin/manager/warehouse; cancelling is admin/manager; and the two
MONEY moves - recording an offline payment and refunding one - are admin alone, because both change
what the ledger says the business earned. The role tuples are constants used by both the decorator
and the in-body guard, and none of these action names is in `staff_ops.GUARDED_ACTIONS`, so an agent
identity is refused by the shared guard rather than admitted through a grant.

EVERY MOVE WRITES A TIMESTAMP AND AN AUDIT ROW. `orders.updated_at` is moved by the touch trigger
on any edit and so cannot answer "when did this ship"; the explicit columns can. The audit row is
the before/after pair, which is the only thing that can answer "who cancelled this" later.

THE LABEL IS A READ OF A DISPATCHED ORDER, NOT A SECOND WAY TO DISPATCH ONE. `GET /{id}/label`
produces the printable parcel label - destination, carrier, tracking barcode - and REFUSES an order
that has not shipped, because a label is a claim that the parcel exists. Issuing it is the same
`shipped` move above; the label only ever renders what that move recorded.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError

from app.api.v1.deps import require_roles
from app.api.v1.staff_ops import _409, _audit_execution, _require_role
from app.core.db import get_db
from app.models.orders import Order, OrderLine, Payment
from app.services import ledger
from app.services.orders import return_lines, settle_lines

router = APIRouter(prefix="/staff/orders", tags=["staff-orders"])

# target status -> the statuses it may be entered from
_TRANSITIONS: dict[str, tuple[str, ...]] = {
    "paid": ("pending",),
    "shipped": ("paid",),
    "delivered": ("shipped",),
    "cancelled": ("pending", "paid"),
    "refunded": ("paid", "shipped", "delivered"),
}
# target status -> who may perform it
_TARGET_ROLES: dict[str, tuple[str, ...]] = {
    "paid": ("admin",),
    "shipped": ("admin", "manager", "warehouse"),
    "delivered": ("admin", "manager", "warehouse"),
    "cancelled": ("admin", "manager"),
    "refunded": ("admin",),
}
_STATUSES = tuple(_TRANSITIONS)
READ_ROLES = ("admin", "manager")
# Fulfilment, so the three roles that may DISPATCH may also print what goes on the parcel.
LABEL_ROLES = ("admin", "manager", "warehouse")
# Action names for the audit rows and the in-body guard. NOT in GUARDED_ACTIONS - the chat rail does
# not dispatch order fulfilment, so db=None below keeps the agent-grant branch unreachable.
ACTION_ORDER_STATUS = "order_status"
ACTION_ORDER_REFUND = "order_refund"
ACTION_ORDER_LABEL = "order_label"


class OrderStatusIn(BaseModel):
    status: str = Field(description="one of: " + ", ".join(_STATUSES))
    # Recorded when an operator books an offline payment by hand; ignored for the other targets.
    note: str | None = Field(default=None, max_length=400)
    # Required for `shipped` - a dispatch with no tracking reference is not a dispatch.
    carrier: str | None = Field(default=None, max_length=80)
    tracking_number: str | None = Field(default=None, max_length=120)


def _iso(value) -> str | None:
    return value.isoformat() if value is not None else None


async def _order_lines(db, order_id: int) -> list:
    return (await db.execute(
        select(OrderLine).where(OrderLine.order_id == order_id))).scalars().all()


async def _order_row(db, order_id: int) -> dict | None:
    r = (await db.execute(text("""
        SELECT id, public_id::text AS public_id, status, subtotal_cents, tax_cents, shipping_cents,
               total_cents, currency, customer_id, placed_at, paid_at, shipped_at, delivered_at,
               cancelled_at, carrier, tracking_number
        FROM orders WHERE id = :i"""), {"i": order_id})).mappings().first()
    if r is None:
        return None
    return {"id": r["id"], "public_id": r["public_id"], "status": r["status"],
            "subtotal_cents": int(r["subtotal_cents"]), "tax_cents": int(r["tax_cents"]),
            "shipping_cents": int(r["shipping_cents"]), "total_cents": int(r["total_cents"]),
            "currency": r["currency"], "customer_id": r["customer_id"],
            "placed_at": _iso(r["placed_at"]), "paid_at": _iso(r["paid_at"]),
            "shipped_at": _iso(r["shipped_at"]), "delivered_at": _iso(r["delivered_at"]),
            "cancelled_at": _iso(r["cancelled_at"]), "carrier": r["carrier"],
            "tracking_number": r["tracking_number"]}


@router.post("/{order_id}/status")
async def set_order_status(order_id: int, body: OrderStatusIn,
                           staff: dict = Depends(require_roles("admin", "manager", "warehouse")),
                           db=Depends(get_db)):
    """Move one order along its lifecycle. See the module docstring for the map and the roles."""
    target = body.status.strip().lower()
    if target not in _TRANSITIONS:
        raise HTTPException(status_code=422, detail="status must be one of: " + ", ".join(_STATUSES))
    # The ROLE check is per-target, so it cannot be expressed by the route decorator alone - the
    # decorator admits the widest of the three sets and this narrows it. `_require_role` is called
    # with db=None: an agent identity is refused outright, as it is on every non-rail door.
    await _require_role(staff, _TARGET_ROLES[target],
                        ACTION_ORDER_REFUND if target == "refunded" else ACTION_ORDER_STATUS, None)

    order = await db.get(Order, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="order not found")
    if target not in _TRANSITIONS or order.status not in _TRANSITIONS[target]:
        raise HTTPException(status_code=409,
                            detail=f"an order cannot go from {order.status} to {target}")
    if target == "shipped" and not (body.tracking_number or "").strip():
        raise HTTPException(status_code=422, detail="shipping an order requires a tracking number")

    before = {"status": order.status}
    lines = await _order_lines(db, order_id)
    now = datetime.now(timezone.utc)
    invoice = None

    if target == "paid":
        # An offline payment (bank transfer, cash) booked by an operator. The units settle exactly
        # as they do when the webhook reports the same thing, and the invoice is issued in the same
        # transaction so a rollback leaves neither.
        await settle_lines(db, order_id, lines, actor_staff_id=staff["id"])
        order.paid_at = now
        invoice = await ledger.ensure_invoice(db, order_id)
    elif target == "shipped":
        order.shipped_at = now
        order.carrier = (body.carrier or "").strip() or None
        order.tracking_number = body.tracking_number.strip()
    elif target == "delivered":
        order.delivered_at = now
    elif target == "cancelled":
        await return_lines(db, order_id, lines, reason="order_cancelled",
                           actor_staff_id=staff["id"])
        order.cancelled_at = now
    elif target == "refunded":
        pay = (await db.execute(text(
            "SELECT id, amount_cents, refunded_cents, status FROM payments"
            " WHERE order_id = :i AND status = 'succeeded' ORDER BY id DESC LIMIT 1"),
            {"i": order_id})).mappings().first()
        if pay is None:
            raise HTTPException(status_code=409,
                                detail="there is no succeeded payment on this order to refund")
        outstanding = int(pay["amount_cents"]) - int(pay["refunded_cents"])
        if outstanding <= 0:
            raise HTTPException(status_code=409, detail="that payment is already fully refunded")
        # Full refund of the outstanding balance. A partial refund is a different document with a
        # different meaning for the order's status, so it is refused rather than half-supported.
        payment = await db.get(Payment, pay["id"])
        payment.refunded_cents = int(pay["amount_cents"])
        payment.status = "refunded"
        await return_lines(db, order_id, lines, reason="order_refunded",
                           actor_staff_id=staff["id"])

    order.status = target
    after = {"state": target, "note": body.note, "invoice": invoice["number"] if invoice else None,
             "tracking_number": body.tracking_number, "carrier": body.carrier}
    await _audit_execution(db, staff, None, entity="order", entity_id=order.id,
                           action="order_" + target, before=before, after=after)
    try:
        await db.commit()
    except SQLAlchemyError as e:
        await db.rollback(); _409(e)
    out = await _order_row(db, order_id)
    if invoice is not None:
        out["invoice"] = invoice
    return out


@router.get("/{order_id}/label")
async def shipping_label(order_id: int,
                         staff: dict = Depends(require_roles(*LABEL_ROLES)), db=Depends(get_db)):
    """The printable shipping label for a dispatched order.

    REFUSED UNTIL THE ORDER HAS SHIPPED. A label is a claim that a parcel exists, so an order that
    has not left is a 409 naming its current status rather than a document someone could print and
    stick on an empty box. `delivered` is admitted as well as `shipped` - reprinting a label for a
    parcel already on its way is an ordinary thing to need.

    The payload is what a label physically carries: where it goes, who carries it, and the tracking
    reference as the scannable barcode. `declared_value_cents` and the currency are there because a
    carrier form asks for them, and they are read from the order rather than recomputed, so a label
    and the invoice for the same sale cannot disagree.
    """
    await _require_role(staff, LABEL_ROLES, ACTION_ORDER_LABEL, None)
    r = (await db.execute(text("""
        SELECT public_id::text AS public_id, status, currency, total_cents,
               carrier, tracking_number, shipped_at,
               ship_to_name, ship_line1, ship_city, ship_state, ship_postcode, shipping_country
        FROM orders WHERE id = :i"""), {"i": order_id})).mappings().first()
    if r is None:
        raise HTTPException(status_code=404, detail="order not found")
    if r["status"] not in ("shipped", "delivered"):
        raise HTTPException(status_code=409,
                            detail=f"an order must be shipped before its label can be printed"
                                   f" (it is {r['status']})")
    return {"order_id": order_id, "order_public_id": r["public_id"], "status": r["status"],
            "carrier": r["carrier"], "tracking_number": r["tracking_number"],
            "barcode": r["tracking_number"], "dispatched_at": _iso(r["shipped_at"]),
            "currency": r["currency"], "declared_value_cents": int(r["total_cents"]),
            "ship_to": {"name": r["ship_to_name"], "line1": r["ship_line1"], "city": r["ship_city"],
                        "state": r["ship_state"], "postcode": r["ship_postcode"],
                        "country": r["shipping_country"]}}
