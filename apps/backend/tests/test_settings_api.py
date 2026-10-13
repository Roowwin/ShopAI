"""The Settings API: tax rates (live), general config, third-party API keys, and the business's own
legal identity.

The load-bearing test here is `test_a_stored_tax_rate_drives_the_checkout_total`: a rate set through
the API must change the GST on a real order AND appear as the rate on that order's tax line, which is
what makes the total and the setting one fact instead of two that can drift.

The identity tests pin the other half of that idea: what Settings & System saves is what a tax
invoice PRINTS, so the assertion runs end to end - write the identity, take a real order to paid, and
read the seller block back off the invoice document the print screen renders.

Settings live in shared, global rows, so every test that writes one SNAPSHOTS it first and RESTORES
it in a `finally` - a leaked tax rate would misprice every other test on the box, and a leaked legal
name would print on somebody else's document.
"""
import hashlib
import hmac
import json
import uuid

from sqlalchemy import text

from app.bootstrap_staff import bootstrap
from app.core.config import get_settings
from app.core.db import get_engine


def _h(tok: str) -> dict:
    return {"Authorization": "Bearer " + tok}


# This file's own brand and category: `create_product` refuses an unknown slug, and the demo
# catalogue's brands are the owner's hand-created stock, which a freshly migrated (or busy shared)
# database does not have. Created idempotently, so the checkout fixtures never depend on it.
BRAND = "mission-settings-brand"
CATEGORY = "mission-settings-category"


async def _ensure_brand_category() -> None:
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("INSERT INTO brands (name, slug) VALUES (:n, :s)"
                             " ON CONFLICT (slug) DO NOTHING"), {"n": BRAND, "s": BRAND})
        await c.execute(text("INSERT INTO categories (name, slug) VALUES (:n, :s)"
                             " ON CONFLICT (slug) DO NOTHING"), {"n": CATEGORY, "s": CATEGORY})


async def _staff(client, role: str = "admin") -> tuple[dict, str]:
    # DELIBERATELY NOT the repo's usual "pytest-" prefix - see the note in test_margin_guard. A
    # concurrent run's `DELETE ... WHERE email LIKE 'pytest-%'` teardown would otherwise delete this
    # test's identity mid-flight and turn a real assertion into a 401.
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


async def _snapshot(key: str):
    eng = get_engine()
    async with eng.begin() as c:
        row = (await c.execute(text("SELECT value FROM site_settings WHERE key = :k"), {"k": key})).first()
    return row[0] if row is not None else None


async def _restore(key: str, original) -> None:
    eng = get_engine()
    async with eng.begin() as c:
        if original is None:
            await c.execute(text("DELETE FROM site_settings WHERE key = :k"), {"k": key})
        else:
            await c.execute(text("UPDATE site_settings SET value = CAST(:v AS jsonb) WHERE key = :k"),
                            {"k": key, "v": json.dumps(original)})


async def _listed_unit(client, h: dict, *, slug: str, price: int) -> tuple[int, int]:
    await _ensure_brand_category()
    r = await client.post("/staff/products", headers=h, json={
        "brand_slug": BRAND, "category_slug": CATEGORY, "model": "Pytest settings device",
        "title": "Pytest settings " + slug, "slug": slug})
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    r = await client.post("/staff/lots", headers=h, json={"notes": "pytest settings"})
    lot_id, lot_number = r.json()["id"], r.json()["lot_number"]
    r = await client.post("/staff/assets/scan-in", headers=h, json={
        "serial_number": "mission-settings-" + uuid.uuid4().hex[:10], "lot_number": lot_number,
        "product_id": pid})
    aid = r.json()["id"]
    assert (await client.post(f"/staff/assets/{aid}/grade", headers=h,
                              json={"grade": "A", "test_first": True})).status_code == 200
    assert (await client.post(f"/staff/assets/{aid}/price", headers=h,
                              json={"sale_price_cents": price})).status_code == 200
    assert (await client.post(f"/staff/lots/{lot_id}/activate", headers=h)).status_code == 200
    assert (await client.post(f"/staff/assets/{aid}/status", headers=h,
                              json={"status": "listed"})).status_code == 200
    return pid, aid


async def _archive(pid: int) -> None:
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("UPDATE products SET status = 'archived' WHERE id = :i"), {"i": pid})


