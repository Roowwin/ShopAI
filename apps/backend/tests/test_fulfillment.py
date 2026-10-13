"""The fulfilment workbench: the paid-order queue, the address, and the carrier call.

WHAT THIS PROVES AND WHAT IT CANNOT. The queue and the guards are exercised against the live
database. The carrier call is proved as REQUEST SHAPING against a recording transport - the URL, the
auth header, the account number and the recipient in the body, and the tracking reference parsed back
out - because there is no Australia Post account and no key in this deployment, so a live label is
not obtainable and must not be simulated. `test_the_label_request_is_shaped_as_documented` says so in
its own docstring; no test here claims a real label was issued.

FIXTURES ARE SELF-OWNED. Orders are created by this file and removed in a `finally`, and the
identities are named `pytest-ful-…` rather than sharing the `pytest-%` namespace: a concurrent suite
sweeps `pytest-%` at its start, and a shared prefix is how one run's cleanup 401s another's logins
mid-test. Every fixture order is placed far in the past so it sorts to the front of a queue ordered
oldest-first, which keeps the assertions independent of however many seeded orders the dev database
happens to carry.
"""

import base64
import json
import uuid

import httpx
import pytest
from sqlalchemy import text

from app.bootstrap_staff import bootstrap
from app.core.db import get_engine
from app.services import carriers

_orders: list[int] = []
_emails: set[str] = set()

WAREHOUSE_ENV = {
    "AUSPOST_API_KEY": "test-key-not-real",
    "AUSPOST_ACCOUNT": "12345678",
    "WAREHOUSE_NAME": "RFO Warehouse",
    "WAREHOUSE_LINE1": "1 Dock Road",
    "WAREHOUSE_CITY": "Sydney",
    "WAREHOUSE_STATE": "NSW",
    "WAREHOUSE_POSTCODE": "2000",
}


def _h(tok: str) -> dict:
    return {"Authorization": "Bearer " + tok}


async def _cleanup():
    if not _orders and not _emails:
        return
    eng = get_engine()
    async with eng.begin() as c:
        if _orders:
            # Children first: nothing here relies on a cascade, so the order of these deletes is
            # what keeps the suite re-runnable on a shared database.
            for table in ("order_tax_lines", "payments", "shipments", "order_lines"):
                await c.execute(text(f"DELETE FROM {table} WHERE order_id = ANY(:ids)"), {"ids": _orders})
            await c.execute(text("DELETE FROM orders WHERE id = ANY(:ids)"), {"ids": _orders})
        if _emails:
            emails = sorted(_emails)
            await c.execute(text("DELETE FROM refresh_tokens WHERE identity_id IN "
                                 "(SELECT id FROM staff_users WHERE email = ANY(:e))"), {"e": emails})
            await c.execute(text("DELETE FROM staff_users WHERE email = ANY(:e)"), {"e": emails})
    _orders.clear()
    _emails.clear()


async def _staff(client, role: str) -> str:
    email = "pytest-ful-" + uuid.uuid4().hex + "@test.rfo"
    _emails.add(email)
    _, pw = await bootstrap(email, role)
    r = await client.post("/staff/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


async def _ship_it(oid: int, carrier: str = "AusPost", tracking: str = "TRK-PYTEST-1") -> None:
    """Record a parcel and move the order, in ONE transaction - the shape the rail uses, and the only
    shape 0020's trigger admits (it sees the same transaction's uncommitted shipment)."""
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("INSERT INTO shipments (order_id, carrier, tracking_ref)"
                             " VALUES (:o, :c, :t)"), {"o": oid, "c": carrier, "t": tracking})
        await c.execute(text("UPDATE orders SET status = 'shipped' WHERE id = :o"), {"o": oid})


