"""Logistics: shipping an order, hearing what needs attention, and settling a bank credit.

WHY THIS FILE EXISTS. Until 0018_logistics the platform could take money and then say nothing about
what happened to it: `orders.status` had `shipped` and `delivered` in its CHECK constraint and no
door anywhere that could write either. This module is the missing half of the order lifecycle plus
the three questions that half makes answerable, and it is the only place any of them is served:

    POST /staff/logistics/orders/{id}/ship      record the parcel - the first write that can move an
                                                order past `paid`
    POST /staff/logistics/shipments/{id}/deliver the delivery scan
    GET  /staff/logistics/alerts                what needs a human today
    GET  /staff/logistics/carriers              what each carrier actually costs and takes
    GET/POST /staff/logistics/payouts           the bank credits, and which orders they paid for
    GET  /staff/logistics/payouts/{id}/matches  the ranked ways a credit settles orders
    POST /staff/logistics/payouts/{id}/match    a human confirming one of them

THE SQL IS THE CLOCK, THE SERVICE IS THE JUDGEMENT. Every "days ago" below is measured here against
`now()`, and the thresholds it is compared with come from `services/logistics.py` as BOUND
PARAMETERS - `make_interval(days => :overdue)` rather than a literal 3 in the SQL. That is the one
rule this file follows hardest: a threshold written into a query and the same threshold in the
engine is two definitions, and the day someone changes one they will disagree about which orders
are overdue. The WHERE clause only narrows the scan; the engine still decides, so the day-counts
this module hands over are FACTS and the alert is a judgement made in one place.

SHIPPING WRITES THREE THINGS, and the order matters. The shipment row is the evidence, the order
status is derived from it, and the units go from `sold` to `shipped` - one rung the asset ladder
already admits (`0001_initial`'s transition table has ('sold','shipped') and nothing else out of
`sold`), applied with the rung in the WHERE clause so a unit already returned or scrapped is left
alone rather than pushed through an illegal transition. There is NO asset rung for `delivered`: the
ladder ends at `shipped`, so the delivery scan moves the ORDER and leaves the units where they are.

WHAT IS DELIBERATELY NOT HERE. No action in `staff_ops.GUARDED_ACTIONS` and none in
`staff_ai.TOOL_ROLES`: the chat rail does not dispatch any of this, so `_require_role` is called with
`db=None` throughout, which makes the ADR 0008 agent-grant branch unreachable. An agent identity is
refused here exactly like any other identity without the role. Shipping an order and confirming a
bank credit are money-adjacent writes, and the rail that can propose them is a bigger change than
this file should make on its own.

No stock movement on a shipment, either: the ledger's -1 fired at checkout when the unit sold, and a
second movement for the parcel would count the same unit twice.
"""

import base64
from datetime import date, datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.api.v1.deps import require_roles
# Reused rather than re-declared: one 409 translator and one in-body guard for the whole app.
from app.api.v1.staff_ops import _409, _require_role
from app.core.db import get_db
from app.services import carriers as carrier_svc
from app.services import logistics as lg
from app.services.audit import audit

router = APIRouter(prefix="/staff/logistics", tags=["staff-logistics"])

# Alerts and carrier performance are WAREHOUSE work - the people who pack and post need to see what
# is overdue - so the read doors take the same tuple the asset status ladder does. The money doors
# take admin or manager and nothing else: a bank credit and the order it settled is finance, and the
# reconciliation confirm is the one write here that moves money in the accounts.
ROLES_LOGISTICS_READ = ("admin", "manager", "warehouse")
ROLES_SHIP = ("admin", "manager", "warehouse")
ROLES_MONEY = ("admin", "manager")

# Action names for the audit rows and the shared in-body guard. NONE of these is a key in
# staff_ops.GUARDED_ACTIONS, which is what keeps the grant branch unreachable: db=None is passed
# below, so there is no grant lookup to reach.
ACTION_READ_LOGISTICS = "read_logistics"
ACTION_SHIP_ORDER = "ship_order"
ACTION_DELIVER_SHIPMENT = "deliver_shipment"
ACTION_READ_PAYOUTS = "read_payouts"
ACTION_CREATE_PAYOUT = "create_payout"
ACTION_MATCH_PAYOUT = "match_payout"
# The label doors moved here from `/staff/shipping` and from `staff_orders`, so their action names
# came with them: the audit trail of a booking should not look like a different act because the path
# it was booked through changed.
ACTION_BOOK_LABEL = "book_label"
ACTION_READ_LABEL = "read_label"

# How many alert rows the scan will hand the engine, oldest order first. A cap with a REPORTED
# truncation, never a silent one: an operator who cannot see that the list was cut will read the
# bottom of it as the end of the problems.
ALERT_LIMIT = 500
# The window carrier performance is measured over. A carrier's average from three years ago is
# history, not performance, and an unbounded scan of a table that only grows is a page that gets
# slower every month.
CARRIER_WINDOW_DAYS = 180
# How far back an unmatched payment is offered as a candidate for a credit. A credit settling a
# payment older than this is almost certainly a different credit, and the candidate pool is what the
# combination search walks - bounding it is what keeps that search trivial.
MATCH_WINDOW_DAYS = 90
# Suggestions returned per payout. The pool can hold hundreds of payments; the answer is the top of a
# ranked list, and a list nobody finishes reading is a list nobody acts on.
MATCH_LIMIT = 8


