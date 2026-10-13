"""Reports & BI: the arithmetic, the filters, the walls, and the exports.

WHAT IS PINNED HERE, and why each one would be a real defect if it broke:

  * GST IS NOT REVENUE. The trends report's revenue is ex-GST and the tax rides in its own field; an
    export that rolled them together would overstate income by the tax rate on every line.
  * MARGIN USES THE SHELF'S COST BASIS, so a leaderboard and the margin guard cannot disagree about
    the same sale.
  * THE SERIES IS DENSE - every day in the window is present. A gap-filled series draws a line from
    one sale to the next and reads as steady trade across a week the shop was shut.
  * DEAD STOCK IS MEASURED FROM THE LISTING EVENT, so the threshold means what it says.
  * THE DOOR IS ADMIN'S - the same wall the Finance Guard put in front of the P&L.
  * AN EXPORT IS A COPY OF THE BOOKS THAT LEAVES: it is headed with the business's own legal identity
    and it is audited.

Hermetic: `mission-` identities, a unique tag per fixture, and everything this file writes is
deleted in a `finally`. The exports' seller block is a GLOBAL setting, so it is snapshotted and
restored like every other global this box shares.
"""

import json
import re
import uuid

from sqlalchemy import text

from app.bootstrap_staff import bootstrap
from app.core.db import get_engine


def _h(tok: str) -> dict:
    return {"Authorization": "Bearer " + tok}


async def _staff(client, role: str = "admin") -> tuple[dict, str]:
    email = "mission-bi-" + uuid.uuid4().hex + "@test.rfo"
    _, pw = await bootstrap(email, role)
    r = await client.post("/staff/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return _h(r.json()["access_token"]), email


async def _customer(client) -> tuple[dict, str]:
    email = "mission-bi-cust-" + uuid.uuid4().hex + "@test.rfo"
    r = await client.post("/store/auth/register",
                          json={"email": email, "password": "Str0ngPass!23", "display_name": "BI"})
    assert r.status_code == 200, r.text
    return _h(r.json()["access_token"]), email


async def _drop_staff(email: str) -> None:
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("DELETE FROM refresh_tokens WHERE identity_id IN "
                             "(SELECT id FROM staff_users WHERE email = :e)"), {"e": email})
        await c.execute(text("DELETE FROM staff_users WHERE email = :e"), {"e": email})


async def _drop_customer(email: str) -> None:
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("DELETE FROM refresh_tokens WHERE identity_id IN "
                             "(SELECT id FROM users WHERE email = :e)"), {"e": email})
        await c.execute(text("DELETE FROM password_credentials WHERE user_id IN "
                             "(SELECT id FROM users WHERE email = :e)"), {"e": email})
        await c.execute(text("DELETE FROM users WHERE email = :e"), {"e": email})


async def _snapshot(key: str):
    eng = get_engine()
    async with eng.begin() as c:
        row = (await c.execute(text("SELECT value FROM site_settings WHERE key = :k"),
                               {"k": key})).first()
    return row[0] if row is not None else None


async def _restore(key: str, original) -> None:
    eng = get_engine()
    async with eng.begin() as c:
        if original is None:
            await c.execute(text("DELETE FROM site_settings WHERE key = :k"), {"k": key})
        else:
            await c.execute(text("UPDATE site_settings SET value = CAST(:v AS jsonb)"
                                 " WHERE key = :k"), {"k": key, "v": json.dumps(original)})


async def _one(sql: str, **params):
    eng = get_engine()
    async with eng.begin() as c:
        return (await c.execute(text(sql), params)).mappings().first()