async def _order(*, status: str = "paid", postcode: str | None = "2000", with_line: bool = True,
                 subtotal: int = 1000) -> dict:
    """One order this test owns, with a consistent total (the table CHECKs the arithmetic) and lines
    that reference no real asset - `order_lines.asset_id` is nullable, which is what lets a fixture
    create an order without reserving somebody's inventory."""
    eng = get_engine()
    async with eng.begin() as c:
        row = (await c.execute(text("""
            INSERT INTO orders (status, currency, subtotal_cents, tax_cents, shipping_cents,
                                total_cents, shipping_country, ship_to_name, ship_line1, ship_city,
                                ship_state, ship_postcode, placed_at)
            VALUES (:st, 'AUD', :sub, 100, 0, :tot, 'AU', 'Test Buyer', '9 Buyer Street', 'Melbourne',
                    'VIC', :pc, now() - interval '5000 days')
            RETURNING id, public_id::text AS public_id
        """), {"st": status, "sub": subtotal, "tot": subtotal + 100, "pc": postcode})).mappings().first()
        oid = int(row["id"])
        _orders.append(oid)
        if with_line:
            await c.execute(text("""
                INSERT INTO order_lines (order_id, asset_id, qty, sku_title, unit_price_cents,
                                         line_total_cents)
                VALUES (:o, NULL, 1, 'iPhone 13 128GB - Grade A', :sub, :sub)
            """), {"o": oid, "sub": subtotal})
    return {"id": oid, "public_id": row["public_id"]}


# --------------------------------------------------------------------------- the queue

async def test_the_queue_is_paid_and_unshipped_with_its_address(client):
    """The worklist, and the one thing on it that exists nowhere else: where the parcel goes."""
    await _cleanup()
    try:
        paid = await _order(status="paid")
        # Shipped the way the platform actually ships: a parcel row FIRST, then the status. An
        # INSERT that claimed `shipped` outright is refused by 0020's trigger now, which is the point
        # of this job - a fixture that could still do it would be testing a state nothing can reach.
        shipped = await _order(status="paid")
        await _ship_it(shipped["id"])
        pending = await _order(status="pending")

        tok = await _staff(client, "warehouse")
        r = await client.get("/staff/logistics/queue", headers=_h(tok))
        assert r.status_code == 200, r.text
        body = r.json()
        ids = [o["id"] for o in body["orders"]]

        assert paid["id"] in ids, "a paid order with no parcel is the queue's whole subject"
        assert shipped["id"] not in ids, "an order already shipped is not waiting to go out"
        assert pending["id"] not in ids, "an unpaid order must never reach a packing bench"
        assert body["total"] >= 1

        mine = next(o for o in body["orders"] if o["id"] == paid["id"])
        assert mine["recipient"]["postcode"] == "2000", mine["recipient"]
        assert mine["recipient"]["line1"] == "9 Buyer Street", mine["recipient"]
        assert len(mine["lines"]) == 1 and mine["lines"][0]["sku_title"].startswith("iPhone"), mine["lines"]
    finally:
        await _cleanup()


async def test_the_fulfilment_document_carries_the_recipient(client):
    await _cleanup()
    try:
        o = await _order()
        tok = await _staff(client, "warehouse")
        r = await client.get(f"/staff/logistics/orders/{o['id']}/fulfilment", headers=_h(tok))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["recipient"]["city"] == "Melbourne"
        assert body["recipient"]["state"] == "VIC"
        assert body["lines"][0]["unit_price_cents"] == 1000
        assert body["shipment"] is None, "nothing has been sent yet, so there is no parcel to report"

        r = await client.get("/staff/logistics/orders/999999999999/fulfilment", headers=_h(tok))
        assert r.status_code == 404, r.text
    finally:
        await _cleanup()


# --------------------------------------------------------------------------- the walls

async def test_the_shipping_doors_are_warehouse_or_above(client):
    """No credential -> 401, a real sales token -> 403, warehouse -> 200. The address is PII, so the
    role that may read it is the role that packs the box, and nothing wider."""
    await _cleanup()
    try:
        o = await _order()
        probes = [
            ("get", "/staff/logistics/queue", None),
            ("get", "/staff/logistics/carriers", None),
            ("get", f"/staff/logistics/orders/{o['id']}/fulfilment", None),
            ("post", f"/staff/logistics/orders/{o['id']}/label", {"carrier": "auspost"}),
        ]
        for method, path, payload in probes:
            call = getattr(client, method)
            kw = {"json": payload} if payload is not None else {}
            r = await call(path, **kw)
            assert r.status_code == 401, (path, "no credential", r.status_code)

        sales = _h(await _staff(client, "sales"))
        for method, path, payload in probes:
            call = getattr(client, method)
            kw = {"json": payload, "headers": sales} if payload is not None else {"headers": sales}
            r = await call(path, **kw)
            assert r.status_code == 403, (path, "sales", r.status_code)

        ok = _h(await _staff(client, "warehouse"))
        for method, path, payload in probes[:3]:
            call = getattr(client, method)
            r = await call(path, headers=ok)
            assert r.status_code == 200, (path, "warehouse", r.status_code, r.text[:80])
    finally:
        await _cleanup()


