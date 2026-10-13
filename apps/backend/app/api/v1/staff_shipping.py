"""Fulfilment: the queue of paid orders waiting to go out, and the label for one of them.

WHAT THIS MODULE IS FOR, AND WHAT IT DELIBERATELY IS NOT. The parcel itself - which carrier took
it, what it cost, when it was promised - belongs to `api/v1/staff_logistics.py`, which owns the
`shipments` table (0018) and the write that records one. This module owns the two things that had no
home: the QUEUE an operator works from, and the CARRIER CALL that produces a label. "Mark shipped"
stays over there; this returns the tracking reference for the operator to carry into it.

WHY THE RECIPIENT ADDRESS IS HERE AT ALL. `staff_views.get_order` omits `orders.ship_to_*` on
purpose, with the note "a shipping address is PII the screen has no use for". A label and a packing
slip are exactly the use it was waiting for, so the address is returned here and nowhere else - these
routes are gated to the warehouse roles that pack the parcel, and the queue is bounded so a single
request cannot enumerate the whole customer base's addresses at once.

AN UNCONFIGURED CARRIER IS A 409, NOT A CRASH AND NOT A FAKE. `services/carriers.py` refuses rather
than inventing a tracking number, and this router passes that refusal through with the list of what
to configure. The one refusal that is about the ORDER rather than the setup - shipping something
that is not paid - is audited, because that is an act against a real order; a configuration gap is
not, because it is not about an order at all and would otherwise fill the trail with one operator's
setup mistakes.

THE LABEL DOES NOT WRITE ANYTHING TO `shipments`. Booking a label and recording a parcel are two
decisions: the first can be repeated (a label can be spoiled at the printer), the second cannot (one
parcel per order is a UNIQUE index over there). Keeping them apart is what lets an operator reprint
without the second press, and it is why this endpoint is safe to call before the box is sealed.
"""

import base64
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.api.v1.deps import require_roles
from app.core.db import get_db
from app.services import carriers
from app.services.audit import audit

router = APIRouter(prefix="/staff/shipping", tags=["staff-shipping"])

# The roles that pack and post, matching `staff_logistics.ROLES_SHIP` - one set of people does both
# halves of this job, and a role list that disagreed between the two modules would be a bug report
# waiting for the first operator who could do one and not the other.
ROLES_SHIPPING = ("admin", "manager", "warehouse")

DEFAULT_PAGE = 25
MAX_PAGE = 100


def _require_role(staff: dict, roles: tuple[str, ...]) -> None:
    """In-body twin of the route's dependency: `staff_ai.chat` dispatches into routers as plain
    function calls, where a `Depends` never evaluates. Same refusal, byte for byte."""
    if staff.get("role") not in roles:
        raise HTTPException(status_code=403, detail="insufficient role")


def _iso(value) -> str | None:
    return value.isoformat() if isinstance(value, datetime) else (str(value) if value else None)


def _recipient(row) -> dict:
    """The address block, in one place, so the queue, the detail and the label all read it the same
    way. A NULL column is an empty string rather than absent: a packing slip wants the blank line,
    and `carriers.book_label` checks the postcode for itself."""
    return {
        "name": row["ship_to_name"] or "",
        "line1": row["ship_line1"] or "",
        "line2": row["ship_line2"] or "",
        "city": row["ship_city"] or "",
        "state": row["ship_state"] or "",
        "postcode": row["ship_postcode"] or "",
        "country": row["shipping_country"] or "AU",
    }


# `status = 'paid'` AND no shipment row is the whole definition of "waiting to go out", and it is the
# same condition the sibling's `overdue` alert narrows further with a clock. `shipments.order_id` is
# UNIQUE, so the LEFT JOIN cannot multiply a row.
_QUEUE_WHERE = """
    o.status = 'paid'
    AND NOT EXISTS (SELECT 1 FROM shipments s WHERE s.order_id = o.id)
"""

_ORDER_COLUMNS = """
    o.id, o.public_id::text AS public_id, o.status, o.currency, o.subtotal_cents, o.tax_cents,
    o.shipping_cents, o.total_cents, o.placed_at, o.customer_id,
    o.ship_to_name, o.ship_line1, o.ship_line2, o.ship_city, o.ship_state, o.ship_postcode,
    o.shipping_country
"""