class ShipIn(BaseModel):
    """The parcel. `carrier` is free text on purpose - see 0018_logistics on why there is no
    carriers table - and `promised_days` is the carrier's own promise, which is what makes an
    on-time rate measurable at all."""
    carrier: str = Field(min_length=1, max_length=60)
    service: str | None = Field(default=None, max_length=60)
    tracking_ref: str | None = Field(default=None, max_length=80)
    cost_cents: int = Field(default=0, ge=0)
    promised_days: int | None = Field(default=None, ge=0, le=60)
    notes: str | None = Field(default=None, max_length=300)


class PayoutIn(BaseModel):
    """One credit on the bank statement. `bank_ref` is the bank's own identifier and is what makes
    re-entering a statement idempotent rather than doubling every credit."""
    bank_ref: str = Field(min_length=1, max_length=80)
    amount_cents: int = Field(gt=0)
    received_on: date
    note: str | None = Field(default=None, max_length=300)


class MatchIn(BaseModel):
    """The payments a human says this credit settled. Not capped here: the amount must balance
    exactly, which is a tighter bound than any count."""
    payment_ids: list[int] = Field(min_length=1)


def _days(value) -> int | None:
    """A timestamptz difference in days as a whole number, or None when the column is NULL.

    Rounded rather than truncated so "dispatched 6.6 days ago" reads as 7 - the operator is comparing
    this against a threshold published in whole days, and a truncating cast would make a parcel
    dispatched 6.9 days ago look like it had 6.
    """
    return None if value is None else int(round(float(value)))


async def _shipment_payload(db, shipment_id: int) -> dict:
    row = (await db.execute(text("""
        SELECT s.id, s.public_id::text AS public_id, s.order_id, s.carrier, s.service,
               s.tracking_ref, s.cost_cents, s.dispatched_at, s.promised_at, s.delivered_at,
               o.status AS order_status
        FROM shipments s JOIN orders o ON o.id = s.order_id WHERE s.id = :i
    """), {"i": shipment_id})).mappings().first()
    return {
        "shipment_id": int(row["id"]), "public_id": row["public_id"],
        "order_id": int(row["order_id"]), "order_status": row["order_status"],
        "carrier": row["carrier"], "service": row["service"], "tracking_ref": row["tracking_ref"],
        "cost_cents": int(row["cost_cents"]),
        "dispatched_at": row["dispatched_at"].isoformat(),
        "promised_at": row["promised_at"].isoformat() if row["promised_at"] else None,
        "delivered_at": row["delivered_at"].isoformat() if row["delivered_at"] else None,
    }


# ---------------------------------------------------------------------------
# Alerts - what needs a human today.
# ---------------------------------------------------------------------------

# The scan. The WHERE clause is a SUPERSET of every alert condition, expressed with the engine's own
# thresholds passed in as parameters (see the header): it exists to keep the row count sane, not to
# decide anything. `pay` and `un` are LATERAL because both are per-order aggregates and a plain join
# would multiply order rows by payment rows.
_ALERT_SQL = """
SELECT o.id AS order_id, o.status, o.total_cents, o.placed_at,
       EXTRACT(EPOCH FROM (now() - o.placed_at)) / 86400.0 AS placed_days,
       EXTRACT(EPOCH FROM (now() - pay.paid_at)) / 86400.0 AS paid_days,
       s.id AS shipment_id, s.carrier, s.delivered_at,
       EXTRACT(EPOCH FROM (now() - s.dispatched_at)) / 86400.0 AS dispatched_days,
       EXTRACT(EPOCH FROM (now() - s.promised_at)) / 86400.0 AS promise_slip_days,
       EXTRACT(EPOCH FROM (now() - s.delivered_at)) / 86400.0 AS delivered_days,
       COALESCE(un.cents, 0) AS unmatched_cents
FROM orders o
LEFT JOIN LATERAL (
    SELECT min(p.created_at) AS paid_at FROM payments p
    WHERE p.order_id = o.id AND p.status = 'succeeded'
) pay ON true
LEFT JOIN shipments s ON s.order_id = o.id
LEFT JOIN LATERAL (
    SELECT sum(p.amount_cents) AS cents FROM payments p
    WHERE p.order_id = o.id AND p.status = 'succeeded'
      AND NOT EXISTS (SELECT 1 FROM payout_matches pm WHERE pm.payment_id = p.id)
) un ON true
WHERE (o.status = 'paid' AND s.id IS NULL AND pay.paid_at IS NOT NULL
       AND pay.paid_at < now() - make_interval(days => :overdue))
   OR (s.id IS NOT NULL AND s.delivered_at IS NULL
       AND ((s.promised_at IS NOT NULL AND s.promised_at < now() - make_interval(days => :slip))
            OR s.dispatched_at < now() - make_interval(days => :stale)))
   OR (s.id IS NOT NULL AND s.delivered_at IS NOT NULL AND COALESCE(un.cents, 0) > 0
       AND s.delivered_at < now() - make_interval(days => :unrec))
   OR (o.status = 'pending' AND o.placed_at < now() - make_interval(days => :abandoned))
ORDER BY o.placed_at ASC
LIMIT :lim
"""