# --------------------------------------------------------------------------- the carrier, unconfigured

async def test_an_unconfigured_carrier_refuses_and_invents_nothing(client, monkeypatch):
    """The refusal is the feature: no label, no tracking reference, and nothing written down.

    Both credential sources are emptied deliberately - the settings store is stubbed and the
    environment is cleared - because the assertion is about the ABSENCE of a configured carrier,
    and a developer machine that happens to have one set must not turn this green.
    """
    await _cleanup()

    async def _no_stored_secret(_db, _provider):
        return ""

    monkeypatch.setattr(carriers, "_stored_secret", _no_stored_secret)
    for name in list(WAREHOUSE_ENV):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("AUSPOST_API_BASE", "https://carrier.invalid")

    try:
        o = await _order()
        tok = _h(await _staff(client, "warehouse"))

        r = await client.get("/staff/logistics/carriers", headers=tok)
        assert r.status_code == 200, r.text
        body = r.json()
        # ONE endpoint, two answers: the rail's own carrier PERFORMANCE under `carriers`, and the
        # label-readiness this bench needs under `label_readiness`. Reading the wrong key here is the
        # mistake the merge exists to prevent, so both are asserted by name.
        assert "carriers" in body and "recommendation" in body, sorted(body)
        auspost = next(c for c in body["label_readiness"] if c["key"] == "auspost")
        assert auspost["configured"] is False, auspost
        assert len(auspost["missing"]) == 3, auspost["missing"]

        r = await client.post(f"/staff/logistics/orders/{o['id']}/label",
                              json={"carrier": "auspost", "weight_grams": 900}, headers=tok)
        assert r.status_code == 409, r.text
        detail = r.json()["detail"]
        assert "not configured" in detail and "AUSPOST_API_KEY" in detail, detail
        assert "label" not in r.json(), "a refused booking must not return a label document"

        eng = get_engine()
        async with eng.connect() as c:
            shipments = (await c.execute(text("SELECT count(*) FROM shipments WHERE order_id = :i"),
                                         {"i": o["id"]})).scalar_one()
            booked = (await c.execute(text(
                "SELECT count(*) FROM audit_log WHERE entity_id = :i AND action = 'label_booked'"),
                {"i": o["id"]})).scalar_one()
        assert shipments == 0, "an unconfigured carrier must not leave a parcel behind"
        assert booked == 0, "and must not record a booking that never happened"
    finally:
        await _cleanup()


async def test_a_label_for_an_unpaid_order_is_refused_and_recorded(client, monkeypatch):
    """An act against a real order, so unlike a configuration gap this one IS in the trail."""
    await _cleanup()
    try:
        o = await _order(status="refunded")
        tok = _h(await _staff(client, "warehouse"))
        r = await client.post(f"/staff/logistics/orders/{o['id']}/label",
                              json={"carrier": "auspost"}, headers=tok)
        assert r.status_code == 409, r.text
        assert "only a paid order" in r.json()["detail"], r.json()

        eng = get_engine()
        async with eng.connect() as c:
            row = (await c.execute(text(
                "SELECT action, meta FROM audit_log WHERE entity_id = :i AND action = 'label_refused'"
                " ORDER BY id DESC LIMIT 1"), {"i": o["id"]})).mappings().first()
        assert row is not None, "the refusal was not recorded"
        assert row["meta"]["status"] == "refunded", dict(row)
    finally:
        await _cleanup()


# --------------------------------------------------------------------------- the carrier, configured

class _Recorder:
    """Records what was sent so the request's SHAPE can be asserted, and replays canned answers."""

    def __init__(self):
        self.requests: list[httpx.Request] = []

    def transport(self) -> httpx.MockTransport:
        def handler(request: httpx.Request) -> httpx.Response:
            self.requests.append(request)
            if request.url.path.endswith("/label"):
                return httpx.Response(200, content=b"%PDF-1.4 fake-label-bytes",
                                      headers={"content-type": "application/pdf"})
            return httpx.Response(201, json={"shipments": [{
                "shipment_id": "SHIP-99",
                "tracking_details": {"article_id": "7AB1234567890"},
                "shipment_summary": {"service": "PARCEL_POST"},
            }]})

        return httpx.MockTransport(handler)


