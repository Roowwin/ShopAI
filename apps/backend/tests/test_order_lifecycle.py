"""The order lifecycle: pending -> paid -> shipped -> delivered, and the ways back out.

WHY THIS FILE EXISTS. `orders.status` carried six states from 0001 and only two were ever written -
the payment webhook moved pending -> paid and pending -> cancelled and nothing else could move an
order at all. These tests pin the states that had no door: an operator shipping and delivering, a
cancellation that never shipped, a cancellation of one that did, and a refund (which changes both
the order and the payment row).

THE STOCK HALF IS THE PART WORTH TESTING. The asset state machine
(`rfo_assets_check_status`) admits `reserved -> listed` and `sold/shipped -> returned` and
deliberately has no `sold -> listed` edge, so a cancellation of a PAID order does not put the unit
back on the shelf - it puts it back into refurbishment. That distinction is invisible from the
order row and is exactly what these tests assert, by reading the asset after the transition rather
than trusting the response.

THE MONEY TEST WALKS THE WHOLE CHAIN. Money recorded -> order paid -> shipping label printed, each
beat read back at its own source. The label is a READ of a dispatched order and is refused before
the dispatch, so "printed" can never mean a document for a parcel that does not exist.

Hermetic: every fixture is this file's own (a `mission-` taxonomy, `mission-` identities, a unique
tag on every serial and lot), and what can be deleted is - the order and its child rows. The units
themselves cannot be: the ledger is append-only by grant and its FK pins the asset, so they stay in
dev carrying their tag.
"""

import hashlib
import hmac
import json
import uuid

from sqlalchemy import text

from app.bootstrap_staff import bootstrap
from app.core.config import get_settings
from app.core.db import get_engine

BRAND = "mission-lifecycle-brand"
CATEGORY = "mission-lifecycle-category"


def _h(tok: str) -> dict:
    return {"Authorization": "Bearer " + tok}


# Not the repo's usual `pytest-` prefix: several suites tear down with
# `DELETE FROM staff_users WHERE email LIKE 'pytest-%'`, so a concurrent gate run would delete these
# identities mid-test. See the note in test_margin_guard.
async def _staff(client, role: str = "admin") -> tuple[dict, str]:
    email = "mission-" + uuid.uuid4().hex + "@test.rfo"
    _, pw = await bootstrap(email, role)
    r = await client.post("/staff/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return _h(r.json()["access_token"]), email


async def _drop_staff(email: str) -> None:
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("DELETE FROM refresh_tokens WHERE identity_id IN "
                             "(SELECT id FROM staff_users WHERE email = :e)"), {"e": email})
        await c.execute(text("DELETE FROM staff_users WHERE email = :e"), {"e": email})


async def _ensure_taxonomy() -> None:
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("INSERT INTO brands (name, slug) VALUES (:n, :s)"
                             " ON CONFLICT (slug) DO NOTHING"), {"n": BRAND, "s": BRAND})
        await c.execute(text("INSERT INTO categories (name, slug) VALUES (:n, :s)"
                             " ON CONFLICT (slug) DO NOTHING"), {"n": CATEGORY, "s": CATEGORY})


async def _purge_order(order_public_id: str) -> None:
    """Child rows first: the FK chain runs order_tax_lines/payments/order_lines -> orders.

    `invoices` and `payment_events` carry no FK at all (0019_commerce_finance keeps them bare so a
    suite's `DELETE FROM orders` teardown cannot fail on them), so they are matched to the order by
    the same subquery - and MUST be, or every run leaves an invoice behind for an order that no
    longer exists and the books accumulate documents for nothing.
    """
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("DELETE FROM payment_events WHERE order_id IN "
                             "(SELECT id FROM orders WHERE public_id = :o)"), {"o": order_public_id})
        await c.execute(text("DELETE FROM invoices WHERE order_id IN "
                             "(SELECT id FROM orders WHERE public_id = :o)"), {"o": order_public_id})
        for table in ("order_tax_lines", "payments", "order_lines"):
            await c.execute(text(f"DELETE FROM {table} WHERE order_id IN "
                                 "(SELECT id FROM orders WHERE public_id = :o)"),
                            {"o": order_public_id})
        await c.execute(text("DELETE FROM orders WHERE public_id = :o"), {"o": order_public_id})