@router.get("/alerts")
async def alerts(staff: dict = Depends(require_roles(*ROLES_LOGISTICS_READ)), db=Depends(get_db)):
    """Every order that needs a human today, worst first, with the rules that decided it.

    Read-only and writes nothing - the alerts are DERIVED on every read rather than stored, so there
    is no alert state to fall out of step with the orders it describes, and no "dismissed" flag to
    hide a problem that is still there.
    """
    await _require_role(staff, ROLES_LOGISTICS_READ, ACTION_READ_LOGISTICS, None)
    rows = (await db.execute(text(_ALERT_SQL), {
        "overdue": lg.OVERDUE_SHIP_DAYS, "slip": lg.PROMISE_SLIP_DAYS,
        "stale": lg.STALE_TRANSIT_DAYS, "unrec": lg.UNRECONCILED_DAYS,
        "abandoned": lg.ABANDONED_DAYS, "lim": ALERT_LIMIT + 1,
    })).mappings().all()

    truncated = len(rows) > ALERT_LIMIT
    engine_rows = []
    for r in rows[:ALERT_LIMIT]:
        shipment = None
        if r["shipment_id"] is not None:
            shipment = {
                "carrier": r["carrier"],
                "dispatched_days_ago": _days(r["dispatched_days"]) or 0,
                "promised_days_ago": _days(r["promise_slip_days"]),
                "delivered": r["delivered_at"] is not None,
                "delivered_days_ago": _days(r["delivered_days"]),
            }
        engine_rows.append({
            "order_id": int(r["order_id"]), "status": r["status"],
            "days_since_placed": _days(r["placed_days"]) or 0,
            "days_since_paid": _days(r["paid_days"]),
            "total_cents": int(r["total_cents"]),
            "shipment": shipment,
            "unmatched_paid_cents": int(r["unmatched_cents"]),
        })

    found = lg.order_alerts(engine_rows)
    return {"rules": lg.describe_rules(), "counts": lg.alert_counts(found),
            "alerts": [a.as_dict() for a in found],
            "scanned": len(engine_rows), "limit": ALERT_LIMIT, "truncated": truncated}


# ---------------------------------------------------------------------------
# Carrier performance.
# ---------------------------------------------------------------------------

@router.get("/carriers")
async def carriers(preference: str = "balanced",
                   staff: dict = Depends(require_roles(*ROLES_LOGISTICS_READ)),
                   db=Depends(get_db)):
    """What each carrier has actually done over the window, and which one to use next.

    `preference` is the UI's own three chips; anything else is refused rather than silently read as
    balanced, because a typo would otherwise answer a question nobody asked and look like an answer.
    """
    await _require_role(staff, ROLES_LOGISTICS_READ, ACTION_READ_LOGISTICS, None)
    if preference not in ("balanced", "cheapest", "fastest"):
        raise HTTPException(status_code=422, detail="preference must be balanced, cheapest or fastest")

    rows = (await db.execute(text("""
        SELECT s.carrier, s.cost_cents, s.delivered_at IS NOT NULL AS delivered,
               EXTRACT(EPOCH FROM (now() - s.dispatched_at)) / 86400.0 AS dispatched_days,
               CASE WHEN s.delivered_at IS NULL THEN NULL
                    ELSE EXTRACT(EPOCH FROM (s.delivered_at - s.dispatched_at)) / 86400.0 END AS transit_days,
               CASE WHEN s.delivered_at IS NULL OR s.promised_at IS NULL THEN NULL
                    ELSE s.delivered_at <= s.promised_at END AS on_time
        FROM shipments s
        WHERE s.dispatched_at >= now() - make_interval(days => :window)
        ORDER BY s.dispatched_at DESC
    """), {"window": CARRIER_WINDOW_DAYS})).mappings().all()

    stats = lg.carrier_stats([{
        "carrier": r["carrier"], "cost_cents": int(r["cost_cents"]), "delivered": r["delivered"],
        "dispatched_days_ago": _days(r["dispatched_days"]),
        "transit_days": (None if r["transit_days"] is None else float(r["transit_days"])),
        "on_time": r["on_time"],
    } for r in rows])

    return {"rules": lg.describe_rules(), "window_days": CARRIER_WINDOW_DAYS,
            "shipments_in_window": len(rows),
            "carriers": [s.as_dict() for s in stats],
            "recommendation": lg.recommend_carrier(stats, preference=preference),
            # The other half of "which carrier", merged in rather than given a second endpoint: the
            # stats above say what each carrier HAS DONE, and this says whether a label can be booked
            # with one RIGHT NOW and what is missing if not. A packer asking "can I send this today"
            # would otherwise have to know that the answer lives at a different address from the
            # question - which is how `/staff/shipping/carriers` came to exist as a duplicate.
            "label_readiness": await carrier_svc.available(db)}


# ---------------------------------------------------------------------------
# The ship and deliver writes.
# ---------------------------------------------------------------------------

