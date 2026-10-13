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

FULFILMENT BELONGS TO THE LOGISTICS RAIL, AND THIS MODULE ONLY REFUSES TO TAKE IT. `shipped` and
`delivered` are in `FULFILMENT_ELSEWHERE` below, which names the rail's own door in the 409, and
`GET /{id}/label` - which printed the parcel label from the `orders.carrier` mirror - has been
DELETED rather than moved, because the rail answers it from the `shipments` row and two answers to
one question is what this module was consolidated out of. Everything fulfilment-shaped lives at
`/staff/logistics/*`; what remains here is the money and lifecycle half of an order.
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
    "cancelled": ("pending", "paid"),
    "refunded": ("paid", "shipped", "delivered"),
}
# target status -> who may perform it
_TARGET_ROLES: dict[str, tuple[str, ...]] = {
    "paid": ("admin",),
    "cancelled": ("admin", "manager"),
    "refunded": ("admin",),
}
# FULFILMENT IS NOT THIS DOOR. Shipping and delivering belong to the logistics rail
# (`/staff/logistics/orders/{id}/ship`, `/staff/logistics/shipments/{id}/deliver`), which records the
# parcel AND walks each sold unit to `shipped`. A second path here would stamp the order row and
# leave the units behind, so the order would say shipped while its stock still said sold - two
# accounts of one fact, which is the defect this codebase keeps warning about. The refusal NAMES the
# door that does own it, so an operator is pointed somewhere rather than left guessing.
FULFILMENT_ELSEWHERE: dict[str, str] = {
    "shipped": "POST /staff/logistics/orders/{id}/ship",
    "delivered": "POST /staff/logistics/shipments/{id}/deliver",
}
_STATUSES = tuple(_TRANSITIONS)
READ_ROLES = ("admin", "manager")
# Action names for the audit rows and the in-body guard. NOT in GUARDED_ACTIONS - the chat rail does
# not dispatch order fulfilment, so db=None below keeps the agent-grant branch unreachable.
# `LABEL_ROLES` and `ACTION_ORDER_LABEL` were here for the label door and went with it: the tuple that
# may print what goes on a parcel is the rail's `ROLES_SHIP` now, and two tuples naming the same three
# roles is how they drift apart.
ACTION_ORDER_STATUS = "order_status"
ACTION_ORDER_REFUND = "order_refund"


class OrderStatusIn(BaseModel):
    status: str = Field(description="one of: " + ", ".join(_STATUSES))
    # Recorded when an operator books an offline payment by hand; ignored for the other targets.
    note: str | None = Field(default=None, max_length=400)


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
    if target in FULFILMENT_ELSEWHERE:
        raise HTTPException(status_code=409,
                            detail=f"{target} is recorded by the logistics rail: "
                                   + FULFILMENT_ELSEWHERE[target])
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
    after = {"state": target, "note": body.note, "invoice": invoice["number"] if invoice else None}
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
# `GET /{order_id}/label` USED TO LIVE HERE and is deliberately gone. It printed a shipping label by
# reading `orders.carrier` / `orders.tracking_number` - the denormalised mirror of the parcel - which
# made a second answer to a question the logistics rail already owned, and read the copy rather than
# the source. The door is now `GET /staff/logistics/orders/{id}/label`, with the same contract and
# the same refusals, reading the `shipments` row. Nothing in the backoffice called this path.
#
# The `carrier` / `tracking_number` / `shipped_at` columns stay on the payloads above and below: they
# are the rail's mirror, this module only READS them, and removing them from the read shape would be
# a different change with its own callers to migrate.