async def _archive(pid: int) -> None:
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("UPDATE products SET status = 'archived' WHERE id = :i"), {"i": pid})


async def _one(sql: str, **params):
    eng = get_engine()
    async with eng.begin() as c:
        return (await c.execute(text(sql), params)).mappings().first()


async def _stage_pending(client, h: dict, tag: str, *, price: int = 25000,
                         cost: int = 15000) -> dict:
    """A real customer order sitting in `pending`, with its unit `reserved`.

    Built entirely through the public doors - product, lot, scan-in, grade, price, list, checkout -
    because the lifecycle must be exercised against the same state the storefront produces, not
    against a hand-written row.
    """
    await _ensure_taxonomy()
    r = await client.post("/staff/products", headers=h, json={
        "brand_slug": BRAND, "category_slug": CATEGORY, "model": "Model " + tag[-6:],
        "title": tag + " lifecycle", "slug": tag.lower() + "-lifecycle",
        "specs": {"note": "mission lifecycle"}})
    assert r.status_code == 201, r.text
    pid = r.json()["id"]

    r = await client.post("/staff/lots", headers=h,
                          json={"lot_number": tag + "-LOT", "warehouse": "WH-T"})
    assert r.status_code == 201, r.text
    lot_id, lot_number = r.json()["id"], r.json()["lot_number"]

    serial = tag + "-S1"
    r = await client.post("/staff/assets/scan-in", headers=h,
                          json={"lot_number": lot_number, "serial_number": serial, "product_id": pid})
    assert r.status_code == 201, r.text
    aid = r.json()["id"]
    r = await client.post(f"/staff/assets/{aid}/grade", headers=h,
                          json={"grade": "A", "cost_cents": cost, "test_first": True})
    assert r.status_code == 200, r.text
    assert (await client.post(f"/staff/assets/{aid}/price", headers=h,
                              json={"sale_price_cents": price})).status_code == 200
    assert (await client.post(f"/staff/lots/{lot_id}/activate", headers=h)).status_code == 200
    assert (await client.post(f"/staff/assets/{aid}/status", headers=h,
                              json={"status": "listed"})).status_code == 200

    r = await client.post("/store/checkout", json={
        "asset_ids": [aid], "shipping_country": "AU", "ship_to_name": "T", "ship_line1": "1 St",
        "ship_city": "Melbourne", "ship_postcode": "3000"})
    assert r.status_code == 200, r.text
    public_id = r.json()["order_public_id"]
    row = await _one("SELECT id FROM orders WHERE public_id = :o", o=public_id)
    return {"order_public_id": public_id, "order_id": row["id"], "asset_id": aid,
            "product_id": pid, "lot_id": lot_id, "serial": serial}


async def _pay(client, order_public_id: str) -> str:
    r = await client.post(f"/store/orders/{order_public_id}/pay")
    assert r.status_code == 200, r.text
    return r.json()["payment_ref"]


async def _wh(client, ref: str, event: str, **extra) -> tuple[int, dict]:
    s = get_settings()
    body = json.dumps({"ref": ref, "event": event, **extra})
    sig = hmac.new(s.PAYMENT_WEBHOOK_SECRET.encode(), body.encode(), hashlib.sha256).hexdigest()
    r = await client.post("/store/webhooks/payments/stub", content=body,
                          headers={"Content-Type": "application/json", "x-stub-signature": sig})
    return r.status_code, r.json()