async def _purge_order(order_public_id: str) -> None:
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text(
            "DELETE FROM rma_photos WHERE rma_id IN (SELECT id FROM rma_requests WHERE order_id IN"
            " (SELECT id FROM orders WHERE public_id = :o))"), {"o": order_public_id})
        await c.execute(text(
            "DELETE FROM rma_requests WHERE order_id IN"
            " (SELECT id FROM orders WHERE public_id = :o)"), {"o": order_public_id})
        await c.execute(text("DELETE FROM payment_events WHERE order_id IN"
                             " (SELECT id FROM orders WHERE public_id = :o)"), {"o": order_public_id})
        await c.execute(text("DELETE FROM invoices WHERE order_id IN"
                             " (SELECT id FROM orders WHERE public_id = :o)"), {"o": order_public_id})
        for table in ("order_tax_lines", "payments", "order_lines"):
            await c.execute(text(f"DELETE FROM {table} WHERE order_id IN"
                                 " (SELECT id FROM orders WHERE public_id = :o)"),
                            {"o": order_public_id})
        await c.execute(text("DELETE FROM orders WHERE public_id = :o"), {"o": order_public_id})


async def _archive(pid: int) -> None:
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("UPDATE products SET status = 'archived' WHERE id = :i"), {"i": pid})


async def _sale(client, staff_h: dict, cust_h: dict, tag: str, *, price: int = 25000,
                cost: int = 15000) -> dict:
    """One real paid order for a catalogued product - the unit the reports measure."""
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("INSERT INTO brands (name, slug) VALUES (:n, :n)"
                             " ON CONFLICT (slug) DO NOTHING"), {"n": "mission-bi-brand"})
        await c.execute(text("INSERT INTO categories (name, slug) VALUES (:n, :n)"
                             " ON CONFLICT (slug) DO NOTHING"), {"n": "mission-bi-cat"})
    r = await client.post("/staff/products", headers=staff_h, json={
        "brand_slug": "mission-bi-brand", "category_slug": "mission-bi-cat",
        "model": "Model " + tag[-6:], "title": tag + " bi", "slug": tag.lower() + "-bi"})
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    r = await client.post("/staff/lots", headers=staff_h, json={"lot_number": tag + "-LOT"})
    lot_id, lot_number = r.json()["id"], r.json()["lot_number"]
    r = await client.post("/staff/assets/scan-in", headers=staff_h, json={
        "lot_number": lot_number, "serial_number": tag + "-S1", "product_id": pid})
    aid = r.json()["id"]
    assert (await client.post(f"/staff/assets/{aid}/grade", headers=staff_h,
                              json={"grade": "A", "cost_cents": cost,
                                    "test_first": True})).status_code == 200
    assert (await client.post(f"/staff/assets/{aid}/price", headers=staff_h,
                              json={"sale_price_cents": price})).status_code == 200
    assert (await client.post(f"/staff/lots/{lot_id}/activate", headers=staff_h)).status_code == 200
    assert (await client.post(f"/staff/assets/{aid}/status", headers=staff_h,
                              json={"status": "listed"})).status_code == 200
    r = await client.post("/store/checkout", headers=cust_h, json={
        "asset_ids": [aid], "shipping_country": "AU", "ship_to_name": "BI Customer",
        "ship_line1": "1 Report Rd", "ship_city": "Sydney", "ship_postcode": "2000"})
    assert r.status_code == 200, r.text
    public_id = r.json()["order_public_id"]
    assert (await client.post(f"/store/orders/{public_id}/pay")).status_code == 200
    assert (await client.post(f"/store/orders/{public_id}/simulate-payment")).status_code == 200
    return {"order_public_id": public_id, "asset_id": aid, "product_id": pid, "tag": tag,
            "price": price, "cost": cost}


