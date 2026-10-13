"""Returns and RMA: the request a customer raises, and the decision a manager records.

WHY A MODULE. Two doors write this table - the public storefront form a customer fills in, and the
backoffice screen a manager decides on - and they must agree about what a request IS: which statuses
follow which, what approving actually does, and when a label may exist. Two doors each with their
own idea of the ladder is how an approved return ends up with no label.

THE STATUS LADDER IS THE AUTHORITY, exactly like the order lifecycle. `_ALLOWED` below names every
legal move and nothing else is written; a move it does not name is refused with the current status
rather than silently applied.

    pending         -> approved | denied | info_requested | cancelled
    info_requested  -> approved | denied | cancelled
    approved        -> received | cancelled
    received        -> completed
    denied/completed/cancelled are terminal.

APPROVING MINTS THE RETURN LABEL. There is no outbound carrier API in this platform and no mailer -
nothing here has ever sent an email - so "generate the label" means: pick the carrier the parcel
actually travelled with (the order's own shipment, else a stated default), mint a tracking reference,
stamp when it was issued, and let the customer DOWNLOAD the document from their own request page.
That is the honest version of the requirement, and the columns it needs live on the request.

THE CARRIER IS THE ONE THAT DELIVERED IT. A return goes back the way it came; falling back to a
default only when the order was never shipped through the rail at all (or shipped before it existed).
A manager may override it, because a customer who moved house sends it by whatever is convenient.

RESTOCK IS NOT A SECOND PIPELINE. Receiving a return moves the order's units to `returned` through
`services/orders.return_lines` - the SAME function a cancellation and a refund use - which puts them
on the refurbishment ladder (returned -> tested -> graded -> listed). What happens next is the
existing Lot Process workbench's job: re-grade it and it is relisted, or call it scrapped. This
module does not re-implement grading and must not.
"""

import secrets

from sqlalchemy import text

from app.services import system_settings as ss
from app.services.orders import return_lines

# The three reasons the form offers, and why they are a closed set: a return is reported on by
# reason, and free text is a column nobody can group by.
REASONS = ("defective", "wrong_item", "changed_mind")

OPEN_STATUSES = ("pending", "info_requested", "approved", "received")
RMA_STATUSES = ("pending", "info_requested", "approved", "denied", "received", "completed",
                "cancelled")
RESOLUTIONS = ("refund", "replacement", "repair", "resale", "scrap")

# The carrier a return travels with when the order's own shipment names none. Stated rather than
# invented per-request so two identical returns do not get two different carriers.
DEFAULT_CARRIER = "Australia Post"

_ALLOWED: dict[str, tuple[str, ...]] = {
    "pending": ("approved", "denied", "info_requested", "cancelled"),
    "info_requested": ("approved", "denied", "cancelled"),
    "approved": ("received", "cancelled"),
    "received": ("completed",),
    "denied": (),
    "completed": (),
    "cancelled": (),
}

_RMA_COLUMNS = """
    r.id, r.public_id::text AS public_id, r.number, r.order_id, r.customer_id, r.email, r.reason,
    r.detail, r.status, r.resolution, r.carrier, r.tracking_ref, r.label_issued_at,
    r.decided_by, r.decided_at, r.decision_note, r.received_at, r.created_at, r.updated_at
"""


def _iso(value):
    return value.isoformat() if value is not None else None


def _row(r) -> dict:
    return {"id": r["id"], "public_id": r["public_id"], "number": r["number"],
            "order_id": r["order_id"], "customer_id": r["customer_id"], "email": r["email"],
            "reason": r["reason"], "detail": r["detail"], "status": r["status"],
            "resolution": r["resolution"], "carrier": r["carrier"],
            "tracking_ref": r["tracking_ref"], "label_issued_at": _iso(r["label_issued_at"]),
            "decided_by": r["decided_by"], "decided_at": _iso(r["decided_at"]),
            "decision_note": r["decision_note"], "received_at": _iso(r["received_at"]),
            "created_at": _iso(r["created_at"]), "updated_at": _iso(r["updated_at"])}


class RmaError(ValueError):
    """A request the API refuses. The message is written for the person reading it, not the log."""