@router.get("/orders/{order_id}/shipment")
async def order_shipment(order_id: int,
                         staff: dict = Depends(require_roles(*ROLES_LOGISTICS_READ)),
                         db=Depends(get_db)):
    """The parcel recorded against this order, or null if it has not shipped.

    Its own door rather than a field bolted onto `staff_views`'s order detail: the order read is the
    commerce desk's shape (order, customer, lines, payments) and this is logistics' own record. A
    screen that wants both asks both, and neither module has to know about the other's payload.

    Null is a real answer here and is returned as one - the order screen uses it to decide between
    offering the ship form and showing the parcel, and an empty object would make those two states
    look identical.
    """
    await _require_role(staff, ROLES_LOGISTICS_READ, ACTION_READ_LOGISTICS, None)
    row = (await db.execute(text(
        "SELECT id FROM shipments WHERE order_id = :i ORDER BY id DESC LIMIT 1"),
        {"i": order_id})).mappings().first()
    if row is None:
        return {"order_id": order_id, "shipment": None}
    return {"order_id": order_id, "shipment": await _shipment_payload(db, int(row["id"]))}


@router.post("/orders/{order_id}/ship", status_code=201)
async def ship_order(order_id: int, body: ShipIn,
                     staff: dict = Depends(require_roles(*ROLES_SHIP)), db=Depends(get_db)):
    """Record the parcel for a paid order, and move the order and its units to `shipped`.

    The order is locked for the duration: two operators pressing Ship on the same order at once
    would otherwise both find it `paid` and mint two parcels, which the unique index would then
    reject as a 500 rather than explain. The lock turns that race into one write and one honest 409.
    """
    await _require_role(staff, ROLES_SHIP, ACTION_SHIP_ORDER, None)
    try:
        order = (await db.execute(text(
            "SELECT id, status FROM orders WHERE id = :i FOR UPDATE"), {"i": order_id})).mappings().first()
        if order is None:
            raise HTTPException(status_code=404, detail="order not found")
        if order["status"] != "paid":
            raise HTTPException(status_code=409, detail=(
                f"only a paid order can ship - order #{order_id} is {order['status']}"))

        promised_at = (None if body.promised_days is None
                       else datetime.now(timezone.utc) + timedelta(days=body.promised_days))
        shipment_id = (await db.execute(text("""
            INSERT INTO shipments (order_id, carrier, service, tracking_ref, cost_cents, promised_at,
                                   notes, created_by_staff_id)
            VALUES (:o, :c, :s, :t, :cost, :promised, :notes, :who)
            RETURNING id
        """), {"o": order_id, "c": body.carrier, "s": body.service, "t": body.tracking_ref,
               "cost": body.cost_cents, "promised": promised_at, "notes": body.notes,
               "who": staff["id"]})).scalar_one()

        # The order row keeps the lifecycle FACTS - when it left, with whom, under what reference -
        # and not merely the status. That is what the label door reads to print a parcel and what
        # `GET /staff/orders/{id}` reports, so leaving them null beside a `shipped` status would be
        # the same two-accounts-of-one-fact problem this rail exists to avoid.
        await db.execute(text(
            "UPDATE orders SET status = 'shipped', shipped_at = now(),"
            "       carrier = :c, tracking_number = :t WHERE id = :i"),
            {"i": order_id, "c": body.carrier, "t": body.tracking_ref})
        # One rung, and only from `sold`: the WHERE clause is the transition table's own rule, so a
        # unit that has since been returned is skipped instead of tripping the BEFORE UPDATE trigger.
        moved = (await db.execute(text("""
            UPDATE assets SET status = 'shipped'
            WHERE status = 'sold' AND id IN (
                SELECT asset_id FROM order_lines WHERE order_id = :i AND asset_id IS NOT NULL)
        """), {"i": order_id})).rowcount

        await audit(db, "staff", entity="order", entity_id=order_id, action="order_shipped",
                    actor_id=staff["id"],
                    after={"carrier": body.carrier, "cost_cents": body.cost_cents,
                           "tracking_ref": body.tracking_ref, "units": moved})
        await db.commit()
    except SQLAlchemyError as e:
        await db.rollback()
        _409(e)

    payload = await _shipment_payload(db, shipment_id)
    payload["units_shipped"] = moved
    return payload


@router.post("/shipments/{shipment_id}/deliver")
async def deliver_shipment(shipment_id: int,
                           staff: dict = Depends(require_roles(*ROLES_SHIP)),
                           db=Depends(get_db)):
    """The delivery scan. Moves the shipment and the order; leaves the units on `shipped`.

    The asset ladder has no rung above `shipped` (0001's transition table ends there), so a delivered
    order's units stay where they are - reaching for a rung that does not exist is how a status ends
    up meaning two different things.
    """
    await _require_role(staff, ROLES_SHIP, ACTION_DELIVER_SHIPMENT, None)
    try:
        row = (await db.execute(text(
            "SELECT id, order_id, delivered_at FROM shipments WHERE id = :i FOR UPDATE"),
            {"i": shipment_id})).mappings().first()
        if row is None:
            raise HTTPException(status_code=404, detail="shipment not found")
        if row["delivered_at"] is not None:
            raise HTTPException(status_code=409, detail="this shipment is already recorded as delivered")

        await db.execute(text(
            "UPDATE shipments SET delivered_at = now() WHERE id = :i"), {"i": shipment_id})
        await db.execute(text(
            "UPDATE orders SET status = 'delivered', delivered_at = now()"
            " WHERE id = :i AND status = 'shipped'"),
            {"i": row["order_id"]})
        await audit(db, "staff", entity="order", entity_id=int(row["order_id"]),
                    action="order_delivered", actor_id=staff["id"],
                    after={"shipment_id": shipment_id})
        await db.commit()
    except SQLAlchemyError as e:
        await db.rollback()
        _409(e)
    return await _shipment_payload(db, shipment_id)