async def test_the_label_request_is_shaped_as_documented(monkeypatch):
    """REQUEST SHAPING, NOT A LIVE CALL.

    This asserts the exact request this client would send to Australia Post - host, path, method,
    the `AUTH-KEY` header, and the account number and recipient inside the JSON body - and that the
    documented response is parsed into a tracking reference and a label document. The transport is a
    recorder, so nothing leaves the process and no label is issued. A live label cannot be tested
    here: there is no account and no key, and inventing one would prove nothing.
    """
    for name, value in WAREHOUSE_ENV.items():
        monkeypatch.setenv(name, value)
    monkeypatch.setenv("AUSPOST_API_BASE", "https://digitalapi.auspost.test")

    async def _no_stored_secret(_db, _provider):
        return ""

    monkeypatch.setattr(carriers, "_stored_secret", _no_stored_secret)

    rec = _Recorder()
    client = httpx.AsyncClient(transport=rec.transport())
    order = {"id": 501, "public_id": "11111111-2222-3333-4444-555555555555",
             "lines": [{"asset_id": 7, "sku_title": "iPhone 13 128GB - Grade A",
                        "line_total_cents": 60000}]}
    recipient = {"name": "Test Buyer", "line1": "9 Buyer Street", "line2": "", "city": "Melbourne",
                 "state": "VIC", "postcode": "3000", "country": "AU"}
    try:
        label = await carriers.book_label(None, "auspost", order=order, recipient=recipient,
                                          parcel={"weight_grams": 900, "length_cm": 20,
                                                  "width_cm": 15, "height_cm": 5},
                                          client=client)
    finally:
        await client.aclose()

    assert len(rec.requests) == 2, [str(r.url) for r in rec.requests]
    post, get = rec.requests
    assert post.method == "POST"
    assert str(post.url) == "https://digitalapi.auspost.test/shipping/v1/shipments"
    assert post.headers["AUTH-KEY"] == WAREHOUSE_ENV["AUSPOST_API_KEY"]

    body = json.loads(post.content)
    shipment = body["shipments"][0]
    assert shipment["from"]["account_number"] == WAREHOUSE_ENV["AUSPOST_ACCOUNT"]
    assert shipment["from"]["postcode"] == "2000"
    assert shipment["to"]["postcode"] == "3000", "the recipient's own postcode, not the sender's"
    assert shipment["shipment_reference"] == order["public_id"]
    assert len(shipment["items"]) == len(order["lines"]), "one item per order line"
    assert shipment["items"][0]["weight"] == 900

    assert get.method == "GET"
    assert str(get.url).endswith("/shipping/v1/shipments/SHIP-99/label")
    assert label.tracking_ref == "7AB1234567890"
    assert label.label_bytes.startswith(b"%PDF"), label.label_bytes[:16]
    assert label.label_format == "pdf"
    assert label.note is None


async def test_the_label_route_returns_the_document_and_audits_it(client, monkeypatch):
    """The router's half: it encodes the bytes, records the booking, and carries the tracking ref the
    operator needs for the sibling's `mark shipped`. The carrier call itself is stubbed here - its
    shape is the previous test's subject."""
    await _cleanup()
    try:
        o = await _order()
        tok = _h(await _staff(client, "warehouse"))

        async def _fake_book(_db, carrier_key, *, order, recipient, parcel=None, client=None):
            assert carrier_key == "auspost"
            assert recipient["postcode"] == "2000", "the route must pass the ORDER's address through"
            assert order["lines"], "and its lines"
            return carriers.Label(carrier="auspost", service="PARCEL_POST",
                                  tracking_ref="7AB0000000001",
                                  label_bytes=b"%PDF-1.4 label", label_format="pdf")

        monkeypatch.setattr(carriers, "book_label", _fake_book)

        r = await client.post(f"/staff/logistics/orders/{o['id']}/label",
                              json={"carrier": "auspost", "weight_grams": 1200}, headers=tok)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["tracking_ref"] == "7AB0000000001"
        assert base64.b64decode(body["label_base64"]).startswith(b"%PDF")
        assert body["bytes"] == len(b"%PDF-1.4 label")

        eng = get_engine()
        async with eng.connect() as c:
            row = (await c.execute(text(
                "SELECT after FROM audit_log WHERE entity_id = :i AND action = 'label_booked'"
                " ORDER BY id DESC LIMIT 1"), {"i": o["id"]})).mappings().first()
            shipments = (await c.execute(text("SELECT count(*) FROM shipments WHERE order_id = :i"),
                                         {"i": o["id"]})).scalar_one()
        assert row is not None, "a booking is not recorded"
        assert row["after"]["tracking_ref"] == "7AB0000000001", dict(row)
        assert shipments == 0, "booking a label is NOT recording a parcel - that stays the sibling's write"
    finally:
        await _cleanup()