# ---------------------------------------------------------------------------
# Finding the order a customer is asking about
# ---------------------------------------------------------------------------
async def find_order(db, order_ref: str, email: str):
    """The order this (reference, email) pair names, or None. Never raises.

    TWO FACTORS, AND THE EMAIL IS THE ONE THAT MATTERS. The order reference is the unguessable UUID
    the confirmation page shows, but a UUID alone is a bearer token - anyone who has ever seen the
    confirmation link could raise a return against somebody else's order. So the email must match
    the address the order was placed under.

    A GUEST ORDER HAS NO EMAIL TO MATCH, and is therefore not self-serviceable: there is no address
    on the row to check against, and accepting the UUID alone would be the very hole this check
    exists to close. Those customers are told to contact support rather than silently refused.
    """
    ref = (order_ref or "").strip()
    addr = (email or "").strip().lower()
    if not ref or not addr:
        return None
    row = (await db.execute(text("""
        SELECT o.id, o.public_id::text AS public_id, o.status, o.currency, o.total_cents,
               o.placed_at, o.customer_id, u.email::text AS customer_email
        FROM orders o LEFT JOIN users u ON u.id = o.customer_id
        WHERE (o.public_id::text = :ref OR o.id::text = :ref)
        LIMIT 1"""), {"ref": ref})).mappings().first()
    if row is None or row["customer_email"] is None:
        return None
    if str(row["customer_email"]).strip().lower() != addr:
        return None
    return {"id": row["id"], "public_id": row["public_id"], "status": row["status"],
            "currency": row["currency"], "total_cents": int(row["total_cents"]),
            "customer_id": row["customer_id"], "placed_at": _iso(row["placed_at"])}


async def order_lines_for(db, order_id: int) -> list[dict]:
    rows = (await db.execute(text("""
        SELECT ol.asset_id, ol.sku_title, ol.qty, ol.unit_price_cents
        FROM order_lines ol WHERE ol.order_id = :o ORDER BY ol.id"""), {"o": order_id})).mappings().all()
    return [{"asset_id": r["asset_id"], "sku_title": r["sku_title"], "qty": int(r["qty"]),
             "unit_price_cents": int(r["unit_price_cents"])} for r in rows]


# ---------------------------------------------------------------------------
# Raising a request
# ---------------------------------------------------------------------------
async def open_request_for_order(db, order_id: int):
    """The customer's OPEN return for this order, if there is one. None otherwise.

    One open return per order: a second request for the same parcel is almost always a double
    submission, and letting both through is how a customer ends up with two labels and one item.
    """
    row = (await db.execute(text(
        f"SELECT {_RMA_COLUMNS} FROM rma_requests r WHERE r.order_id = :o"
        f" AND r.status IN ({_open_list()}) ORDER BY r.id DESC LIMIT 1"),
        {"o": order_id})).mappings().first()
    return _row(row) if row is not None else None


def _open_list() -> str:
    """`OPEN_STATUSES` as a SQL literal list.

    Written as literals rather than a bound array because the values are CODE CONSTANTS, never user
    input: there is nothing here to inject, and an `= ANY(:param)` through asyncpg would need an
    array type the driver has to infer. The one thing that must not happen is this list and
    `OPEN_STATUSES` drifting, which is why it is derived from it rather than typed out.
    """
    return ", ".join("'" + s + "'" for s in OPEN_STATUSES)


async def create_request(db, *, order_id: int, customer_id: int | None, email: str,
                         reason: str, detail: str | None) -> dict:
    """Raise a return. No commit - the caller's transaction owns it, like every audit row."""
    if reason not in REASONS:
        raise RmaError("reason must be one of: " + ", ".join(REASONS))
    existing = await open_request_for_order(db, order_id)
    if existing is not None:
        raise RmaError(f"there is already an open return for this order ({existing['number']})")
    number = (await db.execute(text(
        "SELECT 'RMA-' || to_char(now(),'YYYY') || '-'"
        " || lpad(nextval('rma_number_seq')::text, 5, '0')"))).scalar_one()
    row = (await db.execute(text("""
        INSERT INTO rma_requests (number, order_id, customer_id, email, reason, detail, status)
        VALUES (:n, :o, :c, :e, :reason, :detail, 'pending')
        RETURNING id, public_id::text AS public_id, number, order_id, customer_id, email, reason,
                  detail, status, resolution, carrier, tracking_ref, label_issued_at,
                  decided_by, decided_at, decision_note, received_at, created_at, updated_at"""),
        {"n": number, "o": order_id, "c": customer_id, "e": email, "reason": reason,
         "detail": (detail or "").strip() or None})).mappings().first()
    return _row(row)


async def add_photo(db, rma_id: int, media_id: int, position: int = 0) -> None:
    """Attach one stored upload to a request. Assigning the same upload twice is a no-op."""
    await db.execute(text(
        "INSERT INTO rma_photos (rma_id, media_id, position) VALUES (:r, :m, :p)"
        " ON CONFLICT (rma_id, media_id) DO NOTHING"), {"r": rma_id, "m": media_id, "p": position})


