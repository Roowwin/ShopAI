"""Staff ops views: orders, customers, the audit browser and one asset's full history.

READ-ONLY. Every route here is a GET and every one is guarded by
``Depends(require_roles("admin", "manager"))`` - nothing weaker. This is the first surface in
the product that puts customer PII (email, display name) in front of a staff user, so the wall
is the strict one and there is no narrower tuple to argue about. A ``warehouse``, ``sales`` or
``technician`` token gets 403 with an empty body, exactly like /staff/overview.

There is NO refund door, no delete and no status write in this module, and none may be added
here: refund state is reported, never actioned. The one write surface for stock stays in
staff_ops.py.

The app DB (``get_db`` -> rfo_app) is the source, not the ``ai.*`` views - same reason as
staff_overview.py: those views' DDL is in no migration, so a page must not depend on them.

PII AUDIT (run against the live DB before this module shipped, and the whole point of doing it
first): the three JSONB columns on ``audit_log`` - ``before``, ``after``, ``meta`` - are the only
place in an audit row that could carry PII, and the audit browser is the first thing to render
them. Across every row present at the time of the scan (the table is live and was growing, so
the row count is a moving target - ~9.8k) the distinct key set was exactly:
active, brand, confidence, count, country, cta_label, deal_of_month, description, grade,
hero_sub, hero_title, hold, image_url, kind, location, lot, lot_number, model, name, note, ref,
sale_price_cents, serial, simulated, slug, status, title, total_cents, units, value.
The customer-scoped entities carry only non-PII keys - order: {country, simulated, total_cents,
units}; payment: {ref}; reservation: {count}. The single ``name`` key belongs to ``promotion``
(the offer's title). A regex scan for an email shape and one for an address shape both matched
zero rows. So the audit payload below hands back the three columns verbatim: there is nothing in
them to redact. If a future writer ever puts a customer email into an audit row, this is the
column set to revisit - see the note on ``_audit_row``.

BIND-PARAMETER TYPES: every parameter that appears in an ``IS NULL`` test is wrapped in an
explicit CAST. asyncpg prepares the statement before sending values, and Postgres cannot infer a
type for a bare parameter in ``$1 IS NULL`` - it raises "could not determine data type of
parameter". In a comparison (``o.status = :status``) the column supplies the type, so only the
null-test side needs the cast; both sides take one anyway, so the statement is type-complete on
its own.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import text

from app.api.v1.deps import require_roles
from app.core.db import get_db

router = APIRouter(prefix="/staff", tags=["staff-views"])

# One role tuple for the whole module. Spelled once so a future route cannot be added with a
# narrower (or wider) gate by accident - every route below depends on this exact constant.
READ_ROLES = ("admin", "manager")

# An order's lifetime total counts money actually taken. 'pending' has not been paid yet and
# 'cancelled' never was; 'refunded' was paid and then given back, so it is not lifetime spend
# either. Keep this list aligned with orders_status_check if the lifecycle grows.
PAID_STATUSES = ("paid", "shipped", "delivered")
# Rendered into the statement at import time. This is a hardcoded code constant, not request
# input: the guard rejects anything that is not a bare lowercase word, and nothing a caller sends
# ever reaches this string. User text only ever binds through :pat - see _like().
_PAID_IN = "(" + ", ".join(
    "'" + s + "'" for s in PAID_STATUSES if s.replace("_", "").isalnum() and s.islower()
) + ")"


def _like(q: str | None) -> str | None:
    """Build a bound ILIKE pattern; None when there is nothing to match.

    The pattern is a PARAMETER, never spliced into the statement text - the only characters this
    function adds are the wildcards, and the caller's own text stays data.
    """
    if q is None:
        return None
    q = q.strip()
    return f"%{q}%" if q else None


def _iso(value):
    return value.isoformat() if value is not None else None


def _order_row(r) -> dict:
    return {"id": r["id"], "public_id": r["public_id"], "status": r["status"],
            "total_cents": int(r["total_cents"]), "currency": r["currency"],
            "placed_at": _iso(r["placed_at"]), "customer_email": r["customer_email"],
            "item_count": int(r["item_count"])}


def _customer_row(r) -> dict:
    return {"id": r["id"], "public_id": r["public_id"], "email": r["email"],
            "display_name": r["display_name"], "status": r["status"],
            "created_at": _iso(r["created_at"]), "orders_count": int(r["orders_count"]),
            "lifetime_cents": int(r["lifetime_cents"])}


def _audit_row(r) -> dict:
    """One audit row, JSONB handed back verbatim - see the PII audit in the module docstring."""
    return {"id": r["id"], "at": _iso(r["at"]), "actor_type": r["actor_type"],
            "actor_id": r["actor_id"], "entity": r["entity"], "entity_id": r["entity_id"],
            "action": r["action"], "before": r["before"], "after": r["after"], "meta": r["meta"]}


# Set-based, no N+1: item_count is one grouped aggregate over order_lines, not a query per order.
# The count statement is a SEPARATE query rather than count(*) OVER (): the window form returns
# no row at all once offset is past the end, which would silently report total=0 for a page that
# is merely empty. The filter block is shared verbatim between the two so they cannot drift.
_ORDERS_FILTER = """
    WHERE (CAST(:status AS text) IS NULL OR o.status = CAST(:status AS text))
      AND (CAST(:pat AS text) IS NULL
           OR o.public_id::text ILIKE CAST(:pat AS text)
           OR u.email::text ILIKE CAST(:pat AS text))
      AND (CAST(:cust AS bigint) IS NULL OR o.customer_id = CAST(:cust AS bigint))