# ---------------------------------------------------------------------------
# Payouts and reconciliation.
# ---------------------------------------------------------------------------

def _payout_row(r, matched_cents: int, matched_count: int) -> dict:
    return {
        "payout_id": int(r["id"]), "public_id": r["public_id"], "bank_ref": r["bank_ref"],
        "amount_cents": int(r["amount_cents"]), "received_on": r["received_on"].isoformat(),
        "note": r["note"], "matched_cents": matched_cents, "matched_payments": matched_count,
        # What is left to explain, in cents. The operator's whole question about a credit is "is this
        # finished", and that is this number being zero.
        "unmatched_cents": int(r["amount_cents"]) - matched_cents,
        "settled": matched_cents == int(r["amount_cents"]),
    }


@router.get("/payouts")
async def list_payouts(staff: dict = Depends(require_roles(*ROLES_MONEY)), db=Depends(get_db)):
    """The bank credits recorded so far, each with how much of it has been explained.

    Nothing is cached and no total is stored: `matched_cents` is a sum over `payout_matches` on every
    read, so a credit can never show a reconciled total that disagrees with the rows that prove it.
    """
    await _require_role(staff, ROLES_MONEY, ACTION_READ_PAYOUTS, None)
    rows = (await db.execute(text("""
        SELECT p.id, p.public_id::text AS public_id, p.bank_ref, p.amount_cents, p.received_on, p.note,
               COALESCE(m.cents, 0) AS matched_cents, COALESCE(m.n, 0) AS matched_count
        FROM payouts p
        LEFT JOIN LATERAL (
            SELECT sum(pay.amount_cents) AS cents, count(*) AS n
            FROM payout_matches pm JOIN payments pay ON pay.id = pm.payment_id
            WHERE pm.payout_id = p.id
        ) m ON true
        ORDER BY p.received_on DESC, p.id DESC
        LIMIT 200
    """))).mappings().all()

    unmatched = (await db.execute(text("""
        SELECT count(*) AS n, COALESCE(sum(p.amount_cents), 0) AS cents
        FROM payments p
        WHERE p.status = 'succeeded'
          AND NOT EXISTS (SELECT 1 FROM payout_matches pm WHERE pm.payment_id = p.id)
    """))).mappings().first()

    return {
        "rules": lg.describe_rules(),
        "payouts": [_payout_row(r, int(r["matched_cents"]), int(r["matched_count"])) for r in rows],
        "unmatched_payments": {"count": int(unmatched["n"]), "cents": int(unmatched["cents"])},
    }


@router.post("/payouts", status_code=201)
async def create_payout(body: PayoutIn,
                        staff: dict = Depends(require_roles(*ROLES_MONEY)), db=Depends(get_db)):
    """Record one credit from the bank statement. Idempotent by `bank_ref`, which is the bank's own
    identifier - re-entering yesterday's statement is a 409 naming the reference, not a second
    credit."""
    await _require_role(staff, ROLES_MONEY, ACTION_CREATE_PAYOUT, None)
    try:
        exists = (await db.execute(text(
            "SELECT id FROM payouts WHERE bank_ref = :r"), {"r": body.bank_ref})).scalar_one_or_none()
        if exists is not None:
            raise HTTPException(status_code=409, detail=(
                f"bank reference {body.bank_ref!r} is already recorded as payout #{exists}"))

        payout_id = (await db.execute(text("""
            INSERT INTO payouts (bank_ref, amount_cents, received_on, note, created_by_staff_id)
            VALUES (:r, :a, :d, :n, :who) RETURNING id
        """), {"r": body.bank_ref, "a": body.amount_cents, "d": body.received_on, "n": body.note,
               "who": staff["id"]})).scalar_one()
        await audit(db, "staff", entity="payout", entity_id=payout_id, action="payout_recorded",
                    actor_id=staff["id"],
                    after={"bank_ref": body.bank_ref, "amount_cents": body.amount_cents,
                           "received_on": body.received_on.isoformat()})
        await db.commit()
    except SQLAlchemyError as e:
        await db.rollback()
        _409(e)
    return {"payout_id": payout_id, "bank_ref": body.bank_ref, "amount_cents": body.amount_cents,
            "received_on": body.received_on.isoformat(), "matched_cents": 0, "matched_payments": 0,
            "unmatched_cents": body.amount_cents, "settled": False}


async def _payout(db, payout_id: int):
    row = (await db.execute(text("""
        SELECT p.id, p.public_id::text AS public_id, p.bank_ref, p.amount_cents, p.received_on, p.note,
               COALESCE(m.cents, 0) AS matched_cents, COALESCE(m.n, 0) AS matched_count
        FROM payouts p
        LEFT JOIN LATERAL (
            SELECT sum(pay.amount_cents) AS cents, count(*) AS n
            FROM payout_matches pm JOIN payments pay ON pay.id = pm.payment_id
            WHERE pm.payout_id = p.id
        ) m ON true
        WHERE p.id = :i
    """), {"i": payout_id})).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="payout not found")
    return row