async def _lines(db, order_ids: list[int]) -> dict[int, list[dict]]:
    """Every line for every order on this page, in ONE query keyed by order - the alternative is a
    query per order, which is the N+1 this endpoint would otherwise be."""
    if not order_ids:
        return {}
    rows = (await db.execute(text("""
        SELECT ol.order_id, ol.asset_id, ol.sku_title, ol.unit_price_cents, ol.line_total_cents,
               a.grade, right(a.serial_number::text, 4) AS serial_tail
        FROM order_lines ol LEFT JOIN assets a ON a.id = ol.asset_id
        WHERE ol.order_id = ANY(:ids) ORDER BY ol.order_id, ol.id
    """), {"ids": order_ids})).mappings().all()
    out: dict[int, list[dict]] = {i: [] for i in order_ids}
    for r in rows:
        out[r["order_id"]].append({
            "asset_id": r["asset_id"], "sku_title": r["sku_title"],
            "unit_price_cents": int(r["unit_price_cents"]),
            "line_total_cents": int(r["line_total_cents"]),
            "grade": r["grade"], "serial_tail": r["serial_tail"],
        })
    return out


async def _customer_email(db, customer_id: int | None) -> str | None:
    if customer_id is None:
        return None
    return (await db.execute(text("SELECT email::text AS email FROM users WHERE id = :i"),
                             {"i": customer_id})).scalar()


async def _shipment(db, order_id: int) -> dict | None:
    """The parcel already recorded for this order, if any. Read-only: writing one is the sibling's."""
    row = (await db.execute(text("""
        SELECT id, public_id::text AS public_id, carrier, service, tracking_ref, cost_cents,
               dispatched_at, promised_at, delivered_at
        FROM shipments WHERE order_id = :i
    """), {"i": order_id})).mappings().first()
    if row is None:
        return None
    return {
        "shipment_id": int(row["id"]), "public_id": row["public_id"], "carrier": row["carrier"],
        "service": row["service"], "tracking_ref": row["tracking_ref"],
        "cost_cents": int(row["cost_cents"]), "dispatched_at": _iso(row["dispatched_at"]),
        "promised_at": _iso(row["promised_at"]), "delivered_at": _iso(row["delivered_at"]),
    }


@router.get("/queue")
async def fulfilment_queue(limit: int = Query(DEFAULT_PAGE, ge=1, le=MAX_PAGE),
                           offset: int = Query(0, ge=0),
                           staff: dict = Depends(require_roles(*ROLES_SHIPPING)),
                           db=Depends(get_db)):
    """Paid orders with no parcel yet, oldest first - the worklist, and the packing-slip source.

    Oldest first because this is a queue and not a browse: the order that has been waiting longest is
    the one that is closest to breaking the dispatch promise, and a screen that opened on the newest
    would hide exactly the orders that need attention.
    """
    _require_role(staff, ROLES_SHIPPING)
    total = (await db.execute(text(
        f"SELECT count(*) FROM orders o WHERE {_QUEUE_WHERE}"))).scalar_one()
    rows = (await db.execute(text(f"""
        SELECT {_ORDER_COLUMNS} FROM orders o
        WHERE {_QUEUE_WHERE}
        ORDER BY o.placed_at ASC, o.id ASC
        LIMIT :lim OFFSET :off
    """), {"lim": limit, "off": offset})).mappings().all()
    by_order = await _lines(db, [r["id"] for r in rows])
    return {
        "total": int(total),
        "limit": limit,
        "offset": offset,
        "orders": [{
            "id": r["id"], "public_id": r["public_id"], "status": r["status"],
            "currency": r["currency"], "total_cents": int(r["total_cents"]),
            "subtotal_cents": int(r["subtotal_cents"]), "tax_cents": int(r["tax_cents"]),
            "shipping_cents": int(r["shipping_cents"]),
            "placed_at": _iso(r["placed_at"]),
            "customer_email": await _customer_email(db, r["customer_id"]),
            "recipient": _recipient(r),
            "lines": by_order.get(r["id"], []),
        } for r in rows],
    }