"""

_ORDERS_PAGE_SQL = text("""
    SELECT o.id, o.public_id::text AS public_id, o.status, o.total_cents, o.currency,
           o.placed_at, u.email::text AS customer_email, count(ol.id) AS item_count
    FROM orders o
    LEFT JOIN users u ON u.id = o.customer_id
    LEFT JOIN order_lines ol ON ol.order_id = o.id
""" + _ORDERS_FILTER + """
    GROUP BY o.id, o.public_id, o.status, o.total_cents, o.currency, o.placed_at, u.email
    ORDER BY o.placed_at DESC, o.id DESC
    LIMIT :lim OFFSET :off
""")

# NO join to order_lines here: that join is the one that would multiply rows, and with no filter
# this total must equal exactly count(*) FROM orders (asserted in test_views.py).
_ORDERS_TOTAL_SQL = text("""
    SELECT count(*) FROM orders o LEFT JOIN users u ON u.id = o.customer_id
""" + _ORDERS_FILTER)


async def _orders_page(db, *, status: str | None, pat: str | None, cust: int | None,
                       limit: int, offset: int) -> tuple[int, list[dict]]:
    params = {"status": status, "pat": pat, "cust": cust, "lim": limit, "off": offset}
    rows = (await db.execute(_ORDERS_PAGE_SQL, params)).mappings().all()
    total = (await db.execute(_ORDERS_TOTAL_SQL, params)).scalar_one()
    return int(total), [_order_row(r) for r in rows]


@router.get("/orders")
async def list_orders(status: str | None = None, q: str | None = None,
                      limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0),
                      staff: dict = Depends(require_roles(*READ_ROLES)), db=Depends(get_db)):
    total, orders = await _orders_page(db, status=status, pat=_like(q), cust=None,
                                       limit=limit, offset=offset)
    return {"total": total, "orders": orders}


@router.get("/orders/{order_id}")
async def get_order(order_id: int, staff: dict = Depends(require_roles(*READ_ROLES)),
                    db=Depends(get_db)):
    o = (await db.execute(text("""
        SELECT o.id, o.public_id::text AS public_id, o.status, o.subtotal_cents, o.tax_cents,
               o.shipping_cents, o.total_cents, o.currency, o.placed_at, o.customer_id
        FROM orders o WHERE o.id = :i
    """), {"i": order_id})).mappings().first()
    if o is None:
        raise HTTPException(status_code=404, detail="order not found")

    # serial_tail: the last four characters of the asset's serial, so a staff screen can name the
    # unit without printing a full serial. citext needs the explicit cast for right().
    lines = (await db.execute(text("""
        SELECT ol.asset_id, ol.sku_title, ol.unit_price_cents, ol.line_total_cents,
               a.grade, right(a.serial_number::text, 4) AS serial_tail
        FROM order_lines ol LEFT JOIN assets a ON a.id = ol.asset_id
        WHERE ol.order_id = :i ORDER BY ol.id
    """), {"i": order_id})).mappings().all()

    payments = (await db.execute(text("""
        SELECT provider, status, amount_cents, created_at
        FROM payments WHERE order_id = :i ORDER BY id
    """), {"i": order_id})).mappings().all()

    # PII: the customer block is the only place on this payload with an email or a name, and the
    # whole payload is reachable only through the admin/manager gate above.
    customer = None
    if o["customer_id"] is not None:
        customer = (await db.execute(text(
            "SELECT email::text AS email, display_name FROM users WHERE id = :i"),
            {"i": o["customer_id"]})).mappings().first()

    # The shipping name/address columns on `orders` are deliberately NOT returned. The shape this
    # endpoint owes is the order plus its customer, and a shipping address is PII the screen has
    # no use for. Add them only with a reason, never by default.
    return {
        "order": {
            "id": o["id"], "public_id": o["public_id"], "status": o["status"],
            "subtotal_cents": int(o["subtotal_cents"]), "tax_cents": int(o["tax_cents"]),
            "shipping_cents": int(o["shipping_cents"]), "total_cents": int(o["total_cents"]),
            "currency": o["currency"], "placed_at": _iso(o["placed_at"]),
            "customer_id": o["customer_id"],
        },
        "lines": [{"asset_id": r["asset_id"], "sku_title": r["sku_title"],
                   "unit_price_cents": int(r["unit_price_cents"]),
                   "line_total_cents": int(r["line_total_cents"]), "grade": r["grade"],
                   "serial_tail": r["serial_tail"]} for r in lines],
        "payments": [{"provider": r["provider"], "status": r["status"],
                      "amount_cents": int(r["amount_cents"]),
                      "created_at": _iso(r["created_at"])} for r in payments],
        "customer": ({"email": customer["email"], "display_name": customer["display_name"]}
                     if customer is not None else None),
    }


# Orders per customer and lifetime spend are grouped aggregates over ONE join, not a subquery
# per customer row. `cust` is None for the list route and the id for the detail route, so both
# share this statement rather than keeping two copies of the aggregate in step.
_CUSTOMERS_SELECT = """
    SELECT u.id, u.public_id::text AS public_id, u.email::text AS email, u.display_name,
           u.status, u.created_at, count(o.id) AS orders_count,
           COALESCE(sum(o.total_cents) FILTER (WHERE o.status IN """ + _PAID_IN + """), 0) AS lifetime_cents
    FROM users u LEFT JOIN orders o ON o.customer_id = u.id
    WHERE (CAST(:pat AS text) IS NULL
           OR u.email::text ILIKE CAST(:pat AS text)
           OR u.display_name ILIKE CAST(:pat AS text))
      AND (CAST(:cust AS bigint) IS NULL OR u.id = CAST(:cust AS bigint))
    GROUP BY u.id, u.public_id, u.email, u.display_name, u.status, u.created_at