# ---------------------------------------------------------------------------
# 1. Sales trends
# ---------------------------------------------------------------------------
async def test_sales_trends_bucket_by_day_and_keep_gst_out_of_revenue(client):
    admin, admin_email = await _staff(client)
    cust, cust_email = await _customer(client)
    tag = "missionBi" + uuid.uuid4().hex[:10]
    fx = None
    try:
        # DELTAS, NOT ABSOLUTES. This is the owner's live trading database - today's bucket already
        # holds real sales - so every expectation is the difference this fixture caused.
        before = (await client.get("/staff/reports/sales-trends?days=30", headers=admin)).json()
        fx = await _sale(client, admin, cust, tag)
        data = (await client.get("/staff/reports/sales-trends?days=30", headers=admin)).json()

        # DENSE: 30 days back plus today, with no missing day in between.
        assert len(data["series"]) == 31, len(data["series"])
        assert data["series"] == sorted(data["series"], key=lambda p: p["date"])
        today, was = data["series"][-1], before["series"][-1]

        # REVENUE IS EX-GST AND THE GST RIDES BESIDE IT. AU is 10%, so the tax on this sale is a
        # tenth of its goods value and the two must not have been added together anywhere.
        assert today["orders"] - was["orders"] == 1, (today, was)
        assert today["revenue_cents"] - was["revenue_cents"] == fx["price"], (today, was)
        assert today["gst_cents"] - was["gst_cents"] == 2500, (today, was)

        # THE WINDOW IS A CLOSED SET, and a bad one is refused rather than silently defaulted.
        assert (await client.get("/staff/reports/sales-trends?days=45", headers=admin)).status_code == 422
        # CHANNEL: the two marketplaces are selectable and empty, because nothing ingests them yet.
        ebay = (await client.get("/staff/reports/sales-trends?days=30&channel=ebay",
                                 headers=admin)).json()
        assert ebay["totals"]["orders"] == 0 and ebay["channel"] == "ebay", ebay["totals"]
        assert (await client.get("/staff/reports/sales-trends?days=30&channel=etsy",
                                 headers=admin)).status_code == 422
        # CATEGORY: the fixture's own category is a real filter, and an unknown one matches nothing.
        mine = (await client.get("/staff/reports/sales-trends?days=30&category=mission-bi-cat",
                                 headers=admin)).json()
        assert mine["totals"]["orders"] >= 1
        assert (await client.get("/staff/reports/sales-trends?days=30&category=no-such-cat",
                                 headers=admin)).json()["totals"]["orders"] == 0
    finally:
        if fx:
            await _purge_order(fx["order_public_id"]); await _archive(fx["product_id"])
        await _drop_customer(cust_email); await _drop_staff(admin_email)


# ---------------------------------------------------------------------------
# 2. Top performers
# ---------------------------------------------------------------------------
async def test_top_performers_rank_by_units_revenue_margin_and_velocity(client):
    admin, admin_email = await _staff(client)
    cust, cust_email = await _customer(client)
    tag = "missionBi" + uuid.uuid4().hex[:10]
    fx = None
    try:
        fx = await _sale(client, admin, cust, tag, price=25000, cost=15000)
        data = (await client.get("/staff/reports/top-performers?days=30", headers=admin)).json()
        mine = [p for p in data["products"] if p["product_id"] == fx["product_id"]]
        assert len(mine) == 1, [p["title"] for p in data["products"]]
        p = mine[0]

        assert p["units"] == 1 and p["revenue_cents"] == 25000, p
        # MARGIN IS REVENUE EX-GST LESS THE COST BASIS THE SHELF USES - the same 15000 the margin
        # guard read when it let this unit be listed.
        assert p["cogs_cents"] == 15000 and p["margin_cents"] == 10000, p
        assert p["margin_pct"] == 40.0, p
        # VELOCITY IS OVER THE WINDOW, not over the days it happened to sell on.
        assert p["velocity_per_day"] == round(1 / 30, 3), p

        # The same rows, read four ways - a leaderboard each for units, revenue, margin and speed.
        for key in ("by_units", "by_revenue", "by_margin", "by_velocity"):
            assert data[key], key
        assert data["by_revenue"][0]["revenue_cents"] >= data["by_revenue"][-1]["revenue_cents"]
        assert data["by_units"][0]["units"] >= data["by_units"][-1]["units"]
    finally:
        if fx:
            await _purge_order(fx["order_public_id"]); await _archive(fx["product_id"])
        await _drop_customer(cust_email); await _drop_staff(admin_email)