@router.get("/payouts/{payout_id}/matches")
async def payout_matches(payout_id: int,
                         staff: dict = Depends(require_roles(*ROLES_MONEY)), db=Depends(get_db)):
    """The ranked ways this credit could settle the unmatched payments near its date.

    Candidates are payments that are COMPLETED and NOT ALREADY MATCHED, inside the window. Offering
    money that is already reconciled is how a double-match gets confirmed, so the exclusion is in
    the query rather than left to the caller's memory.
    """
    await _require_role(staff, ROLES_MONEY, ACTION_READ_PAYOUTS, None)
    payout = await _payout(db, payout_id)
    # The window is computed HERE, in Python, and handed over as two whole timestamps. The obvious
    # SQL - `p.created_at <= :d::date + interval '1 day'` - is a trap on this stack: a `::type` cast
    # next to a placeholder inside `text()` is parsed by SQLAlchemy as a second bind parameter before
    # asyncpg ever sees it, and the statement dies on a syntax error at ":". A `date` parameter
    # compared against a timestamptz has the same shape of problem from the other side. Two concrete
    # bounds have neither.
    upper = datetime.combine(payout["received_on"], time.min, tzinfo=timezone.utc) + timedelta(days=1)
    lower = upper - timedelta(days=MATCH_WINDOW_DAYS + 1)
    rows = (await db.execute(text("""
        SELECT p.id AS payment_id, p.order_id, p.amount_cents, p.status, p.created_at,
               p.provider_ref, o.public_id::text AS order_public_id
        FROM payments p JOIN orders o ON o.id = p.order_id
        WHERE p.status = 'succeeded'
          AND NOT EXISTS (SELECT 1 FROM payout_matches pm WHERE pm.payment_id = p.id)
          AND p.created_at <= :upper
          AND p.created_at >= :lower
        ORDER BY p.created_at DESC
        LIMIT 400
    """), {"upper": upper, "lower": lower})).mappings().all()

    suggestions = lg.match_payout(
        {"amount_cents": int(payout["amount_cents"]), "received_on": payout["received_on"],
         "bank_ref": payout["bank_ref"]},
        [{"payment_id": int(r["payment_id"]), "order_id": int(r["order_id"]),
          "amount_cents": int(r["amount_cents"]), "status": r["status"],
          "paid_on": r["created_at"], "provider_ref": r["provider_ref"]} for r in rows])

    return {
        "rules": lg.describe_rules(),
        "payout": _payout_row(payout, int(payout["matched_cents"]), int(payout["matched_count"])),
        "candidates": len(rows), "window_days": MATCH_WINDOW_DAYS,
        "suggestions": [s.as_dict() for s in suggestions[:MATCH_LIMIT]],
        "suggestion_total": len(suggestions),
    }


@router.post("/payouts/{payout_id}/match")
async def match_payout(payout_id: int, body: MatchIn,
                       staff: dict = Depends(require_roles(*ROLES_MONEY)), db=Depends(get_db)):
    """Confirm that this credit settled exactly these payments.

    THE AMOUNT MUST BALANCE EXACTLY. A partial reconciliation - some of a credit assigned, the rest
    left dangling - is not a half-done match, it is an UNKNOWN: the operator cannot tell afterwards
    whether they meant to leave a remainder or forgot the last order. Refusing the write and naming
    the difference is the only answer that cannot be misread.

    Every id is re-checked here rather than trusted from the suggestion: a client can post any list,
    and `payout_matches_payment_uniq` would otherwise be the only thing standing between a stale tab
    and money counted twice. The unique constraint is the backstop; this is the explanation.
    """
    await _require_role(staff, ROLES_MONEY, ACTION_MATCH_PAYOUT, None)
    ids = sorted(set(int(i) for i in body.payment_ids))
    try:
        payout = await _payout(db, payout_id)
        rows = (await db.execute(text("""
            SELECT p.id, p.order_id, p.amount_cents, p.status,
                   (SELECT 1 FROM payout_matches pm WHERE pm.payment_id = p.id) AS matched
            FROM payments p WHERE p.id = ANY(:ids)
        """), {"ids": ids})).mappings().all()
        if len(rows) != len(ids):
            missing = sorted(set(ids) - {int(r["id"]) for r in rows})
            raise HTTPException(status_code=404, detail=f"no such payment(s): {missing}")
        already = [int(r["id"]) for r in rows if r["matched"]]
        if already:
            raise HTTPException(status_code=409, detail=(
                f"payment(s) {already} are already matched to a payout"))
        bad = [int(r["id"]) for r in rows if r["status"] != "succeeded"]
        if bad:
            raise HTTPException(status_code=409, detail=(
                f"payment(s) {bad} are not completed payments and cannot settle a credit"))

        total = sum(int(r["amount_cents"]) for r in rows)
        if total != int(payout["amount_cents"]):
            raise HTTPException(status_code=422, detail=(
                f"these payments total ${total / 100:,.2f} and the credit is "
                f"${int(payout['amount_cents']) / 100:,.2f} - a reconciliation must balance exactly"))

        for r in rows:
            await db.execute(text("""
                INSERT INTO payout_matches (payout_id, payment_id, matched_by_staff_id)
                VALUES (:p, :pay, :who)
            """), {"p": payout_id, "pay": int(r["id"]), "who": staff["id"]})
        await audit(db, "staff", entity="payout", entity_id=payout_id, action="payout_matched",
                    actor_id=staff["id"],
                    after={"payment_ids": ids, "order_ids": [int(r["order_id"]) for r in rows],
                           "amount_cents": total})
        await db.commit()
    except SQLAlchemyError as e:
        await db.rollback()
        _409(e)

    fresh = await _payout(db, payout_id)
    return {"payout": _payout_row(fresh, int(fresh["matched_cents"]), int(fresh["matched_count"])),
            "matched_payment_ids": ids,
            "order_ids": [int(r["order_id"]) for r in rows]}