# ---------------------------------------------------------------------------
# Tax rates: stored, served, and - the point - LIVING in the checkout
# ---------------------------------------------------------------------------
async def test_a_stored_tax_rate_drives_the_checkout_total(client):
    h, email = await _staff(client)
    original = await _snapshot("tax_rates")
    slug = "mission-settings-tax-" + uuid.uuid4().hex[:8]
    pid = None
    try:
        r = await client.put("/staff/settings/tax-rates", headers=h, json={"rates": {
            "AU": {"jurisdiction": "AU_GST", "rate_bp": 2000},
            "NZ": {"jurisdiction": "NZ_GST", "rate_bp": 1500}}})
        assert r.status_code == 200, r.text
        assert r.json()["tax_rates"]["AU"]["rate_bp"] == 2000

        # The READ door must show the same number the checkout will use.
        assert (await client.get("/staff/settings/tax-rates", headers=h)).json()["tax_rates"]["AU"]["rate_bp"] == 2000

        pid, aid = await _listed_unit(client, h, slug=slug, price=10000)
        r = await client.post("/store/checkout", json={"asset_ids": [aid], "shipping_country": "AU"})
        assert r.status_code == 200, r.text
        out = r.json()
        assert out["subtotal_cents"] == 10000, out
        assert out["tax_cents"] == 2000, "20% of 10000 must be the STORED rate: " + str(out)
        assert out["total_cents"] == 12000, out

        # ...and the order's own tax line carries that rate, so the total and the setting agree.
        eng = get_engine()
        async with eng.begin() as c:
            row = (await c.execute(text(
                "SELECT t.rate_bp, t.jurisdiction, o.tax_cents FROM order_tax_lines t "
                "JOIN orders o ON o.id = t.order_id WHERE o.public_id = :p"),
                {"p": out["order_public_id"]})).mappings().first()
        assert row["rate_bp"] == 2000 and row["jurisdiction"] == "AU_GST", dict(row)
        assert row["tax_cents"] == 2000, dict(row)
    finally:
        await _restore("tax_rates", original)
        if pid:
            await _archive(pid)
        await _drop_staff(email)


async def test_a_missing_tax_rate_falls_back_to_the_shipped_default(client):
    """No stored row must never mean a 500 - the checkout prices from the shipped NZ 15%."""
    h, email = await _staff(client)
    original = await _snapshot("tax_rates")
    slug = "mission-settings-fb-" + uuid.uuid4().hex[:8]
    pid = None
    try:
        eng = get_engine()
        async with eng.begin() as c:
            await c.execute(text("DELETE FROM site_settings WHERE key = 'tax_rates'"))

        pid, aid = await _listed_unit(client, h, slug=slug, price=10000)
        r = await client.post("/store/checkout", json={"asset_ids": [aid], "shipping_country": "NZ"})
        assert r.status_code == 200, r.text
        assert r.json()["tax_cents"] == 1500, r.json()
    finally:
        await _restore("tax_rates", original)
        if pid:
            await _archive(pid)
        await _drop_staff(email)


async def test_a_malformed_tax_rate_is_refused(client):
    h, email = await _staff(client)
    try:
        for rates in ({"US": {"rate_bp": 1000}},                       # a country we do not ship to
                      {"AU": {"rate_bp": "lots"}},                       # not a number
                      {"AU": {"rate_bp": -1}},                           # negative
                      {"AU": {"rate_bp": 10001}},                        # over 100%
                      {"AU": {"rate_bp": 1000, "jurisdiction": "nope"}},  # bad label shape
                      {}):                                               # empty document
            r = await client.put("/staff/settings/tax-rates", headers=h, json={"rates": rates})
            assert r.status_code == 422, (rates, r.status_code, r.text)
    finally:
        await _drop_staff(email)


# ---------------------------------------------------------------------------
# General system config
# ---------------------------------------------------------------------------
async def test_system_config_round_trips_and_merges(client):
    h, email = await _staff(client)
    original = await _snapshot("system_config")
    try:
        r = await client.put("/staff/settings/config", headers=h,
                             json={"values": {"company_name": "RFO", "support_email": "help@rfo.test"}})
        assert r.status_code == 200, r.text
        assert r.json()["config"]["company_name"] == "RFO"

        # A second patch MERGES rather than replacing the document.
        r = await client.put("/staff/settings/config", headers=h,
                             json={"values": {"support_email": None, "gst_registered": True}})
        cfg = r.json()["config"]
        assert cfg == {"company_name": "RFO", "gst_registered": True}, cfg

        # The root read shows the same config document the dedicated door does.
        assert (await client.get("/staff/settings", headers=h)).json()["config"] == cfg
        got = (await client.get("/staff/settings/config", headers=h)).json()["config"]
        assert got == cfg, got
    finally:
        await _restore("system_config", original)
        await _drop_staff(email)