# --------------------------------------------------------------------------- one owner, proved

async def test_the_ghost_label_door_is_gone_and_nothing_answers_under_shipping(client):
    """The consolidation, asserted as ABSENCE.

    `GET /staff/orders/{id}/label` printed a label from the `orders.carrier` mirror, and the whole
    `/staff/shipping` prefix was a fourth surface for the same facts. Both are gone; a redirect that
    left a route behind would be the same duplication with a new address.
    """
    await _cleanup()
    try:
        o = await _order()
        tok = _h(await _staff(client, "admin"))
        for path in (f"/staff/orders/{o['id']}/label",
                     "/staff/shipping/queue",
                     "/staff/shipping/carriers",
                     f"/staff/shipping/orders/{o['id']}"):
            r = await client.get(path, headers=tok)
            assert r.status_code in (404, 405), (path, r.status_code, r.text[:80])
    finally:
        await _cleanup()


async def test_the_unified_label_reads_the_shipment_and_refuses_before_dispatch(client):
    """The replacement door, with the contract it inherited: refused until a parcel exists, then the
    PARCEL's own carrier and tracking reference - not the `orders` mirror."""
    await _cleanup()
    try:
        o = await _order()
        tok = _h(await _staff(client, "warehouse"))

        r = await client.get(f"/staff/logistics/orders/{o['id']}/label", headers=tok)
        assert r.status_code == 409, r.text
        assert "must be shipped" in r.json()["detail"], r.json()

        r = await client.post(f"/staff/logistics/orders/{o['id']}/ship",
                              json={"carrier": "AusPost", "service": "PARCEL_POST",
                                    "tracking_ref": "TRK-REAL-1"}, headers=tok)
        assert r.status_code == 201, r.text

        r = await client.get(f"/staff/logistics/orders/{o['id']}/label", headers=tok)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["carrier"] == "AusPost"
        assert body["tracking_number"] == "TRK-REAL-1"
        assert body["barcode"] == "TRK-REAL-1"
        assert body["ship_to"]["postcode"] == "2000", body["ship_to"]
        assert body["declared_value_cents"] == 1100

        # And the shipment is the thing it read: the same carrier and reference, from the table.
        eng = get_engine()
        async with eng.connect() as c:
            row = (await c.execute(text("SELECT carrier, tracking_ref FROM shipments WHERE order_id = :i"),
                                   {"i": o["id"]})).mappings().first()
        assert row["carrier"] == body["carrier"] and row["tracking_ref"] == body["tracking_number"], dict(row)
    finally:
        await _cleanup()


async def test_the_database_refuses_a_shipped_order_without_a_parcel(client):
    """Item 3, made structural rather than conventional.

    A bare `UPDATE orders SET status='shipped'` - the shape the deleted door's sibling wrote - is
    refused by the trigger, and the rail's own path (parcel first, same transaction) succeeds. This
    is the difference between "we agreed to do it" and "it cannot be done otherwise".
    """
    await _cleanup()
    try:
        o = await _order()
        eng = get_engine()
        with pytest.raises(Exception) as caught:
            async with eng.begin() as c:
                await c.execute(text("UPDATE orders SET status = 'shipped' WHERE id = :i"),
                                {"i": o["id"]})
        assert "shipments row" in str(caught.value), str(caught.value)[:200]

        async with eng.connect() as c:
            still = (await c.execute(text("SELECT status FROM orders WHERE id = :i"),
                                     {"i": o["id"]})).scalar_one()
        assert still == "paid", "the refused write must not have landed"

        tok = _h(await _staff(client, "warehouse"))
        r = await client.post(f"/staff/logistics/orders/{o['id']}/ship",
                              json={"carrier": "AusPost", "tracking_ref": "TRK-LEGAL"}, headers=tok)
        assert r.status_code == 201, r.text
        async with eng.connect() as c:
            row = (await c.execute(text("SELECT o.status, s.carrier, s.tracking_ref"
                                        " FROM orders o JOIN shipments s ON s.order_id = o.id"
                                        " WHERE o.id = :i"), {"i": o["id"]})).mappings().first()
        assert row["status"] == "shipped" and row["carrier"] == "AusPost", dict(row)
    finally:
        await _cleanup()