# ---------------------------------------------------------------------------
# Fulfilment: the queue a packer works from, and the label for one order.
#
# THESE MOVED HERE. The queue and the fulfilment document lived in `staff_shipping.py`, and the label
# read lived in `staff_orders.py` as `GET /staff/orders/{id}/label` - which read the DENORMALISED
# `orders.carrier`/`orders.tracking_number` mirror rather than the parcel itself. Three sessions had
# grown three answers to "where is this order's fulfilment state"; the owner's ruling is that
# `shipments` is the source of truth and this module is the only rail. So that door is closed, its
# callers redirected here, and its contract preserved key for key - a removal that also changed the
# payload would be a migration for its callers rather than a consolidation.
#
# WHAT IS DELIBERATELY NOT HERE: `services/carriers.py` stays a service. This module owns the ROUTES;
# the client that speaks to Australia Post is not a route and has no business in a router.
# ---------------------------------------------------------------------------

# The page bounds for the queue. A packing bench reads a worklist, not a report - and the address is
# on every row, so an unbounded read would be an enumeration of the customer base's addresses.
DEFAULT_PAGE = 25
MAX_PAGE = 100


def _iso(value) -> str | None:
    return value.isoformat() if isinstance(value, datetime) else (str(value) if value else None)


def _recipient(row) -> dict:
    """The address block, in one place, so the queue, the document and the label read it alike. A
    NULL column becomes an empty string rather than an absent key: a packing slip wants the blank
    line, and `services/carriers.py` checks the postcode for itself."""
    return {
        "name": row["ship_to_name"] or "",
        "line1": row["ship_line1"] or "",
        "line2": row["ship_line2"] or "",
        "city": row["ship_city"] or "",
        "state": row["ship_state"] or "",
        "postcode": row["ship_postcode"] or "",
        "country": row["shipping_country"] or "AU",
    }


# `status = 'paid'` AND no shipment row is the whole definition of "waiting to go out" - the same
# condition the `overdue` alert narrows further with a clock. `shipments.order_id` is UNIQUE, so the
# anti-join cannot multiply a row.
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


async def _shipment_for_order(db, order_id: int) -> dict | None:
    """The parcel for this order, in `_shipment_payload`'s own shape - one builder, so the fulfilment
    document and `GET /orders/{id}/shipment` cannot describe the same parcel differently."""
    row = (await db.execute(text("SELECT id FROM shipments WHERE order_id = :i"),
                            {"i": order_id})).first()
    return None if row is None else await _shipment_payload(db, int(row[0]))


@router.get("/queue")
async def fulfilment_queue(limit: int = Query(DEFAULT_PAGE, ge=1, le=MAX_PAGE),
                           offset: int = Query(0, ge=0),
                           staff: dict = Depends(require_roles(*ROLES_SHIP)),
                           db=Depends(get_db)):
    """Paid orders with no parcel yet, oldest first - the worklist, and the packing-slip source.

    Oldest first because this is a queue and not a browse: the order that has been waiting longest is
    closest to breaking the dispatch promise, and a screen that opened on the newest would hide
    exactly the orders that need attention.
    """
    await _require_role(staff, ROLES_SHIP, ACTION_READ_LOGISTICS, None)
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
        "total": int(total), "limit": limit, "offset": offset,
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