# ---------------------------------------------------------------------------
# API keys: stored whole, returned MASKED, never revealed
# ---------------------------------------------------------------------------
async def test_an_api_key_is_stored_and_only_ever_returned_masked(client):
    h, email = await _staff(client)
    original = await _snapshot("api_keys")
    secret = "sk-live-" + uuid.uuid4().hex
    try:
        r = await client.post("/staff/settings/api-keys", headers=h, json={
            "provider": "stripe", "label": "Live payments", "secret": secret, "scopes": ["charges"]})
        assert r.status_code == 201, r.text
        created = r.json()
        assert created["masked"] == secret[:4] + "…" + secret[-4:], created
        assert "secret" not in created, "the create response must not echo the secret"

        listed = (await client.get("/staff/settings/api-keys", headers=h)).json()["api_keys"]
        entry = next(k for k in listed if k["id"] == created["id"])
        assert entry["is_active"] is True and entry["provider"] == "stripe"
        assert "secret" not in entry, entry
        assert secret not in json.dumps(listed), "the raw secret must never appear in a list response"

        r = await client.delete(f"/staff/settings/api-keys/{created['id']}", headers=h)
        assert r.status_code == 200 and r.json()["is_active"] is False, r.text
        assert (await client.delete(f"/staff/settings/api-keys/{created['id']}", headers=h)).status_code == 404
        assert (await client.delete("/staff/settings/api-keys/deadbeef", headers=h)).status_code == 404
    finally:
        await _restore("api_keys", original)
        await _drop_staff(email)


async def test_a_weak_api_key_is_refused(client):
    h, email = await _staff(client)
    original = await _snapshot("api_keys")
    try:
        for body in ({"provider": "Not A Slug", "secret": "abcdefgh"},
                     {"provider": "stripe", "secret": "short"}):
            r = await client.post("/staff/settings/api-keys", headers=h, json=body)
            assert r.status_code == 422, (body, r.status_code, r.text)
    finally:
        await _restore("api_keys", original)
        await _drop_staff(email)


# ---------------------------------------------------------------------------
# RBAC: reads are admin/manager, every write is admin, and the door is shut without a token
# ---------------------------------------------------------------------------
async def test_settings_reads_are_manager_but_writes_are_admin(client):
    h_admin, admin_email = await _staff(client, "admin")
    h_mgr, mgr_email = await _staff(client, "manager")
    original = await _snapshot("tax_rates")
    try:
        assert (await client.get("/staff/settings", headers=h_mgr)).status_code == 200
        r = await client.put("/staff/settings/tax-rates", headers=h_mgr,
                             json={"rates": {"AU": {"rate_bp": 1000}}})
        assert r.status_code == 403, "a manager must not set a tax rate: " + r.text
        r = await client.post("/staff/settings/api-keys", headers=h_mgr,
                              json={"provider": "stripe", "secret": "abcdefghij"})
        assert r.status_code == 403, "a manager must not add a credential: " + r.text
        assert (await client.get("/staff/settings/api-keys", headers=h_mgr)).status_code == 403

        assert (await client.get("/staff/settings")).status_code == 401
        assert (await client.get("/staff/settings/tax-rates")).status_code == 401
    finally:
        await _restore("tax_rates", original)
        await _drop_staff(admin_email)
        await _drop_staff(mgr_email)


