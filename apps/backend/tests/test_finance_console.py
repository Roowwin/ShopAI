"""The finance console's API: the register's filters, the invoice document, and expense editing.

WHAT IS NEW HERE. `test_finance_ledger.py` already proves the ledger itself - that a paid order
issues an invoice, that the ladder is one-way, and that the P&L keeps GST out of revenue. This file
covers only the three things the console added on top of it: the invoice register's customer and
amount filters, the invoice DOCUMENT (customer, delivery address and lines), and the ability to
correct an expense.

The fixture builders are IMPORTED from that suite rather than copied. A second `_paid_order` would
be a second definition of "a real sale" and the two would drift the first time the payment path
changed - which is exactly the failure this pair of files exists to avoid, one file over.

DELTAS AGAIN. The dev database carries the owner's trading, so the register's filters are asserted
against an invoice this file created rather than against a count.

Identities are `mission-` rather than `pytest-`: a concurrent suite sweeps `pytest-%` at its start
and would delete these out from under a running test.
"""

import hashlib
import hmac
import json
import uuid

from sqlalchemy import text

from app.bootstrap_staff import bootstrap
from app.core.config import get_settings
from app.core.db import get_engine
from test_finance_ledger import _archive, _drop_staff, _purge_order

_buyers: set[str] = set()
_expenses: list[int] = []


def _h(tok: str) -> dict:
    return {"Authorization": "Bearer " + tok}


async def _cleanup() -> None:
    eng = get_engine()
    async with eng.begin() as c:
        if _expenses:
            await c.execute(text("DELETE FROM expenses WHERE id = ANY(:ids)"), {"ids": _expenses})
            _expenses.clear()
        if _buyers:
            emails = sorted(_buyers)
            await c.execute(text("DELETE FROM refresh_tokens WHERE identity_id IN "
                                 "(SELECT id FROM users WHERE email = ANY(:e))"), {"e": emails})
            await c.execute(text("DELETE FROM users WHERE email = ANY(:e)"), {"e": emails})
            _buyers.clear()


async def _admin(client) -> tuple[dict, str]:
    email = "mission-" + uuid.uuid4().hex + "@test.rfo"
    _, pw = await bootstrap(email, "admin")
    r = await client.post("/staff/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return _h(r.json()["access_token"]), email


async def _customer_order(client, h: dict, tag: str, *, price: int = 31000, cost: int = 18000) -> dict:
    """A real sale BY A SIGNED-IN CUSTOMER, so the invoice carries a `customer_id`.

    `_paid_order` checks out as a guest, whose invoice has a NULL customer - and a register that can
    be filtered by customer cannot be tested against a sale that has none. Everything else about the
    purchase is that same builder's work; this only attaches the buyer to it.
    """
    email = "mission-" + uuid.uuid4().hex + "@test.rfo"
    _buyers.add(email)
    r = await client.post("/store/auth/register", json={"email": email, "password": "Str0ngPass!23",
                                                        "display_name": "Mission Finance Buyer"})
    assert r.status_code == 200, r.text
    r = await client.post("/store/auth/login", json={"email": email, "password": "Str0ngPass!23"})
    assert r.status_code == 200, r.text
    cust = {"Authorization": "Bearer " + r.json()["access_token"]}

    # The same purchase the ledger suite builds, taken to a paid order by the same steps.
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("INSERT INTO brands (name, slug) VALUES (:n, :n)"
                             " ON CONFLICT (slug) DO NOTHING"), {"n": "mission-fin-brand"})
        await c.execute(text("INSERT INTO categories (name, slug) VALUES (:n, :n)"
                             " ON CONFLICT (slug) DO NOTHING"), {"n": "mission-fin-category"})
    r = await client.post("/staff/products", headers=h, json={
        "brand_slug": "mission-fin-brand", "category_slug": "mission-fin-category",
        "model": "Model " + tag[-6:], "title": tag + " console", "slug": tag.lower() + "-con"})
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    r = await client.post("/staff/lots", headers=h, json={"lot_number": tag + "-LOT", "warehouse": "WH-T"})
    lot_id, lot_number = r.json()["id"], r.json()["lot_number"]
    r = await client.post("/staff/assets/scan-in", headers=h,
                          json={"lot_number": lot_number, "serial_number": tag + "-S1", "product_id": pid})
    aid = r.json()["id"]
    await client.post(f"/staff/assets/{aid}/grade", headers=h,
                      json={"grade": "A", "cost_cents": cost, "test_first": True})
    await client.post(f"/staff/assets/{aid}/price", headers=h, json={"sale_price_cents": price})
    await client.post(f"/staff/lots/{lot_id}/activate", headers=h)
    await client.post(f"/staff/assets/{aid}/status", headers=h, json={"status": "listed"})

    r = await client.post("/store/checkout", headers=cust,
                          json={"asset_ids": [aid], "shipping_country": "AU",
                                "ship_to_name": "Mission Buyer", "ship_line1": "1 Test Road",
                                "ship_city": "Sydney", "ship_state": "NSW", "ship_postcode": "2000"})
    assert r.status_code == 200, r.text
    public_id = r.json()["order_public_id"]

    # AND PAID, because the invoice is issued BY the payment path - a checkout that was never paid
    # has no document to filter for, which is exactly the mistake this helper made first time round.
    ref = (await client.post(f"/store/orders/{public_id}/pay")).json()["payment_ref"]
    s = get_settings()
    body = json.dumps({"ref": ref, "event": "payment.succeeded"})
    sig = hmac.new(s.PAYMENT_WEBHOOK_SECRET.encode(), body.encode(), hashlib.sha256).hexdigest()
    r = await client.post("/store/webhooks/payments/stub", content=body,
                          headers={"Content-Type": "application/json", "x-stub-signature": sig})
    assert r.status_code == 200 and r.json()["order"] == "paid", r.text
    return {"order_public_id": public_id, "asset_id": aid, "product_id": pid, "email": email}