async def photos_for(db, rma_id: int) -> list[dict]:
    rows = (await db.execute(text("""
        SELECT p.id, p.media_id, m.filename, m.content_type, m.byte_size
        FROM rma_photos p JOIN media_objects m ON m.id = p.media_id
        WHERE p.rma_id = :r ORDER BY p.position, p.id"""), {"r": rma_id})).mappings().all()
    return [{"id": r["id"], "media_id": r["media_id"], "filename": r["filename"],
             "content_type": r["content_type"], "byte_size": int(r["byte_size"])} for r in rows]


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------
async def get_request(db, rma_id: int) -> dict | None:
    row = (await db.execute(text(f"SELECT {_RMA_COLUMNS} FROM rma_requests r WHERE r.id = :i"),
                            {"i": rma_id})).mappings().first()
    return _row(row) if row is not None else None


async def get_by_ref(db, ref: str) -> dict | None:
    """One request, addressed by EITHER its public id or its human-facing number.

    Both, because the two audiences keep different things: the customer keeps the `RMA-2026-00001`
    reference we printed on their confirmation, and the backoffice screen links by id. Matching the
    number case-insensitively costs nothing and stops "it says not found" for a reference that was
    simply typed in lower case.
    """
    value = (ref or "").strip()
    if not value:
        return None
    row = (await db.execute(text(
        f"SELECT {_RMA_COLUMNS} FROM rma_requests r"
        " WHERE r.public_id::text = :p OR upper(r.number) = upper(:p)"), {"p": value})).mappings().first()
    return _row(row) if row is not None else None


async def list_requests(db, *, status: str | None, limit: int, offset: int) -> tuple[int, list[dict]]:
    params = {"s": status, "lim": limit, "off": offset}
    where = "WHERE (CAST(:s AS text) IS NULL OR r.status = CAST(:s AS text))"
    rows = (await db.execute(text(
        f"SELECT {_RMA_COLUMNS} FROM rma_requests r {where}"
        " ORDER BY r.created_at DESC, r.id DESC LIMIT :lim OFFSET :off"), params)).mappings().all()
    total = (await db.execute(text(f"SELECT count(*) FROM rma_requests r {where}"),
                              params)).scalar_one()
    return int(total), [_row(r) for r in rows]


async def customer_history(db, customer_id: int | None) -> dict:
    """What the manager reviewing this request should know: is this a returning customer, and have
    they returned things before? Counts only - the screen already shows the order itself."""
    if customer_id is None:
        return {"orders": 0, "returns": 0, "spent_cents": 0, "previous_returns": []}
    orders = (await db.execute(text(
        "SELECT count(*) AS n, COALESCE(sum(total_cents), 0) AS spent FROM orders"
        " WHERE customer_id = :c AND status IN ('paid','shipped','delivered')"),
        {"c": customer_id})).mappings().one()
    returns = (await db.execute(text(
        "SELECT count(*) AS n FROM rma_requests WHERE customer_id = :c"), {"c": customer_id})).scalar_one()
    previous = (await db.execute(text(
        "SELECT number, status, reason, created_at FROM rma_requests"
        " WHERE customer_id = :c ORDER BY id DESC LIMIT 5"), {"c": customer_id})).mappings().all()
    return {"orders": int(orders["n"]), "spent_cents": int(orders["spent"]),
            "returns": int(returns),
            "previous_returns": [{"number": r["number"], "status": r["status"],
                                  "reason": r["reason"], "created_at": _iso(r["created_at"])}
                                 for r in previous]}


# ---------------------------------------------------------------------------
# Deciding
# ---------------------------------------------------------------------------
def _require(state: str, target: str) -> None:
    if target not in _ALLOWED.get(state, ()):
        raise RmaError(f"a return cannot go from {state} to {target}")


async def decide(db, rma_id: int, *, action: str, note: str | None, staff_id: int,
                 carrier: str | None = None, resolution: str | None = None) -> dict:
    """Approve, deny or ask for more information. No commit - the caller's transaction owns it.

    APPROVING ISSUES THE LABEL IN THE SAME TRANSACTION as the decision, so an approved return
    without a label - the state an operator cannot fix from the screen - cannot exist.
    """
    target = {"approve": "approved", "deny": "denied", "request_info": "info_requested"}.get(action)
    if target is None:
        raise RmaError("action must be one of: approve, deny, request_info")
    if resolution is not None and resolution not in RESOLUTIONS:
        raise RmaError("resolution must be one of: " + ", ".join(RESOLUTIONS))
    row = await get_request(db, rma_id)
    if row is None:
        raise RmaError("return not found")
    _require(row["status"], target)
    await db.execute(text("""
        UPDATE rma_requests SET status = :s, decided_by = :by, decided_at = now(),
               decision_note = :note, resolution = COALESCE(:res, resolution)
        WHERE id = :i"""),
        {"s": target, "by": staff_id, "note": (note or "").strip() or None,
         "res": resolution, "i": rma_id})
    if target == "approved":
        await issue_label(db, rma_id, carrier=carrier)
    return await get_request(db, rma_id)