async def _paid_order(client, h: dict, tag: str, **kw) -> dict:
    """A fixture order taken all the way to `paid` by the real webhook."""
    fixture = await _stage_pending(client, h, tag, **kw)
    ref = await _pay(client, fixture["order_public_id"])
    code, _ = await _wh(client, ref, "payment.succeeded")
    assert code == 200, code
    fixture["payment_ref"] = ref
    return fixture


# ---------------------------------------------------------------------------
# The happy path
# ---------------------------------------------------------------------------
async def test_pending_to_paid_to_shipped_to_delivered(client):
    h, email = await _staff(client)
    tag = "missionLc" + uuid.uuid4().hex[:10]
    fixture = None
    try:
        fixture = await _paid_order(client, h, tag)
        oid = fixture["order_id"]

        row = await _one("SELECT status, paid_at FROM orders WHERE id = :i", i=oid)
        assert row["status"] == "paid" and row["paid_at"] is not None, dict(row)

        r = await client.post(f"/staff/orders/{oid}/status", headers=h,
                              json={"status": "shipped", "carrier": "AusPost",
                                    "tracking_number": "AP-" + tag})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "shipped" and r.json()["tracking_number"] == "AP-" + tag

        r = await client.post(f"/staff/orders/{oid}/status", headers=h, json={"status": "delivered"})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "delivered"

        row = await _one("SELECT status, shipped_at, delivered_at, carrier FROM orders WHERE id = :i",
                         i=oid)
        assert row["status"] == "delivered" and row["shipped_at"] and row["delivered_at"], dict(row)
        assert row["carrier"] == "AusPost"

        # The lifecycle wrote an audit row per move, which is the only record of WHO shipped it.
        n = await _one("SELECT count(*) AS n FROM audit_log WHERE entity = 'order' AND entity_id = :i"
                       " AND action IN ('order_shipped','order_delivered')", i=oid)
        assert n["n"] == 2, dict(n)
    finally:
        if fixture:
            await _purge_order(fixture["order_public_id"])
            await _archive(fixture["product_id"])
        await _drop_staff(email)


async def test_shipping_requires_a_tracking_number(client):
    h, email = await _staff(client)
    tag = "missionLc" + uuid.uuid4().hex[:10]
    fixture = None
    try:
        fixture = await _paid_order(client, h, tag)
        r = await client.post(f"/staff/orders/{fixture['order_id']}/status", headers=h,
                              json={"status": "shipped"})
        assert r.status_code == 422 and "tracking" in r.json()["detail"], r.text
    finally:
        if fixture:
            await _purge_order(fixture["order_public_id"])
            await _archive(fixture["product_id"])
        await _drop_staff(email)


async def test_the_money_path_records_the_payment_paid_and_prints_the_label(client):
    """THE MONEY TEST, end to end: money is recorded, the order is marked paid, and the shipping
    label prints - each beat read back at its own source rather than trusted from the last response.

    A label is a claim that a parcel exists, so it must be REFUSED until the order has actually
    shipped; the dispatch records the carrier and the tracking reference the label then renders as
    its scannable barcode.
    """
    h, email = await _staff(client)
    tag = "missionLc" + uuid.uuid4().hex[:10]
    fixture = None
    try:
        fixture = await _paid_order(client, h, tag)     # checkout -> pay -> provider: succeeded
        oid = fixture["order_id"]

        # 1. THE PAYMENT IS RECORDED, for the order's own total, against the provider's reference.
        pay = await _one("SELECT status, amount_cents, provider, order_id FROM payments"
                         " WHERE provider_ref = :r", r=fixture["payment_ref"])
        order = await _one("SELECT status, paid_at, total_cents FROM orders WHERE id = :i", i=oid)
        assert pay["status"] == "succeeded" and pay["provider"] == "stub", dict(pay)
        assert int(pay["amount_cents"]) == int(order["total_cents"]), (dict(pay), dict(order))

        # 2. THE ORDER IS MARKED PAID, with a timestamp `updated_at` could never give us ...
        assert order["status"] == "paid" and order["paid_at"] is not None, dict(order)
        # ... and the sale issued its invoice in the same transaction, so the revenue is on the books.
        assert (await _one("SELECT count(*) AS n FROM invoices WHERE order_id = :i", i=oid))["n"] == 1

        # 3. THE LABEL PRINTS - but only once the parcel exists.
        r = await client.get(f"/staff/orders/{oid}/label", headers=h)
        assert r.status_code == 409, "an unshipped order has no parcel to label: " + r.text

        r = await client.post(f"/staff/orders/{oid}/status", headers=h,
                              json={"status": "shipped", "carrier": "Sendle",
                                    "tracking_number": "SN-" + tag})
        assert r.status_code == 200, r.text

        r = await client.get(f"/staff/orders/{oid}/label", headers=h)
        assert r.status_code == 200, r.text
        label = r.json()
        assert label["carrier"] == "Sendle" and label["tracking_number"] == "SN-" + tag, label
        assert label["barcode"] == label["tracking_number"], "the barcode IS the tracking reference"
        assert label["declared_value_cents"] == int(order["total_cents"]), label
        assert label["dispatched_at"] is not None, label
    finally:
        if fixture:
            await _purge_order(fixture["order_public_id"])
            await _archive(fixture["product_id"])
        await _drop_staff(email)