async def _invoice_for(client, h: dict, order_public_id: str) -> dict:
    """The invoice the payment path issued for that order, read from the database rather than
    guessed from the register's first page - the dev database has 120 invoices in front of it."""
    eng = get_engine()
    async with eng.begin() as c:
        row = (await c.execute(text(
            "SELECT i.id FROM invoices i JOIN orders o ON o.id = i.order_id"
            " WHERE o.public_id = :o"), {"o": order_public_id})).mappings().first()
    assert row is not None, "the sale did not issue an invoice"
    r = await client.get(f"/staff/finance/invoices/{row['id']}", headers=h)
    assert r.status_code == 200, r.text
    return r.json()


# --------------------------------------------------------------------------- the register's filters

async def test_the_register_filters_by_customer_and_by_amount(client):
    """The two filters the console adds, each proved to SELECT and to EXCLUDE."""
    await _cleanup()
    h, admin_email = await _admin(client)
    made = None
    try:
        made = await _customer_order(client, h, "mission-fin-con-" + uuid.uuid4().hex[:8])
        inv = await _invoice_for(client, h, made["order_public_id"])

        # BY CUSTOMER: the buyer's own address finds it.
        r = await client.get(f"/staff/finance/invoices?customer={made['email']}", headers=h)
        assert r.status_code == 200, r.text
        ids = [i["id"] for i in r.json()["invoices"]]
        assert inv["id"] in ids, (ids, inv["id"])
        assert all(i["customer_id"] is not None for i in r.json()["invoices"]), "the filter matched a guest sale"

        # ... and a buyer who does not exist finds nothing rather than everything.
        r = await client.get("/staff/finance/invoices?customer=nobody-here@nowhere.invalid", headers=h)
        assert r.status_code == 200 and r.json()["total"] == 0, r.text

        # BY AMOUNT: a window around its total includes it, one above it does not.
        total = inv["total_cents"]
        r = await client.get(f"/staff/finance/invoices?amount_min={total}&amount_max={total}", headers=h)
        assert inv["id"] in [i["id"] for i in r.json()["invoices"]], r.text
        r = await client.get(f"/staff/finance/invoices?amount_min={total + 1}", headers=h)
        assert inv["id"] not in [i["id"] for i in r.json()["invoices"]], "a floor above the total still matched"

        # A range whose ends are the wrong way round is refused, not answered with silence.
        r = await client.get(f"/staff/finance/invoices?amount_min={total}&amount_max={total - 1}", headers=h)
        assert r.status_code == 422, r.text
    finally:
        if made:
            await _purge_order(made["order_public_id"])
            await _archive(made["product_id"])
        await _drop_staff(admin_email)
        await _cleanup()


# --------------------------------------------------------------------------- the invoice document

async def test_the_invoice_document_carries_the_customer_the_address_and_the_lines(client):
    """What a printable invoice needs, and what the LIST deliberately does not carry."""
    await _cleanup()
    h, admin_email = await _admin(client)
    made = None
    try:
        made = await _customer_order(client, h, "mission-fin-doc-" + uuid.uuid4().hex[:8])
        doc = await _invoice_for(client, h, made["order_public_id"])

        assert doc["customer"] is not None and doc["customer"]["email"] == made["email"], doc["customer"]
        assert doc["ship_to"]["postcode"] == "2000", doc["ship_to"]
        assert doc["ship_to"]["name"] == "Mission Buyer", doc["ship_to"]
        assert len(doc["lines"]) == 1, doc["lines"]
        line = doc["lines"][0]
        assert line["asset_id"] == made["asset_id"] and line["qty"] == 1, line
        assert line["unit_price_cents"] == 31000 and line["line_total_cents"] == 31000, line
        assert line["grade"] == "A" and line["serial_tail"], line

        # The header still adds up, and it is the INVOICE's arithmetic, not the order's re-derived.
        assert doc["total_cents"] == doc["subtotal_cents"] + doc["tax_cents"] + doc["shipping_cents"]

        # The list shape stays lean: a page of invoices must not drag a line list each.
        r = await client.get("/staff/finance/invoices?limit=1", headers=h)
        first = r.json()["invoices"][0]
        assert "lines" not in first and "customer" not in first, sorted(first)
    finally:
        if made:
            await _purge_order(made["order_public_id"])
            await _archive(made["product_id"])
        await _drop_staff(admin_email)
        await _cleanup()