async def issue_label(db, rma_id: int, *, carrier: str | None = None) -> dict:
    """Mint (or return) the return label for an approved request.

    THE CARRIER IS THE ONE THAT DELIVERED IT. A return goes back the way it came, so the order's own
    shipment is asked first; only an order that never travelled through the rail (or shipped before
    it existed) falls back to the stated default. The tracking reference is minted here because
    there is no carrier API to ask - see the module docstring.
    """
    row = await get_request(db, rma_id)
    if row is None:
        raise RmaError("return not found")
    if row["status"] != "approved":
        raise RmaError("a return label is only issued once the return is approved")
    if row["tracking_ref"]:
        return await label_document(db, rma_id)
    chosen = (carrier or "").strip() or None
    if chosen is None:
        delivered = (await db.execute(text(
            "SELECT carrier FROM shipments WHERE order_id = :o ORDER BY id DESC LIMIT 1"),
            {"o": row["order_id"]})).mappings().first()
        chosen = (delivered or {}).get("carrier") or DEFAULT_CARRIER
    ref = "RET-" + secrets.token_hex(6).upper()
    await db.execute(text("""
        UPDATE rma_requests SET carrier = :c, tracking_ref = :t, label_issued_at = now()
        WHERE id = :i"""), {"c": chosen, "t": ref, "i": rma_id})
    return await label_document(db, rma_id)


async def label_document(db, rma_id: int) -> dict | None:
    """The return label as a printable document: where it goes, who carries it, and the reference.

    The RETURN-TO ADDRESS IS THE BUSINESS'S OWN REGISTERED ADDRESS (Settings & System) - the same
    store an invoice's seller block reads - so a parcel comes back to the address the shop claims as
    its own rather than to a second copy of it that can drift.
    """
    row = await get_request(db, rma_id)
    if row is None:
        return None
    if not row["tracking_ref"]:
        return None
    seller = await ss.get_business_identity(db)
    order = (await db.execute(text("""
        SELECT public_id::text AS public_id, ship_to_name, ship_city, ship_state
        FROM orders WHERE id = :o"""), {"o": row["order_id"]})).mappings().first()
    return {"rma_id": row["id"], "number": row["number"], "status": row["status"],
            "carrier": row["carrier"], "tracking_ref": row["tracking_ref"],
            "barcode": row["tracking_ref"], "issued_at": row["label_issued_at"],
            "reason": row["reason"], "resolution": row["resolution"],
            "order_public_id": (order or {}).get("public_id"),
            "return_to": {"name": seller["legal_name"] or "Returns Department",
                          "address": seller["address"], "email": seller["email"],
                          "tax_id": seller["tax_id"]},
            "from_customer": {"name": (order or {}).get("ship_to_name") or "",
                              "city": (order or {}).get("ship_city") or "",
                              "state": (order or {}).get("ship_state") or ""}}


async def receive(db, rma_id: int, *, staff_id: int) -> dict:
    """The parcel is back. Moves the request to `received` and the units to `returned`.

    THE UNITS GO TO `returned`, NOT TO `listed`: `rfo_assets_check_status` has no sold -> listed
    edge on purpose, so a returned unit re-enters the refurbishment ladder and is re-inspected
    before anyone can buy it again. Re-grading it is the Lot Process workbench's job, not this
    function's - this only puts it where that workbench can see it.
    """
    row = await get_request(db, rma_id)
    if row is None:
        raise RmaError("return not found")
    _require(row["status"], "received")
    lines = (await db.execute(text(
        "SELECT * FROM order_lines WHERE order_id = :o"), {"o": row["order_id"]})).mappings().all()
    await return_lines(db, row["order_id"], [_LineView(l) for l in lines],
                       reason="rma_return", actor_staff_id=staff_id)
    await db.execute(text(
        "UPDATE rma_requests SET status = 'received', received_at = now() WHERE id = :i"),
        {"i": rma_id})
    return await get_request(db, rma_id)


class _LineView:
    """The two attributes `return_lines` reads off a line, so this module need not build ORM rows."""

    def __init__(self, row):
        self.asset_id = row["asset_id"]
