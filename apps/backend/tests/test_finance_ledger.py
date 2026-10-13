"""The financial ledger: invoices issued from paid orders, expenses, and the P&L that nets them.

THE THREE THINGS WORTH PINNING. An invoice is issued BY the payment path, in the same transaction
as the sale, and issuing one again returns that document rather than minting a second for one sale.
An invoice's ladder is one-way (a voided document cannot be un-voided). And the P&L nets revenue
against cost of goods and expenses while keeping GST OUT of revenue - a report that counted the tax
it collected as income would overstate profit by the tax rate on every line.

DELTAS, NOT ABSOLUTES. The dev database carries the owner's own trading, so every expectation here
is the difference the fixture caused, read before and after. The one assertion that needs no delta
is the P&L's own arithmetic - net = revenue + shipping - cogs - expenses - which must hold whatever
else the shop did that day, and is what catches a report that has quietly started double-counting
something.
"""

import hashlib
import hmac
import json
import uuid
from datetime import date

from sqlalchemy import text

from app.bootstrap_staff import bootstrap
from app.core.config import get_settings
from app.core.db import get_engine


def _h(tok: str) -> dict:
    return {"Authorization": "Bearer " + tok}


async def _staff(client, role: str = "admin") -> tuple[dict, str]:
    # `mission-` identities: see the note in test_margin_guard for why not `pytest-`.
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


async def _purge_order(public_id: str) -> None:
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("DELETE FROM invoices WHERE order_id IN "
                             "(SELECT id FROM orders WHERE public_id = :o)"), {"o": public_id})
        for table in ("order_tax_lines", "payments", "order_lines"):
            await c.execute(text(f"DELETE FROM {table} WHERE order_id IN "
                                 "(SELECT id FROM orders WHERE public_id = :o)"), {"o": public_id})
        await c.execute(text("DELETE FROM orders WHERE public_id = :o"), {"o": public_id})


async def _one(sql: str, **params):
    eng = get_engine()
    async with eng.begin() as c:
        return (await c.execute(text(sql), params)).mappings().first()


async def _exec(sql: str, **params) -> None:
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text(sql), params)


async def _paid_order(client, h: dict, tag: str, *, price: int = 25000, cost: int = 15000) -> dict:
    """One real order taken to `paid` by the payment webhook, so its invoice was issued by the app."""
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("INSERT INTO brands (name, slug) VALUES (:n, :n)"
                             " ON CONFLICT (slug) DO NOTHING"), {"n": "mission-fin-brand"})
        await c.execute(text("INSERT INTO categories (name, slug) VALUES (:n, :n)"
                             " ON CONFLICT (slug) DO NOTHING"), {"n": "mission-fin-category"})
    r = await client.post("/staff/products", headers=h, json={
        "brand_slug": "mission-fin-brand", "category_slug": "mission-fin-category",
        "model": "Model " + tag[-6:], "title": tag + " finance", "slug": tag.lower() + "-fin"})
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
    r = await client.post("/store/checkout", json={"asset_ids": [aid], "shipping_country": "AU"})
    assert r.status_code == 200, r.text
    public_id = r.json()["order_public_id"]
    ref = (await client.post(f"/store/orders/{public_id}/pay")).json()["payment_ref"]
    s = get_settings()
    body = json.dumps({"ref": ref, "event": "payment.succeeded"})
    sig = hmac.new(s.PAYMENT_WEBHOOK_SECRET.encode(), body.encode(), hashlib.sha256).hexdigest()
    r = await client.post("/store/webhooks/payments/stub", content=body,
                          headers={"Content-Type": "application/json", "x-stub-signature": sig})
    assert r.status_code == 200 and r.json()["order"] == "paid", r.text
    row = await _one("SELECT id FROM orders WHERE public_id = :o", o=public_id)
    return {"order_public_id": public_id, "order_id": row["id"], "asset_id": aid, "product_id": pid}


async def _archive(pid: int) -> None:
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("UPDATE products SET status = 'archived' WHERE id = :i"), {"i": pid})