async def test_only_a_fulfilment_role_prints_the_label(client):
    """Dispatch and its label belong to the fulfilment roles. Warehouse prints; sales does not."""
    h, email = await _staff(client)
    wh, wh_email = await _staff(client, "warehouse")
    sales, sales_email = await _staff(client, "sales")
    tag = "missionLc" + uuid.uuid4().hex[:10]
    fixture = None
    try:
        fixture = await _paid_order(client, h, tag)
        oid = fixture["order_id"]

        assert (await client.get(f"/staff/orders/{oid}/label", headers=sales)).status_code == 403
        r = await client.post(f"/staff/orders/{oid}/status", headers=wh,
                              json={"status": "shipped", "carrier": "Aramex",
                                    "tracking_number": "AX-" + tag})
        assert r.status_code == 200, r.text
        r = await client.get(f"/staff/orders/{oid}/label", headers=wh)
        assert r.status_code == 200 and r.json()["barcode"] == "AX-" + tag, r.text

        # A DELIVERED parcel's label still reprints - that is an ordinary thing to need.
        assert (await client.post(f"/staff/orders/{oid}/status", headers=wh,
                                  json={"status": "delivered"})).status_code == 200
        assert (await client.get(f"/staff/orders/{oid}/label", headers=wh)).status_code == 200
        # An order that does not exist is a 404, not a 409.
        assert (await client.get("/staff/orders/999999999/label", headers=wh)).status_code == 404
    finally:
        if fixture:
            await _purge_order(fixture["order_public_id"])
            await _archive(fixture["product_id"])
        await _drop_staff(email)
        await _drop_staff(wh_email)
        await _drop_staff(sales_email)


async def test_the_transition_map_refuses_a_move_it_does_not_name(client):
    h, email = await _staff(client)
    tag = "missionLc" + uuid.uuid4().hex[:10]
    fixture = None
    try:
        fixture = await _stage_pending(client, h, tag)          # still pending
        oid = fixture["order_id"]
        # pending -> shipped is not a named edge, and neither is pending -> delivered
        for target in ("shipped", "delivered"):
            r = await client.post(f"/staff/orders/{oid}/status", headers=h, json={"status": target})
            assert r.status_code == 409, (target, r.status_code, r.text)
            assert "cannot go from pending" in r.json()["detail"], r.text
        r = await client.post(f"/staff/orders/{oid}/status", headers=h, json={"status": "teleported"})
        assert r.status_code == 422, r.text
    finally:
        if fixture:
            await _purge_order(fixture["order_public_id"])
            await _archive(fixture["product_id"])
        await _drop_staff(email)