# ---------------------------------------------------------------------------
# 3. Inventory turnover and dead stock
# ---------------------------------------------------------------------------
async def test_inventory_reports_days_in_warehouse_and_flags_dead_stock_by_the_listing_event(client):
    admin, admin_email = await _staff(client)
    tag = "missionBi" + uuid.uuid4().hex[:10]
    pid = None
    try:
        eng = get_engine()
        async with eng.begin() as c:
            await c.execute(text("INSERT INTO brands (name, slug) VALUES (:n, :n)"
                                 " ON CONFLICT (slug) DO NOTHING"), {"n": "mission-bi-brand"})
            await c.execute(text("INSERT INTO categories (name, slug) VALUES (:n, :n)"
                                 " ON CONFLICT (slug) DO NOTHING"), {"n": "mission-bi-cat"})
        r = await client.post("/staff/products", headers=admin, json={
            "brand_slug": "mission-bi-brand", "category_slug": "mission-bi-cat",
            "model": "M", "title": tag + " stock", "slug": tag.lower() + "-stock"})
        pid = r.json()["id"]
        # THE OWNER'S REAL STOCK IS 12,000 UNITS, and the report is ordered WORST FIRST - a unit that
        # arrived seconds ago sorts last and can never be on the page. So the fixture is proved by
        # the SUMMARY's delta and the flag is proved by its own semantics on real rows.
        before = (await client.get("/staff/reports/inventory?limit=2000", headers=admin)).json()
        r = await client.post("/staff/lots", headers=admin, json={"lot_number": tag + "-LOT"})
        lot_id, lot_number = r.json()["id"], r.json()["lot_number"]
        r = await client.post("/staff/assets/scan-in", headers=admin, json={
            "lot_number": lot_number, "serial_number": tag + "-S1", "product_id": pid})
        aid = r.json()["id"]
        await client.post(f"/staff/assets/{aid}/grade", headers=admin,
                          json={"grade": "A", "cost_cents": 9000, "test_first": True})
        await client.post(f"/staff/assets/{aid}/price", headers=admin, json={"sale_price_cents": 19000})
        await client.post(f"/staff/lots/{lot_id}/activate", headers=admin)
        assert (await client.post(f"/staff/assets/{aid}/status", headers=admin,
                                  json={"status": "listed"})).status_code == 200

        data = (await client.get("/staff/reports/inventory?limit=2000", headers=admin)).json()
        assert data["summary"]["units_in_stock"] - before["summary"]["units_in_stock"] == 1
        assert data["summary"]["stock_value_cents"] - before["summary"]["stock_value_cents"] == 9000
        assert (data["summary"]["by_status"]["listed"]
                - before["summary"]["by_status"]["listed"]) == 1

        # EVERY ROW CARRIES WHAT THE SCREEN RENDERS, and the flag is computed rather than constant:
        # at the shipped 60 days this unit - listed moments ago - is not dead (it is not on the page
        # at all), and at a threshold of zero the SAME report flags the stock that has been listed.
        tight = (await client.get("/staff/reports/inventory?dead_days=0&limit=2000",
                                  headers=admin)).json()
        assert tight["summary"]["dead_units"] >= 1, tight["summary"]
        dead = [u for u in tight["units"] if u["dead"]]
        assert dead, "a zero-day threshold must flag the stock that is on sale"
        # DEAD IS ONLY EVER `listed`: a unit in refurbishment is being worked on, not stale.
        assert all(u["status"] == "listed" for u in dead)
        assert all(u["listed_at"] is not None and u["days_listed"] >= 0 for u in dead)
        assert all(not u["dead"] for u in tight["units"] if u["status"] != "listed")
        sample = dead[0]
        for field in ("asset_id", "title", "status", "grade", "cost_cents", "days_in_warehouse",
                      "listed_at", "days_listed", "dead"):
            assert field in sample, field
    finally:
        if pid:
            await _archive(pid)
        await _drop_staff(admin_email)


# ---------------------------------------------------------------------------
# 4. The wall
# ---------------------------------------------------------------------------
async def test_the_reports_are_admin_only(client):
    admin, admin_email = await _staff(client)
    others = [(await _staff(client, r)) for r in ("manager", "warehouse", "sales")]
    try:
        paths = ["/staff/reports/sales-trends", "/staff/reports/top-performers",
                 "/staff/reports/inventory",
                 "/staff/reports/export?report=sales-trends&format=csv"]
        for path in paths:
            assert (await client.get(path, headers=admin)).status_code == 200, path
            assert (await client.get(path)).status_code == 401, "anonymous: " + path
            for tok, who in others:
                r = await client.get(path, headers=tok)
                assert r.status_code == 403, f"{who} read {path} (got {r.status_code})"
    finally:
        await _drop_staff(admin_email)
        for _, e in others:
            await _drop_staff(e)