# --------------------------------------------------------------------------- editing an expense

async def test_an_expense_can_be_corrected_and_the_change_is_audited(client):
    await _cleanup()
    h, admin_email = await _admin(client)
    try:
        r = await client.post("/staff/finance/expenses", headers=h, json={
            "category": "Freight", "vendor": "Mission Freight Co", "description": "Cartons",
            "amount_cents": 5000, "tax_cents": 500, "paid": False})
        assert r.status_code == 201, r.text
        created = r.json()
        _expenses.append(created["id"])

        r = await client.patch(f"/staff/finance/expenses/{created['id']}", headers=h,
                               json={"amount_cents": 7500, "description": "Cartons and tape", "paid": True})
        assert r.status_code == 200, r.text
        row = r.json()
        assert row["amount_cents"] == 7500 and row["description"] == "Cartons and tape", row
        assert row["paid_at"] is not None, "paid=True must stamp paid_at"

        # A field that was NOT sent keeps its value: this is a partial edit, not a replace.
        assert row["vendor"] == "Mission Freight Co" and row["category"] == "Freight", row
        assert row["tax_cents"] == 500, row
        assert row["incurred_on"] == created["incurred_on"], row

        # ... and the trail carries the pair, because a financial record that can be edited silently
        # is a record that cannot be reconciled against the report somebody already read.
        eng = get_engine()
        async with eng.connect() as c:
            log = (await c.execute(text(
                "SELECT before, after FROM audit_log WHERE entity = 'expense' AND entity_id = :i"
                " AND action = 'expense_edited' ORDER BY id DESC LIMIT 1"),
                {"i": created["id"]})).mappings().first()
            stored = (await c.execute(text(
                "SELECT amount_cents, description, vendor FROM expenses WHERE id = :i"),
                {"i": created["id"]})).mappings().first()
        assert log is not None, "the edit was not audited"
        assert log["before"]["amount_cents"] == 5000 and log["after"]["amount_cents"] == 7500, dict(log)
        assert stored["amount_cents"] == 7500 and stored["vendor"] == "Mission Freight Co", dict(stored)
    finally:
        await _drop_staff(admin_email)
        await _cleanup()


async def test_the_expense_edit_refuses_a_blank_category_and_a_row_that_is_not_there(client):
    await _cleanup()
    h, admin_email = await _admin(client)
    try:
        r = await client.post("/staff/finance/expenses", headers=h,
                              json={"category": "Packaging", "amount_cents": 100})
        created = r.json()
        _expenses.append(created["id"])

        r = await client.patch(f"/staff/finance/expenses/{created['id']}", headers=h,
                               json={"category": "   "})
        assert r.status_code == 422, r.text

        r = await client.patch("/staff/finance/expenses/999999999999", headers=h,
                               json={"amount_cents": 1})
        assert r.status_code == 404, r.text

        # A negative amount is refused by the model, so a correction cannot turn a cost into a credit.
        r = await client.patch(f"/staff/finance/expenses/{created['id']}", headers=h,
                               json={"amount_cents": -100})
        assert r.status_code == 422, r.text
    finally:
        await _drop_staff(admin_email)
        await _cleanup()


async def test_the_expense_edit_is_admin_only(client):
    """The console's new write inherits the door's rule - a manager runs the shop, not the books."""
    await _cleanup()
    h, admin_email = await _admin(client)
    buyer = "mission-" + uuid.uuid4().hex + "@test.rfo"
    try:
        r = await client.post("/staff/finance/expenses", headers=h,
                              json={"category": "Packaging", "amount_cents": 100})
        created = r.json()
        _expenses.append(created["id"])

        r = await client.patch(f"/staff/finance/expenses/{created['id']}", json={"amount_cents": 1})
        assert r.status_code == 401, r.text

        _, pw = await bootstrap(buyer, "manager")
        r = await client.post("/staff/auth/login", json={"email": buyer, "password": pw})
        manager = _h(r.json()["access_token"])
        r = await client.patch(f"/staff/finance/expenses/{created['id']}", headers=manager,
                               json={"amount_cents": 1})
        assert r.status_code == 403, r.text
    finally:
        await _drop_staff(admin_email)
        await _drop_staff(buyer)
        await _cleanup()