"""


@router.get("/customers")
async def list_customers(q: str | None = None,
                         limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0),
                         staff: dict = Depends(require_roles(*READ_ROLES)), db=Depends(get_db)):
    params = {"pat": _like(q), "cust": None, "lim": limit, "off": offset}
    rows = (await db.execute(text(_CUSTOMERS_SELECT +
                                  " ORDER BY u.created_at DESC, u.id DESC LIMIT :lim OFFSET :off"),
                             params)).mappings().all()
    total = (await db.execute(text("""
        SELECT count(*) FROM users u
        WHERE (CAST(:pat AS text) IS NULL
               OR u.email::text ILIKE CAST(:pat AS text)
               OR u.display_name ILIKE CAST(:pat AS text))
    """), params)).scalar_one()
    return {"total": int(total), "customers": [_customer_row(r) for r in rows]}


@router.get("/customers/{customer_id}")
async def get_customer(customer_id: int, staff: dict = Depends(require_roles(*READ_ROLES)),
                       db=Depends(get_db)):
    row = (await db.execute(text(_CUSTOMERS_SELECT),
                            {"pat": None, "cust": customer_id})).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="customer not found")
    # A customer's whole order history, newest first. Paged at the module's own default rather
    # than unbounded: a customer with thousands of orders must not turn one page load into a
    # full-table read. The detail page shows the first page and says so.
    _, orders = await _orders_page(db, status=None, pat=None, cust=customer_id,
                                   limit=50, offset=0)
    return {"customer": _customer_row(row), "orders": orders}


_AUDIT_FILTER = """
    WHERE (CAST(:entity AS text) IS NULL OR al.entity = CAST(:entity AS text))
      AND (CAST(:actor_type AS text) IS NULL OR al.actor_type = CAST(:actor_type AS text))
      AND (CAST(:action AS text) IS NULL OR al.action = CAST(:action AS text))