# ---------------------------------------------------------------------------
# The business's own legal identity: stored, validated, and PRINTED
# ---------------------------------------------------------------------------
async def test_the_business_identity_round_trips_and_refuses_a_bad_one(client):
    """The write is strict where the read is total: a nameless seller or a malformed ABN is refused
    with a reason, because this is what a customer's tax document will say."""
    h, email = await _staff(client)
    original = await _snapshot("business_identity")
    try:
        good = {"legal_name": "RFO Pty Ltd", "tax_id": "12 345 678 901",
                "address": "1 Example St\nSydney NSW 2000", "email": "accounts@rfo.example"}
        r = await client.put("/staff/settings/identity", headers=h, json=good)
        assert r.status_code == 200, r.text
        assert r.json()["identity"] == good, r.text

        # It comes back on both reads: the dedicated one and the Settings page's root payload.
        assert (await client.get("/staff/settings/identity", headers=h)).json()["identity"] == good
        assert (await client.get("/staff/settings", headers=h)).json()["identity"] == good

        # THE LEGAL NAME IS REQUIRED - an invoice that does not name its seller is not a tax invoice.
        r = await client.put("/staff/settings/identity", headers=h,
                             json={**good, "legal_name": "   "})
        assert r.status_code == 422 and "legal_name" in r.json()["detail"], r.text
        # ... and the two formats a document would misprint are refused rather than stored.
        for bad in ({**good, "tax_id": "not-a-number"}, {**good, "email": "nope"}):
            r = await client.put("/staff/settings/identity", headers=h, json=bad)
            assert r.status_code == 422, (bad, r.status_code, r.text)
    finally:
        await _restore("business_identity", original)
        await _drop_staff(email)


async def test_an_invoice_names_the_business_the_settings_store_holds(client):
    """END TO END. What Settings & System saves is what the invoice document PRINTS as its seller -
    the one block on that page the platform cannot derive from the sale."""
    h, email = await _staff(client)
    original = await _snapshot("business_identity")
    pid = aid = None
    public_id = None
    try:
        identity = {"legal_name": "RFO Legal Pty Ltd", "tax_id": "98 765 432 109",
                    "address": "9 Seller Rd\nMelbourne VIC 3000", "email": "billing@rfo.example"}
        assert (await client.put("/staff/settings/identity", headers=h,
                                 json=identity)).status_code == 200

        pid, aid = await _listed_unit(client, h, slug="mission-identity-" + uuid.uuid4().hex[:8],
                                      price=25000)
        r = await client.post("/store/checkout", json={
            "asset_ids": [aid], "shipping_country": "AU", "ship_to_name": "T", "ship_line1": "1 St",
            "ship_city": "Sydney", "ship_postcode": "2000"})
        assert r.status_code == 200, r.text
        public_id = r.json()["order_public_id"]
        # Initiate the charge first (the shortcut settles an EXISTING payment), then take it to
        # succeeded. Both run the app's own paths, so this is a real paid order with a real invoice
        # rather than a hand-written row.
        assert (await client.post(f"/store/orders/{public_id}/pay")).status_code == 200
        assert (await client.post(f"/store/orders/{public_id}/simulate-payment")).status_code == 200

        eng = get_engine()
        async with eng.begin() as c:
            inv_id = (await c.execute(text(
                "SELECT i.id FROM invoices i JOIN orders o ON o.id = i.order_id"
                " WHERE o.public_id = :p"), {"p": public_id})).scalar_one()

        r = await client.get(f"/staff/finance/invoices/{inv_id}", headers=h)
        assert r.status_code == 200, r.text
        doc = r.json()
        assert doc["seller"] == identity, doc.get("seller")
        # The document still carries the SALE's own half - the seller block is an addition, not a
        # replacement for the order detail the screen already rendered.
        assert doc["lines"] and doc["total_cents"] > 0, doc
    finally:
        if public_id is not None:
            eng = get_engine()
            async with eng.begin() as c:
                await c.execute(text("DELETE FROM payment_events WHERE order_id IN"
                                     " (SELECT id FROM orders WHERE public_id = :p)"),
                                {"p": public_id})
                await c.execute(text("DELETE FROM invoices WHERE order_id IN"
                                     " (SELECT id FROM orders WHERE public_id = :p)"),
                                {"p": public_id})
                for table in ("order_tax_lines", "payments", "order_lines"):
                    await c.execute(text(f"DELETE FROM {table} WHERE order_id IN"
                                         " (SELECT id FROM orders WHERE public_id = :p)"),
                                    {"p": public_id})
                await c.execute(text("DELETE FROM orders WHERE public_id = :p"), {"p": public_id})
        if pid is not None:
            await _archive(pid)
        await _restore("business_identity", original)
        await _drop_staff(email)