@router.get("/orders/{order_id}/fulfilment")
async def fulfilment_order(order_id: int, staff: dict = Depends(require_roles(*ROLES_SHIP)),
                           db=Depends(get_db)):
    """One order as a fulfilment document: what to pack, where it goes, and how it is being sent.

    Unlike the label read below, this one ANSWERS BEFORE DISPATCH - the packing slip is written while
    the box is being filled, and a document that refused until the parcel had left would refuse at
    the only moment anyone needs it.
    """
    await _require_role(staff, ROLES_SHIP, ACTION_READ_LOGISTICS, None)
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
        "shipment": await _shipment_for_order(db, order_id),
    }


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
                     staff: dict = Depends(require_roles(*ROLES_SHIP)), db=Depends(get_db)):
    """Book a real label with the carrier and hand back its document and tracking reference.

    The bytes come back base64 in the JSON body rather than as a redirect to a carrier URL: the label
    is a document this platform paid for, and a URL that lives only as long as the carrier's session
    is not something an operator can reprint from tomorrow.

    THIS DOES NOT WRITE THE SHIPMENT. Booking a label and recording a parcel are two decisions - the
    first can be repeated, because a label can be spoiled at the printer; the second cannot, because
    one parcel per order is a UNIQUE index. The tracking reference returned here is what
    `POST /orders/{id}/ship` records next.
    """
    await _require_role(staff, ROLES_SHIP, ACTION_BOOK_LABEL, None)
    r = (await db.execute(text("""
        SELECT id, status, public_id::text AS public_id, ship_to_name, ship_line1, ship_line2,
               ship_city, ship_state, ship_postcode, shipping_country
        FROM orders WHERE id = :i
    """), {"i": order_id})).mappings().first()
    if r is None:
        raise HTTPException(status_code=404, detail="order not found")
    if r["status"] != "paid":
        # An act against a real order, so it is recorded: a label booked for an order that was
        # refunded or cancelled is exactly what someone asks about later. A configuration gap is NOT
        # recorded - that is not about an order, and it would fill the trail with one operator's
        # setup mistakes.
        await audit(db, "staff", entity="order", entity_id=order_id, action="label_refused",
                    actor_id=staff["id"], meta={"reason": "not paid", "status": r["status"]})
        await db.commit()
        raise HTTPException(status_code=409,
                            detail=f"only a paid order can be labelled - order #{order_id} is {r['status']}")

    lines = (await _lines(db, [order_id])).get(order_id, [])
    parcel = {
        "service": body.service, "weight_grams": body.weight_grams, "length_cm": body.length_cm,
        "width_cm": body.width_cm, "height_cm": body.height_cm,
    }
    try:
        label = await carrier_svc.book_label(
            db, body.carrier,
            order={"id": order_id, "public_id": r["public_id"], "lines": lines},
            recipient=_recipient(r), parcel=parcel)
    except carrier_svc.CarrierError as e:
        # 409, not 500: the request was understood and the platform is not broken - the carrier is
        # simply not usable yet, and the message names what to configure.
        raise HTTPException(status_code=409, detail=str(e))

    await audit(db, "staff", entity="order", entity_id=order_id, action="label_booked",
                actor_id=staff["id"],
                after={"carrier": label.carrier, "service": label.service,
                       "tracking_ref": label.tracking_ref, "bytes": len(label.label_bytes),
                       "note": label.note})
    await db.commit()
    return {
        "order_id": order_id, "carrier": label.carrier, "service": label.service,
        "tracking_ref": label.tracking_ref, "label_format": label.label_format,
        "label_base64": base64.b64encode(label.label_bytes).decode("ascii"),
        "bytes": len(label.label_bytes), "note": label.note,
    }


@router.get("/orders/{order_id}/label")
async def shipping_label(order_id: int, staff: dict = Depends(require_roles(*ROLES_SHIP)),
                         db=Depends(get_db)):
    """The printable label for a DISPATCHED order - the replacement for `GET /staff/orders/{id}/label`.

    THE SAME CONTRACT IT REPLACES, so closing that door is a redirect rather than a loss: refused
    until the order has shipped or been delivered - a label is a claim that a parcel exists, so an
    order that has not left is a 409 naming its status rather than a document someone could print and
    stick on an empty box - and the same payload keys a print page already reads.

    IT READS THE `shipments` ROW, NOT THE MIRROR. The door it replaces read `orders.carrier` and
    `orders.tracking_number`, the denormalised copy, which is precisely the second answer this
    consolidation exists to delete. `ship_order` writes both in one transaction so they agree today,
    but a document that reads the copy is how they stop agreeing; the parcel is the source.
    """
    await _require_role(staff, ROLES_SHIP, ACTION_READ_LABEL, None)
    r = (await db.execute(text("""
        SELECT o.id, o.public_id::text AS public_id, o.status, o.currency, o.total_cents,
               s.carrier, s.service, s.tracking_ref, s.dispatched_at,
               o.ship_to_name, o.ship_line1, o.ship_line2, o.ship_city, o.ship_state,
               o.ship_postcode, o.shipping_country
        FROM orders o LEFT JOIN shipments s ON s.order_id = o.id
        WHERE o.id = :i
    """), {"i": order_id})).mappings().first()
    if r is None:
        raise HTTPException(status_code=404, detail="order not found")
    if r["status"] not in ("shipped", "delivered"):
        raise HTTPException(status_code=409,
                            detail="an order must be shipped before its label can be printed"
                                   f" (it is {r['status']})")
    if r["carrier"] is None:
        # Shipped with no parcel is refused by 0020's trigger, so this catches a row that predates it
        # rather than a state the platform can currently reach.
        raise HTTPException(status_code=409, detail="this order has no parcel recorded")
    return {
        "order_id": int(r["id"]), "order_public_id": r["public_id"], "status": r["status"],
        "carrier": r["carrier"], "service": r["service"],
        "tracking_number": r["tracking_ref"], "barcode": r["tracking_ref"],
        "dispatched_at": _iso(r["dispatched_at"]),
        "currency": r["currency"], "declared_value_cents": int(r["total_cents"]),
        "ship_to": _recipient(r),
    }