@router.get("/orders/{order_id}")
async def fulfilment_order(order_id: int, staff: dict = Depends(require_roles(*ROLES_SHIPPING)),
                           db=Depends(get_db)):
    """One order as a fulfilment document: what to pack, where it goes, and how it is being sent."""
    _require_role(staff, ROLES_SHIPPING)
    r = (await db.execute(text(f"SELECT {_ORDER_COLUMNS} FROM orders o WHERE o.id = :i"),
                          {"i": order_id})).mappings().first()
    if r is None:
        raise HTTPException(status_code=404, detail="order not found")
    lines = (await _lines(db, [order_id])).get(order_id, [])
    return {
        "order": {
            "id": r["id"], "public_id": r["public_id"], "status": r["status"],
            "currency": r["currency"], "total_cents": int(r["total_cents"]),
            "subtotal_cents": int(r["subtotal_cents"]), "tax_cents": int(r["tax_cents"]),
            "shipping_cents": int(r["shipping_cents"]),
            "placed_at": _iso(r["placed_at"]),
            "customer_email": await _customer_email(db, r["customer_id"]),
        },
        "recipient": _recipient(r),
        "lines": lines,
        "shipment": await _shipment(db, order_id),
    }


@router.get("/carriers")
async def list_carriers(staff: dict = Depends(require_roles(*ROLES_SHIPPING)), db=Depends(get_db)):
    """Which carriers can actually be used, and what is missing from the ones that cannot.

    Readable by the same roles that ship, deliberately: the person who cannot get a label is the
    person who needs to know why, and routing this to an administrator would leave the operator with
    a button that does nothing.
    """
    _require_role(staff, ROLES_SHIPPING)
    return {"carriers": await carriers.available(db)}


class LabelIn(BaseModel):
    """What the operator knows at the bench. Every field has a default because a label does not need
    dimensions to be valid - a carrier rates on weight, and a missing dimension is a smaller number,
    not a refusal."""

    carrier: str = Field(default="auspost", max_length=40)
    service: str | None = Field(default=None, max_length=60)
    weight_grams: int = Field(default=0, ge=0, le=100_000)
    length_cm: int = Field(default=0, ge=0, le=300)
    width_cm: int = Field(default=0, ge=0, le=300)
    height_cm: int = Field(default=0, ge=0, le=300)


@router.post("/orders/{order_id}/label")
async def book_label(order_id: int, body: LabelIn,
                     staff: dict = Depends(require_roles(*ROLES_SHIPPING)), db=Depends(get_db)):
    """Book a real label with the carrier and hand back its document and tracking reference.

    The bytes come back base64 in the JSON body rather than as a redirect to a carrier URL: the label
    is a document this platform paid for, and a URL that only works while the carrier's session lives
    is not something an operator can reprint from tomorrow.
    """
    _require_role(staff, ROLES_SHIPPING)
    r = (await db.execute(text("""
        SELECT id, status, public_id::text AS public_id, ship_to_name, ship_line1, ship_line2,
               ship_city, ship_state, ship_postcode, shipping_country
        FROM orders WHERE id = :i
    """), {"i": order_id})).mappings().first()
    if r is None:
        raise HTTPException(status_code=404, detail="order not found")
    if r["status"] != "paid":
        # An act against a real order, so it is recorded: a label booked for an order that was
        # refunded or cancelled is exactly the kind of thing someone will ask about later.
        await audit(db, "staff", entity="order", entity_id=order_id, action="label_refused",
                    actor_id=staff["id"], meta={"reason": "not paid", "status": r["status"]})
        await db.commit()
        raise HTTPException(status_code=409,
                            detail=f"only a paid order can be labelled - order #{order_id} is {r['status']}")

    lines = (await _lines(db, [order_id])).get(order_id, [])
    recipient = _recipient(r)
    parcel = {
        "service": body.service, "weight_grams": body.weight_grams, "length_cm": body.length_cm,
        "width_cm": body.width_cm, "height_cm": body.height_cm,
    }
    try:
        label = await carriers.book_label(db, body.carrier,
                                          order={"id": order_id, "public_id": r["public_id"], "lines": lines},
                                          recipient=recipient, parcel=parcel)
    except carriers.CarrierError as e:
        # 409, not 500: the request was understood and the platform is not broken - the carrier is
        # simply not usable yet, and the message says what to configure.
        raise HTTPException(status_code=409, detail=str(e))

    await audit(db, "staff", entity="order", entity_id=order_id, action="label_booked",
                actor_id=staff["id"],
                after={"carrier": label.carrier, "service": label.service,
                       "tracking_ref": label.tracking_ref, "bytes": len(label.label_bytes),
                       "note": label.note})
    await db.commit()
    return {
        "order_id": order_id,
        "carrier": label.carrier,
        "service": label.service,
        "tracking_ref": label.tracking_ref,
        "label_format": label.label_format,
        "label_base64": base64.b64encode(label.label_bytes).decode("ascii"),
        "bytes": len(label.label_bytes),
        "note": label.note,
    }