"""


@router.get("/audit")
async def list_audit(entity: str | None = None, actor_type: str | None = None,
                     action: str | None = None,
                     limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0),
                     staff: dict = Depends(require_roles(*READ_ROLES)), db=Depends(get_db)):
    params = {"entity": entity, "actor_type": actor_type, "action": action,
              "lim": limit, "off": offset}
    rows = (await db.execute(text("""
        SELECT al.id, al.at, al.actor_type, al.actor_id, al.entity, al.entity_id, al.action,
               al.before, al.after, al.meta
        FROM audit_log al
    """ + _AUDIT_FILTER + """
        ORDER BY al.at DESC, al.id DESC LIMIT :lim OFFSET :off
    """), params)).mappings().all()
    total = (await db.execute(text("SELECT count(*) FROM audit_log al" + _AUDIT_FILTER),
                              params)).scalar_one()
    return {"total": int(total), "entries": [_audit_row(r) for r in rows]}


@router.get("/assets/{asset_id}")
async def get_asset(asset_id: int, staff: dict = Depends(require_roles(*READ_ROLES)),
                    db=Depends(get_db)):
    a = (await db.execute(text("""
        SELECT a.id, a.public_id::text AS public_id, a.product_id,
               a.serial_number::text AS serial_number, a.imei, a.status, a.grade, a.cost_cents,
               a.sale_price_cents, a.intake_at, a.location, a.notes, a.lot_id, a.updated_at,
               -- the supplier workbook's own columns, added by 0015_excel_foundation and filled by
               -- the product importer: the unit's logistics and its four condition descriptions
               a.asset, a."class", a.model_number, a.upgrade, a.upgrade_desc, a.audit_desc,
               a.cosmetics_desc, a.functional_desc, a.fmv_cents, a.settlement_cents, a.channel,
               a.on_shelf, a.pallet, a.sku
        FROM assets a WHERE a.id = :i
    """), {"i": asset_id})).mappings().first()
    if a is None:
        raise HTTPException(status_code=404, detail="asset not found")

    lot = (await db.execute(text("""
        SELECT id, lot_number, status, warehouse, received_at, load_id, account, zone
        FROM lots WHERE id = :i
    """), {"i": a["lot_id"]})).mappings().first()

    movements = (await db.execute(text("""
        SELECT id, moved_at, qty, reason, actor_staff_id
        FROM stock_movements WHERE asset_id = :i
        ORDER BY moved_at DESC, id DESC LIMIT 50
    """), {"i": asset_id})).mappings().all()

    # customer_id is deliberately absent: a reservation's holder is not needed to inspect one
    # unit's history, and this page is about the unit.
    reservations = (await db.execute(text("""
        SELECT id, public_id::text AS public_id, status, expires_at, created_at
        FROM reservations WHERE asset_id = :i ORDER BY id DESC LIMIT 50
    """), {"i": asset_id})).mappings().all()

    audit_rows = (await db.execute(text("""
        SELECT id, at, actor_type, actor_id, entity, entity_id, action, before, after, meta
        FROM audit_log WHERE entity = 'asset' AND entity_id = :i
        ORDER BY at DESC, id DESC LIMIT 20
    """), {"i": asset_id})).mappings().all()

    # The image hub's two reads. Neither hands back `bytes`: the media is fetched one image at a
    # time from the raw door below, so a unit's page does not carry its photographs in JSON (a
    # 4 MB photo base64'd into this payload would be ~5.4 MB of the response).
    images = (await db.execute(text("""
        SELECT ai.id, ai.media_id, ai.applied_at, ai.applied_by, ai.applied_by_bulk,
               mo.filename, mo.content_type, mo.byte_size
        FROM asset_images ai JOIN media_objects mo ON mo.id = ai.media_id
        WHERE ai.asset_id = :i ORDER BY ai.id
    """), {"i": asset_id})).mappings().all()

    template_rows = (await db.execute(text("""
        SELECT grade, media_id FROM lot_grade_templates WHERE lot_id = :i
    """), {"i": a["lot_id"]})).mappings().all()
    # All four grades, always, with null where the lot has not set one: the hub renders a control
    # per grade, and a missing key would make "no template" and "not loaded" look the same.
    templates = {g: None for g in ("A", "B", "C", "D")}
    for r in template_rows:
        templates[r["grade"]] = r["media_id"]

    return {
        "asset": {
            "id": a["id"], "public_id": a["public_id"], "product_id": a["product_id"],
            "serial_number": a["serial_number"], "imei": a["imei"], "status": a["status"],
            "grade": a["grade"],
            "cost_cents": (int(a["cost_cents"]) if a["cost_cents"] is not None else None),
            "sale_price_cents": (int(a["sale_price_cents"])
                                 if a["sale_price_cents"] is not None else None),
            "intake_at": _iso(a["intake_at"]), "location": a["location"], "notes": a["notes"],
            "lot_id": a["lot_id"], "updated_at": _iso(a["updated_at"]),
            # The workbook's per-unit columns. Returned under the sheet's own concepts - `class`
            # keeps its name rather than becoming `category`, because it is the SUPPLIER's class
            # text and not this app's category row (which is a property of the product).
            "asset": a["asset"], "class": a["class"], "model_number": a["model_number"],
            "upgrade": a["upgrade"], "upgrade_desc": a["upgrade_desc"],
            "audit_desc": a["audit_desc"], "cosmetics_desc": a["cosmetics_desc"],
            "functional_desc": a["functional_desc"],
            "fmv_cents": (int(a["fmv_cents"]) if a["fmv_cents"] is not None else None),
            "settlement_cents": (int(a["settlement_cents"])
                                 if a["settlement_cents"] is not None else None),
            "channel": a["channel"], "on_shelf": a["on_shelf"], "pallet": a["pallet"],
            "sku": a["sku"],
        },
        # The lot's own batch columns travel with the unit, because a person looking at one device
        # wants to know which load and which account it came in on without a second request.
        "lot": ({"id": lot["id"], "lot_number": lot["lot_number"], "status": lot["status"],
                 "warehouse": lot["warehouse"], "received_at": _iso(lot["received_at"]),
                 "load_id": lot["load_id"], "account": lot["account"], "zone": lot["zone"]}
                if lot is not None else None),
        "movements": [{"id": r["id"], "moved_at": _iso(r["moved_at"]), "qty": r["qty"],
                       "reason": r["reason"], "actor_staff_id": r["actor_staff_id"]}
                      for r in movements],
        "reservations": [{"id": r["id"], "public_id": r["public_id"], "status": r["status"],
                          "expires_at": _iso(r["expires_at"]), "created_at": _iso(r["created_at"])}
                         for r in reservations],
        "images": [{"id": r["id"], "media_id": r["media_id"], "filename": r["filename"],
                    "content_type": r["content_type"], "byte_size": int(r["byte_size"]),
                    "applied_at": _iso(r["applied_at"]), "applied_by": r["applied_by"],
                    "applied_by_bulk": bool(r["applied_by_bulk"])}
                   for r in images],
        "grade_templates": templates,
        "audit": [_audit_row(r) for r in audit_rows],
    }


@router.get("/assets/{asset_id}/images/{image_id}/raw")
async def get_asset_image(asset_id: int, image_id: int,
                          staff: dict = Depends(require_roles(*READ_ROLES)), db=Depends(get_db)):
    """The bytes of one image, addressed by its ASSIGNMENT id and its unit.

    A read, and it lives in this module because this module is the GET-only one. It serves through
    the API rather than as a bucket URL for a reason the browser forces: the staff token is a
    bearer header that no `<img src>` can carry, and the alternative - a public URL - would make
    every unit photograph readable by anyone who ever sees one. The hub therefore fetches each
    image through the same authenticated door as the page and shows it from a blob URL.

    `nosniff` because this response hands back a content type that came from an upload: the door
    already whitelists raster types, and this is the second lock on the same door. The asset id is
    part of the lookup, so an image id from another unit is a 404 rather than a read.
    """
    row = (await db.execute(text("""
        SELECT mo.content_type, mo.bytes
        FROM asset_images ai JOIN media_objects mo ON mo.id = ai.media_id
        WHERE ai.id = :i AND ai.asset_id = :a
    """), {"i": image_id, "a": asset_id})).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="image not found on that asset")
    # `bytes(...)` on purpose: asyncpg may hand a bytea back as a memoryview, and the response is
    # built from whatever it is without asking.
    return Response(content=bytes(row["bytes"]), media_type=row["content_type"],
                    headers={"X-Content-Type-Options": "nosniff",
                             "Cache-Control": "private, max-age=300"})


@router.get("/products/{product_id}")
async def get_product(product_id: int, staff: dict = Depends(require_roles(*READ_ROLES)),
                      db=Depends(get_db)):
    """The PARENT product and EVERY one of its children - the read that did not exist before.

    `GET /catalog/{slug}` (`store_catalog.py`) is the shopper's view of the same product, and it is
    deliberately narrower: its `units` are filtered to `status = 'listed'` rows on an ACTIVE lot,
    because a shelf shows what can be bought today. That makes it useless for the question this
    route answers - "what is behind this model?" - which has to include a unit still on the intake
    dock, one graded but unpriced, one already sold, and the ones in a lot nobody has released yet.
    So there is NO status filter here and no lot-status filter either; the only predicate is the
    parent link. Every child arrives with the status, grade, prices, location and lot a person
    needs to see why it is where it is, plus a per-status count so a caller does not have to
    re-tally the list to label it.

    The media list is the parent's photo set, primary first. Both kinds of row are here - a
    byte-backed one carries `media_row_id` for the raw door below, a url-backed one carries the
    `storage_key` the catalog has always held. `image_url` is ALSO returned, unchanged: it is what
    the storefront renders today, and this route does not pretend the storefront reads the set yet.

    A read wall, strict as the rest of this module: admin or manager, nothing weaker. It returns
    full serial numbers, exactly as `GET /staff/assets/{id}` above already does - the wall is what
    keeps them off a shop floor, not redaction inside it.
    """
    p = (await db.execute(text("""
        SELECT p.id, p.public_id::text AS public_id, p.slug, p.title, p.model, p.description,
               p.specs, p.status, p.image_url, p.featured, p.created_at, p.updated_at,
               b.name AS brand, c.name AS category
        FROM products p
        JOIN brands b ON b.id = p.brand_id
        JOIN categories c ON c.id = p.category_id
        WHERE p.id = :i
    """), {"i": product_id})).mappings().first()
    if p is None:
        raise HTTPException(status_code=404, detail="product not found")

    # No `bytes` in this payload - a 4 MB photo base64'd into a list would be most of the response.
    # The byte-backed rows are fetched one at a time from the raw door, exactly like the asset hub.
    media = (await db.execute(text("""
        SELECT pm.id, pm.kind, pm.position, pm.is_primary, pm.alt_text, pm.storage_key,
               pm.media_id, pm.created_at, mo.public_id::text AS media_public_id,
               mo.filename, mo.content_type, mo.byte_size
        FROM product_media pm
        LEFT JOIN media_objects mo ON mo.id = pm.media_id
        WHERE pm.product_id = :i
        ORDER BY pm.is_primary DESC, pm.position, pm.id
    """), {"i": product_id})).mappings().all()

    assets = (await db.execute(text("""
        SELECT a.id, a.public_id::text AS public_id, a.serial_number::text AS serial_number,
               a.imei, a.status, a.grade, a.cost_cents, a.sale_price_cents, a.intake_at,
               a.location, a.lot_id, l.lot_number, l.status AS lot_status
        FROM assets a
        JOIN lots l ON l.id = a.lot_id
        WHERE a.product_id = :i
        ORDER BY a.id
    """), {"i": product_id})).mappings().all()

    # Counted here rather than left to the caller: the list is unordered by status and a page
    # labels its tabs from these numbers, which should come from the same rows it renders.
    status_counts: dict[str, int] = {}
    for a in assets:
        status_counts[a["status"]] = status_counts.get(a["status"], 0) + 1

    return {
        "product": {
            "id": p["id"], "public_id": p["public_id"], "slug": p["slug"], "title": p["title"],
            "model": p["model"], "brand": p["brand"], "category": p["category"],
            "description": p["description"], "specs": p["specs"], "status": p["status"],
            "image_url": p["image_url"], "featured": bool(p["featured"]),
            "created_at": _iso(p["created_at"]), "updated_at": _iso(p["updated_at"]),
        },
        "media": [{
            "media_row_id": m["id"], "kind": m["kind"], "position": m["position"],
            "is_primary": bool(m["is_primary"]), "alt_text": m["alt_text"],
            "created_at": _iso(m["created_at"]),
            # Exactly one of these two is the photo's address, mirroring the table's own CHECK.
            "storage_key": m["storage_key"],
            "media_id": m["media_id"], "media_public_id": m["media_public_id"],
            "filename": m["filename"], "content_type": m["content_type"],
            "byte_size": (int(m["byte_size"]) if m["byte_size"] is not None else None),
            "raw_path": (f"/staff/products/{product_id}/media/{m['id']}/raw"
                         if m["media_id"] is not None else None),
        } for m in media],
        "assets": [{
            "id": a["id"], "public_id": a["public_id"], "serial_number": a["serial_number"],
            "imei": a["imei"], "status": a["status"], "grade": a["grade"],
            "cost_cents": (int(a["cost_cents"]) if a["cost_cents"] is not None else None),
            "sale_price_cents": (int(a["sale_price_cents"])
                                 if a["sale_price_cents"] is not None else None),
            "location": a["location"], "intake_at": _iso(a["intake_at"]),
            "lot_id": a["lot_id"], "lot_number": a["lot_number"], "lot_status": a["lot_status"],
        } for a in assets],
        "asset_count": len(assets),
        "status_counts": status_counts,
    }


@router.get("/products/{product_id}/media/{media_row_id}/raw")
async def get_product_media(product_id: int, media_row_id: int,
                            staff: dict = Depends(require_roles(*READ_ROLES)),
                            db=Depends(get_db)):
    """The bytes of one stock photo, addressed by its product_media row AND its product.

    Served through the API rather than as a bucket URL for the reason the asset hub is: the staff
    token is a bearer header no `<img src>` can carry, so the page fetches through the same
    authenticated door as the page itself.

    A URL-BACKED row has no bytes to serve - its `storage_key` IS the address, an external one the
    catalog has always held - and that is a 409 with a reason rather than an empty 200 or a 404,
    because "this photo lives somewhere else" and "this photo does not exist" are different
    answers and a caller has to be able to tell them apart.
    """
    row = (await db.execute(text("""
        SELECT pm.storage_key, mo.content_type, mo.bytes
        FROM product_media pm
        LEFT JOIN media_objects mo ON mo.id = pm.media_id
        WHERE pm.id = :r AND pm.product_id = :p
    """), {"r": media_row_id, "p": product_id})).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="media not found on that product")
    if row["bytes"] is None:
        raise HTTPException(status_code=409,
                            detail="this stock photo is url-backed; fetch its storage_key")
    return Response(content=bytes(row["bytes"]), media_type=row["content_type"],
                    headers={"X-Content-Type-Options": "nosniff",
                             "Cache-Control": "private, max-age=300"})