async def _pnl(client, h: dict) -> dict:
    today = date.today().isoformat()
    r = await client.get(f"/staff/finance/pnl?from={today}&to={today}", headers=h)
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------------------
# Invoices come from the sale
# ---------------------------------------------------------------------------
async def test_paying_an_order_issues_an_invoice_with_the_gst_kept_apart(client):
    h, email = await _staff(client)
    tag = "missionFin" + uuid.uuid4().hex[:10]
    fixture = None
    try:
        fixture = await _paid_order(client, h, tag, price=25000, cost=15000)
        inv = await _one("SELECT * FROM invoices WHERE order_id = :i", i=fixture["order_id"])
        assert inv is not None, "paying an order must issue its invoice"
        assert inv["status"] == "issued" and inv["number"].startswith("INV-"), dict(inv)
        assert inv["subtotal_cents"] == 25000, dict(inv)
        assert inv["tax_cents"] == 2500, "AU GST on 250.00 at the stored 10% rate: " + str(dict(inv))
        assert inv["total_cents"] == inv["subtotal_cents"] + inv["tax_cents"] + inv["shipping_cents"]
        assert inv["issued_on"] == date.today(), dict(inv)
    finally:
        if fixture:
            await _purge_order(fixture["order_public_id"])
            await _archive(fixture["product_id"])
        await _drop_staff(email)


async def test_issuing_the_same_invoice_again_returns_that_document(client):
    h, email = await _staff(client)
    tag = "missionFin" + uuid.uuid4().hex[:10]
    fixture = None
    try:
        fixture = await _paid_order(client, h, tag)
        first = (await client.get(f"/staff/finance/invoices?limit=200", headers=h)).json()["invoices"]
        mine = [i for i in first if i["order_id"] == fixture["order_id"]]
        assert len(mine) == 1, mine
        r = await client.post("/staff/finance/invoices", headers=h,
                              json={"order_id": fixture["order_id"]})
        assert r.status_code == 201, r.text
        assert r.json()["id"] == mine[0]["id"] and r.json()["number"] == mine[0]["number"], r.text
        n = await _one("SELECT count(*) AS n FROM invoices WHERE order_id = :i", i=fixture["order_id"])
        assert n["n"] == 1, "one sale, one document: " + str(dict(n))
    finally:
        if fixture:
            await _purge_order(fixture["order_public_id"])
            await _archive(fixture["product_id"])
        await _drop_staff(email)


async def test_the_invoice_ladder_is_one_way(client):
    h, email = await _staff(client)
    tag = "missionFin" + uuid.uuid4().hex[:10]
    fixture = None
    try:
        fixture = await _paid_order(client, h, tag)
        inv = await _one("SELECT id FROM invoices WHERE order_id = :i", i=fixture["order_id"])
        iid = inv["id"]

        r = await client.patch(f"/staff/finance/invoices/{iid}", headers=h, json={"status": "paid"})
        assert r.status_code == 200 and r.json()["status"] == "paid", r.text
        assert r.json()["paid_at"] is not None, r.text

        r = await client.patch(f"/staff/finance/invoices/{iid}", headers=h, json={"status": "issued"})
        assert r.status_code == 409, "a paid invoice must not go back to issued: " + r.text

        r = await client.patch(f"/staff/finance/invoices/{iid}", headers=h, json={"status": "nonsense"})
        assert r.status_code == 422, r.text
    finally:
        if fixture:
            await _purge_order(fixture["order_public_id"])
            await _archive(fixture["product_id"])
        await _drop_staff(email)


# ---------------------------------------------------------------------------
# Expenses
# ---------------------------------------------------------------------------
async def test_expenses_are_recorded_listed_and_filtered(client):
    h, email = await _staff(client)
    stamp = uuid.uuid4().hex[:10]
    ids = []
    try:
        for vendor, amount in (("Courier Co", 4200), ("Packaging Ltd", 1800)):
            r = await client.post("/staff/finance/expenses", headers=h, json={
                "category": "mission-freight-" + stamp, "vendor": vendor, "amount_cents": amount,
                "tax_cents": 0, "description": "mission finance", "paid": True})
            assert r.status_code == 201, r.text
            ids.append(r.json()["id"])
            assert r.json()["paid_at"] is not None and r.json()["amount_cents"] == amount, r.text

        body = (await client.get("/staff/finance/expenses"
                                 f"?category=mission-freight-{stamp}&limit=200", headers=h)).json()
        assert body["total"] == 2 and {e["vendor"] for e in body["expenses"]} == {"Courier Co",
                                                                                "Packaging Ltd"}

        r = await client.post("/staff/finance/expenses", headers=h,
                              json={"category": "  ", "amount_cents": 100})
        assert r.status_code == 422, r.text
        r = await client.post("/staff/finance/expenses", headers=h,
                              json={"category": "x", "amount_cents": -5})
        assert r.status_code == 422, r.text
    finally:
        eng = get_engine()
        async with eng.begin() as c:
            for i in ids:
                await c.execute(text("DELETE FROM expenses WHERE id = :i"), {"i": i})
        await _drop_staff(email)