# ---------------------------------------------------------------------------
# The two ways out, and what they do to the shelf
# ---------------------------------------------------------------------------
async def test_cancelling_a_pending_order_puts_the_unit_back_on_the_shelf(client):
    """A unit that was only RESERVED was never sold, so it returns to `listed`."""
    h, email = await _staff(client)
    tag = "missionLc" + uuid.uuid4().hex[:10]
    fixture = None
    try:
        fixture = await _stage_pending(client, h, tag)
        aid, oid = fixture["asset_id"], fixture["order_id"]
        assert (await _one("SELECT status FROM assets WHERE id = :i", i=aid))["status"] == "reserved"

        r = await client.post(f"/staff/orders/{oid}/status", headers=h,
                              json={"status": "cancelled", "note": "customer changed their mind"})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "cancelled"
        assert (await _one("SELECT status FROM assets WHERE id = :i", i=aid))["status"] == "listed"
        row = await _one("SELECT cancelled_at FROM orders WHERE id = :i", i=oid)
        assert row["cancelled_at"] is not None
    finally:
        if fixture:
            await _purge_order(fixture["order_public_id"])
            await _archive(fixture["product_id"])
        await _drop_staff(email)


async def test_cancelling_a_paid_order_returns_the_unit_to_refurbishment(client):
    """A unit that was SOLD comes back as `returned`, not `listed`: it is re-tested before re-sale.

    This is the assertion the whole file exists for. `rfo_assets_check_status` has no
    `sold -> listed` edge, so a cancellation of a paid order must go through `returned` - and a door
    that "helpfully" relisted it would be refused by the database, which is the point.
    """
    h, email = await _staff(client)
    tag = "missionLc" + uuid.uuid4().hex[:10]
    fixture = None
    try:
        fixture = await _paid_order(client, h, tag)
        aid, oid = fixture["asset_id"], fixture["order_id"]
        assert (await _one("SELECT status FROM assets WHERE id = :i", i=aid))["status"] == "sold"

        r = await client.post(f"/staff/orders/{oid}/status", headers=h, json={"status": "cancelled"})
        assert r.status_code == 200, r.text
        assert (await _one("SELECT status FROM assets WHERE id = :i", i=aid))["status"] == "returned"

        # ...and the stock ledger records the return with its own reason, so a cancellation is
        # distinguishable from a refund in the movement history.
        mv = await _one("SELECT reason, qty FROM stock_movements WHERE asset_id = :i"
                        " ORDER BY id DESC LIMIT 1", i=aid)
        assert mv["qty"] == 1 and mv["reason"] == "order_cancelled", dict(mv)
    finally:
        if fixture:
            await _purge_order(fixture["order_public_id"])
            await _archive(fixture["product_id"])
        await _drop_staff(email)


async def test_a_refund_returns_the_units_and_marks_the_payment(client):
    h, email = await _staff(client)
    mgr, mgr_email = await _staff(client, "manager")
    tag = "missionLc" + uuid.uuid4().hex[:10]
    fixture = None
    try:
        fixture = await _paid_order(client, h, tag)
        oid, aid = fixture["order_id"], fixture["asset_id"]

        r = await client.post(f"/staff/orders/{oid}/status", headers=mgr, json={"status": "refunded"})
        assert r.status_code == 403, "a manager must not move money: " + r.text

        r = await client.post(f"/staff/orders/{oid}/status", headers=h, json={"status": "refunded"})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "refunded"

        pay = await _one("SELECT status, refunded_cents, amount_cents FROM payments WHERE order_id = :i",
                         i=oid)
        assert pay["status"] == "refunded" and pay["refunded_cents"] == pay["amount_cents"], dict(pay)
        assert (await _one("SELECT status FROM assets WHERE id = :i", i=aid))["status"] == "returned"
        mv = await _one("SELECT reason, qty FROM stock_movements WHERE asset_id = :i"
                        " ORDER BY id DESC LIMIT 1", i=aid)
        assert mv["qty"] == 1 and mv["reason"] == "order_refunded", dict(mv)

        # A second refund has nothing left to give back.
        r = await client.post(f"/staff/orders/{oid}/status", headers=h, json={"status": "refunded"})
        assert r.status_code == 409, r.text
    finally:
        if fixture:
            await _purge_order(fixture["order_public_id"])
            await _archive(fixture["product_id"])
        await _drop_staff(email)
        await _drop_staff(mgr_email)