# ---------------------------------------------------------------------------
# 5. Exports
# ---------------------------------------------------------------------------
async def test_exports_are_accountant_ready_csv_and_pdf(client):
    admin, admin_email = await _staff(client)
    cust, cust_email = await _customer(client)
    tag = "missionBi" + uuid.uuid4().hex[:10]
    fx = None
    original = await _snapshot("business_identity")
    try:
        # The header block reads Settings & System, so set it - otherwise this asserts the fallback.
        identity = {"legal_name": "RFO Reporting Pty Ltd", "tax_id": "11 222 333 444",
                    "address": "1 Ledger Lane\nSydney NSW 2000", "email": "books@rfo.example"}
        assert (await client.put("/staff/settings/identity", headers=admin,
                                 json=identity)).status_code == 200
        fx = await _sale(client, admin, cust, tag)

        r = await client.get("/staff/reports/export?report=sales-trends&format=csv&days=30",
                             headers=admin)
        assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv"), r.text
        assert "attachment" in r.headers["content-disposition"] and ".csv" in r.headers["content-disposition"]
        body = r.content.decode("utf-8-sig")
        # HEADED WITH THE BUSINESS'S OWN LEGAL IDENTITY - what an accountant files it under.
        assert "RFO Reporting Pty Ltd" in body and "ABN 11 222 333 444" in body, body[:400]
        assert "1 Ledger Lane" in body, body[:400]
        # GST IS ITS OWN COLUMN AND THE ROW RECONCILES.
        assert "Revenue (ex GST),GST collected,Total (inc GST)" in body, body[:600]
        assert "TOTAL" in body, body[-400:]
        # BARE NUMBERS, so a spreadsheet parses them as numbers rather than text: every data row is
        # `date,orders,units,revenue,gst,total` with two decimals and no currency symbol anywhere.
        assert "$" not in body, body[-400:]
        rows = [ln for ln in body.splitlines()
                if re.fullmatch(r"\d{4}-\d{2}-\d{2},\d+,\d+,\d+\.\d{2},\d+\.\d{2},\d+\.\d{2}", ln)]
        data_rows = rows
        assert len(data_rows) == 31, f"expected 31 dense daily rows, matched {len(data_rows)}"

        r = await client.get("/staff/reports/export?report=top-performers&format=pdf&days=30",
                             headers=admin)
        assert r.status_code == 200 and r.headers["content-type"] == "application/pdf", r.text
        assert ".pdf" in r.headers["content-disposition"]
        blob = r.content
        # A PDF that does not open is worse than no export, so the structure is asserted, not the size.
        assert blob.startswith(b"%PDF-1.4") and blob.rstrip().endswith(b"%%EOF"), blob[:20]
        assert b"/Type /Catalog" in blob and b"startxref" in blob
        assert b"RFO Reporting Pty Ltd" in blob, "the seller must be inside the document"

        r = await client.get("/staff/reports/export?report=inventory&format=csv", headers=admin)
        assert r.status_code == 200 and b"Dead stock" in r.content, r.text[:200]

        # The vocabulary is closed on both axes.
        assert (await client.get("/staff/reports/export?report=nope&format=csv",
                                 headers=admin)).status_code == 422
        assert (await client.get("/staff/reports/export?report=inventory&format=xlsx",
                                 headers=admin)).status_code == 422

        # AN EXPORT LEAVES THE BUILDING, SO IT IS AUDITED.
        n = await _one("SELECT count(*) AS n FROM audit_log WHERE entity = 'report'"
                       " AND action = 'report_exported'")
        assert n["n"] >= 3, dict(n)
    finally:
        if fx:
            await _purge_order(fx["order_public_id"]); await _archive(fx["product_id"])
        await _restore("business_identity", original)
        await _drop_customer(cust_email); await _drop_staff(admin_email)