# ---------------------------------------------------------------------------
# The P&L
# ---------------------------------------------------------------------------
async def test_the_pnl_nets_revenue_cogs_and_expenses(client):
    h, email = await _staff(client)
    tag = "missionFin" + uuid.uuid4().hex[:10]
    fixture, expense_id = None, None
    try:
        before = await _pnl(client, h)

        # One sale: 250.00 ex-GST, 25.00 GST collected, against a unit that cost 150.00.
        fixture = await _paid_order(client, h, tag, price=25000, cost=15000)
        after_sale = await _pnl(client, h)

        assert after_sale["revenue_cents"] - before["revenue_cents"] == 25000, after_sale
        assert after_sale["gst_collected_cents"] - before["gst_collected_cents"] == 2500, after_sale
        assert after_sale["cogs_cents"] - before["cogs_cents"] == 15000, after_sale
        assert after_sale["gross_profit_cents"] - before["gross_profit_cents"] == 10000, after_sale

        # GST is NOT revenue: the sale added 250.00 of income and 25.00 of tax, and only the first
        # moved the profit.
        assert after_sale["goods_cents"] - before["goods_cents"] == 25000, after_sale

        r = await client.post("/staff/finance/expenses", headers=h, json={
            "category": "mission-fin-pnl-" + tag[-6:], "amount_cents": 4000, "paid": True})
        assert r.status_code == 201, r.text
        expense_id = r.json()["id"]
        after_spend = await _pnl(client, h)

        assert after_spend["expenses_cents"] - after_sale["expenses_cents"] == 4000, after_spend
        assert after_spend["net_profit_cents"] == (after_spend["gross_profit_cents"]
                                                   - after_spend["expenses_cents"]), after_spend

        # The identity that must hold whatever else the shop traded that day.
        assert after_spend["net_profit_cents"] == (after_spend["revenue_cents"]
                                                   - after_spend["cogs_cents"]
                                                   - after_spend["expenses_cents"]), after_spend
    finally:
        if expense_id is not None:
            await _exec("DELETE FROM expenses WHERE id = :i", i=expense_id)
        if fixture:
            await _purge_order(fixture["order_public_id"])
            await _archive(fixture["product_id"])
        await _drop_staff(email)


async def test_a_void_invoice_is_not_income(client):
    h, email = await _staff(client)
    tag = "missionFin" + uuid.uuid4().hex[:10]
    fixture = None
    try:
        fixture = await _paid_order(client, h, tag, price=25000, cost=15000)
        inv = await _one("SELECT id FROM invoices WHERE order_id = :i", i=fixture["order_id"])
        with_income = await _pnl(client, h)

        r = await client.patch(f"/staff/finance/invoices/{inv['id']}", headers=h,
                               json={"status": "void"})
        assert r.status_code == 200, r.text
        voided = await _pnl(client, h)
        assert with_income["revenue_cents"] - voided["revenue_cents"] == 25000, voided
        assert with_income["goods_cents"] - voided["goods_cents"] == 25000, voided
    finally:
        if fixture:
            await _purge_order(fixture["order_public_id"])
            await _archive(fixture["product_id"])
        await _drop_staff(email)


# ---------------------------------------------------------------------------
# Who may touch the books
# ---------------------------------------------------------------------------
async def test_the_books_are_admin_only(client):
    """READS AND WRITES ARE ADMIN. The statement of what the business earned and spent is the
    owner's alone: a manager runs the shop but does not read the books, and no other role - nor an
    anonymous caller - reaches them at all. A report a manager can read is a report a manager can be
    asked to explain, which is the line this pins."""
    h, email = await _staff(client)
    others = [(await _staff(client, role)) for role in ("manager", "warehouse", "sales", "technician")]
    try:
        for path in ("/staff/finance/invoices", "/staff/finance/expenses", "/staff/finance/pnl"):
            assert (await client.get(path, headers=h)).status_code == 200, path
            # No credential is a 401 - there is no identity to refuse - and every staff role that is
            # not the admin is a 403 on the READS as much as on the writes.
            assert (await client.get(path)).status_code == 401, "anonymous: " + path
            for tok, who in others:
                r = await client.get(path, headers=tok)
                assert r.status_code == 403, f"{who} must not read {path} (got {r.status_code})"

        for tok, who in others:
            r = await client.post("/staff/finance/expenses", headers=tok,
                                  json={"category": "nope", "amount_cents": 100})
            assert r.status_code == 403, f"{who} must not write the books: " + r.text
    finally:
        await _drop_staff(email)
        for _, other_email in others:
            await _drop_staff(other_email)