async def test_an_order_with_no_succeeded_payment_cannot_be_refunded(client):
    """An order booked paid BY HAND has no payment row at all - so there is nothing to refund, and
    the door says so rather than marking a refund that never happened."""
    h, email = await _staff(client)
    tag = "missionLc" + uuid.uuid4().hex[:10]
    fixture = None
    try:
        fixture = await _stage_pending(client, h, tag)
        oid = fixture["order_id"]
        r = await client.post(f"/staff/orders/{oid}/status", headers=h,
                              json={"status": "paid", "note": "EFT"})
        assert r.status_code == 200, r.text
        r = await client.post(f"/staff/orders/{oid}/status", headers=h, json={"status": "refunded"})
        assert r.status_code == 409 and "no succeeded payment" in r.json()["detail"], r.text
    finally:
        if fixture:
            await _purge_order(fixture["order_public_id"])
            await _archive(fixture["product_id"])
        await _drop_staff(email)


# ---------------------------------------------------------------------------
# Recording an offline payment, and who may do any of this
# ---------------------------------------------------------------------------
async def test_marking_a_pending_order_paid_settles_it_and_issues_the_invoice(client):
    """A bank transfer booked by hand must leave the order in exactly the state the webhook would."""
    h, email = await _staff(client)
    tag = "missionLc" + uuid.uuid4().hex[:10]
    fixture = None
    try:
        fixture = await _stage_pending(client, h, tag)
        oid, aid = fixture["order_id"], fixture["asset_id"]
        r = await client.post(f"/staff/orders/{oid}/status", headers=h,
                              json={"status": "paid", "note": "EFT reference 12345"})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "paid"
        assert (await _one("SELECT status FROM assets WHERE id = :i", i=aid))["status"] == "sold"
        inv = await _one("SELECT number, order_id, status, total_cents FROM invoices WHERE order_id = :i",
                         i=oid)
        assert inv is not None and inv["order_id"] == oid and inv["status"] == "issued", dict(inv or {})
        assert inv["number"].startswith("INV-"), inv["number"]
    finally:
        if fixture:
            await _purge_order(fixture["order_public_id"])
            await _archive(fixture["product_id"])
        await _drop_staff(email)


async def test_fulfilment_roles_are_enforced_per_target(client):
    """warehouse ships and delivers; it may not cancel or refund; a sales identity may do neither."""
    h, email = await _staff(client)
    wh, wh_email = await _staff(client, "warehouse")
    sales, sales_email = await _staff(client, "sales")
    tag = "missionLc" + uuid.uuid4().hex[:10]
    fixture = None
    try:
        fixture = await _paid_order(client, h, tag)
        oid = fixture["order_id"]

        r = await client.post(f"/staff/orders/{oid}/status", headers=sales,
                              json={"status": "shipped", "tracking_number": "X-1"})
        assert r.status_code == 403, "sales must not fulfil: " + r.text

        r = await client.post(f"/staff/orders/{oid}/status", headers=wh,
                              json={"status": "shipped", "tracking_number": "X-1"})
        assert r.status_code == 200, r.text

        r = await client.post(f"/staff/orders/{oid}/status", headers=wh, json={"status": "cancelled"})
        assert r.status_code == 403, "warehouse must not cancel: " + r.text
    finally:
        if fixture:
            await _purge_order(fixture["order_public_id"])
            await _archive(fixture["product_id"])
        await _drop_staff(email)
        await _drop_staff(wh_email)
        await _drop_staff(sales_email)
