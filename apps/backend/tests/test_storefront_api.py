import uuid

from sqlalchemy import text

from app.bootstrap_staff import bootstrap
from app.core.db import get_engine


def _h(tok: str) -> dict:
    return {"Authorization": "Bearer " + tok}


async def test_catalog_from_seed_stock(client):
    r = await client.get("/store/catalog")
    assert r.status_code == 200, r.text
    items = {i["slug"]: i for i in r.json()}
    assert "galaxy-s21" in items
    g = items["galaxy-s21"]
    assert g["units_available"] >= 10 and g["price_from_cents"] == 27900
    assert "iphone-13" not in items

    r = await client.get("/store/catalog/galaxy-s21")
    assert r.status_code == 200, r.text
    u = r.json()["units"]
    assert len(u) >= 10 and u[0]["sale_price_cents"] == 27900
    assert all(len(x["serial_tail"] or "") <= 4 for x in u), "serials must be masked"

    r = await client.get("/store/catalog/iphone-13")
    assert r.status_code == 200, r.text
    assert r.json()["units"] == [], "zero-stock product page: live but empty"


async def test_search(client):
    r = await client.get("/store/search", params={"q": "galaxy"})
    items = r.json()
    hit = [x for x in items if x["slug"] == "galaxy-s21"]
    assert len(hit) == 1 and hit[0]["units_available"] >= 10
    r = await client.get("/store/search", params={"q": "zzz-not-a-thing"})
    assert r.json() == []


async def test_home_content_deal_publish_gate(client):
    """home-content publishes deal_of_month only for an active product holding at least one
    listed asset in an active lot - never for a stockless product, and never for the
    unset/blank/bad-slug states.

    Hermetic: owns its product and restores site_settings itself, so it depends on no
    hand-seeded lot and on no pre-existing CMS pin.
    """
    eng = get_engine()
    slug = "pytest-stockless-" + uuid.uuid4().hex
    email = "pytest-" + uuid.uuid4().hex + "@test.rfo"
    async with eng.begin() as c:
        prev = (await c.execute(text("SELECT value::text FROM site_settings WHERE key = 'home'"))).scalar_one_or_none()
        await c.execute(text("""
            INSERT INTO products (brand_id, category_id, model, title, slug, status)
            SELECT (SELECT id FROM brands ORDER BY id LIMIT 1),
                   (SELECT id FROM categories ORDER BY id LIMIT 1),
                   'pytest-stockless', 'Pytest stockless device', :s, 'active'
        """), {"s": slug})
    try:
        # fixture guard: the product really is live and really is stockless, so an absent block
        # cannot be mistaken for a missing or typo'd slug.
        async with eng.begin() as c:
            row = (await c.execute(text("""
                SELECT p.status, count(a.id) FROM products p
                LEFT JOIN assets a ON a.product_id = p.id
                WHERE p.slug = :s GROUP BY p.status
            """), {"s": slug})).first()
        assert row is not None and row[0] == "active" and row[1] == 0, "fixture must be a live, stockless product"

        _, pw = await bootstrap(email, "admin")
        r = await client.post("/staff/auth/login", json={"email": email, "password": pw})
        assert r.status_code == 200, r.text
        tok = r.json()["access_token"]
        h = _h(tok)

        async def pin(deal):
            body = {"hero_title": "Pytest hero"}
            if deal is not None:
                body["deal_of_month"] = deal
            r = await client.put("/staff/cms/home", json=body, headers=h)
            assert r.status_code == 200, r.text
            r = await client.get("/store/home-content")
            assert r.status_code == 200, r.text
            return r.json()

        # unset: no record stored at all
        assert "deal_of_month" not in await pin(None), "unset must publish nothing"
        # blank slug: normalised away by the CMS write
        assert "deal_of_month" not in await pin({"product_slug": "   ", "title": "x", "badge": "y"}), "blank slug must publish nothing"
        # bad slug: product does not exist
        assert "deal_of_month" not in await pin({"product_slug": slug + "-nope", "title": "x", "badge": "y"}), "bad slug must publish nothing"
        # stockless: product is live and active but has no listed asset in an active lot
        body = await pin({"product_slug": slug, "title": "Pytest deal", "badge": "Deal of the Month"})
        assert "deal_of_month" not in body, "stockless product must not publish a deal card"
        assert body["hero_title"] == "Pytest hero", "endpoint still serves the rest of the CMS payload"
    finally:
        async with eng.begin() as c:
            await c.execute(text("DELETE FROM products WHERE slug = :s"), {"s": slug})
            if prev is None:
                await c.execute(text("DELETE FROM site_settings WHERE key = 'home'"))
            else:
                await c.execute(text("UPDATE site_settings SET value = CAST(:v AS jsonb) WHERE key = 'home'"), {"v": prev})
            await c.execute(text("DELETE FROM refresh_tokens WHERE identity_id IN (SELECT id FROM staff_users WHERE email = :e)"), {"e": email})
            await c.execute(text("DELETE FROM staff_users WHERE email = :e"), {"e": email})


async def test_guest_checkout_to_paid(client):
    await _staff_cleanup()
    eng = get_engine()

    email = "pytest-" + uuid.uuid4().hex + "@test.rfo"
    sid, pw = await bootstrap(email, "admin")
    r = await client.post("/staff/auth/login", json={"email": email, "password": pw})
    tok = r.json()["access_token"]

    r = await client.post("/staff/lots", json={"notes": "pytest"}, headers=_h(tok))
    lot = r.json()
    ln = lot["lot_number"]

    sn = "pytest-" + uuid.uuid4().hex
    r = await client.post("/staff/assets/scan-in", json={"lot_number": ln, "serial_number": sn}, headers=_h(tok))
    assert r.status_code == 201, r.text
    aid = r.json()["id"]
    await client.post(f"/staff/assets/{aid}/status", json={"status": "tested"}, headers=_h(tok))
    await client.post(f"/staff/assets/{aid}/grade", json={"grade": "A"}, headers=_h(tok))
    await client.post(f"/staff/assets/{aid}/price", json={"sale_price_cents": 19900}, headers=_h(tok))
    await client.post(f"/staff/assets/{aid}/status", json={"status": "listed"}, headers=_h(tok))

    r = await client.post("/store/reservations", json={"asset_id": aid})
    assert r.status_code == 409 and "lot" in r.json()["detail"], r.text
    r = await client.post("/store/checkout", json={"asset_ids": [aid], "shipping_country": "AU",
                                                   "ship_to_name": "T", "ship_line1": "x", "ship_city": "Sydney", "ship_postcode": "2000"})
    assert r.status_code == 409 and "lot" in r.json()["detail"], r.text

    r = await client.post(f"/staff/lots/{lot['id']}/activate", headers=_h(tok))
    assert r.status_code == 200, r.text

    r = await client.post("/store/checkout", json={"asset_ids": [aid], "shipping_country": "AU",
                                                   "ship_to_name": "T", "ship_line1": "x", "ship_city": "Sydney", "ship_postcode": "2000"})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["subtotal_cents"] == 19900 and out["total_cents"] == 19900 + 1990, out

    r = await client.post(f"/store/orders/{out['order_public_id']}/pay")
    assert r.status_code == 200, r.text
    r = await client.post(f"/store/orders/{out['order_public_id']}/simulate-payment")
    assert r.status_code == 200 and r.json()["status"] == "paid", r.text

    async with eng.begin() as c:
        st = (await c.execute(text("SELECT status FROM assets WHERE id = :i"), {"i": aid})).scalar_one()
        mv = (await c.execute(text("SELECT count(*) FROM stock_movements WHERE asset_id = :i AND qty = -1"), {"i": aid})).scalar_one()
    assert st == "sold" and mv == 1


async def _staff_cleanup():
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("DELETE FROM refresh_tokens WHERE identity_id IN (SELECT id FROM staff_users WHERE email LIKE 'pytest-%')"))
        await c.execute(text("DELETE FROM staff_users WHERE email LIKE 'pytest-%'"))


async def test_newsletter_subscribe_dedupe_and_admin_list(client):
    """Public signup is idempotent and non-disclosing; the admin list is role-gated.

    Hermetic: creates its own subscriber row and its own staff users and removes all
    three in a finally, so it rests on no hand-seeded data.
    """
    eng = get_engine()
    email = "pytest-news-" + uuid.uuid4().hex + "@test.rfo"
    admin_email = "pytest-" + uuid.uuid4().hex + "@test.rfo"
    sales_email = "pytest-" + uuid.uuid4().hex + "@test.rfo"

    async def _rows() -> int:
        async with eng.begin() as c:
            return (await c.execute(text("SELECT count(*) FROM newsletter_subscribers WHERE email = :e"),
                                    {"e": email})).scalar_one()

    try:
        # first signup
        r = await client.post("/store/newsletter/subscribe", json={"email": email})
        assert r.status_code == 200, r.text
        first = r.json()
        assert first == {"status": "subscribed"}, first
        assert await _rows() == 1

        # repeat signup: 200 with an identical body - no "already subscribed" tell - and still one row
        r = await client.post("/store/newsletter/subscribe", json={"email": email})
        assert r.status_code == 200, r.text
        assert r.json() == first, "duplicate signup must be indistinguishable from a first signup"
        assert await _rows() == 1, "dedupe via UNIQUE(email): exactly one row"

        # normalisation: padded / upper-case lands on the same row
        r = await client.post("/store/newsletter/subscribe", json={"email": "  " + email.upper() + "  "})
        assert r.status_code == 200, r.text
        assert await _rows() == 1, "upper-case/padded address must normalise onto the stored row"

        # invalid addresses: 4xx, never a 500
        for bad in ("not-an-email", "a@b", ""):
            r = await client.post("/store/newsletter/subscribe", json={"email": bad})
            assert r.status_code == 422, (bad, r.text)

        # admin list: auth required ...
        r = await client.get("/staff/newsletter")
        assert r.status_code == 401, r.text

        # ... and an admin/manager role
        _, pw = await bootstrap(sales_email, "sales")
        r = await client.post("/staff/auth/login", json={"email": sales_email, "password": pw})
        assert r.status_code == 200, r.text
        r = await client.get("/staff/newsletter", headers=_h(r.json()["access_token"]))
        assert r.status_code == 403, r.text

        # ... and lists + counts for an admin
        _, pw = await bootstrap(admin_email, "admin")
        r = await client.post("/staff/auth/login", json={"email": admin_email, "password": pw})
        assert r.status_code == 200, r.text
        r = await client.get("/staff/newsletter", headers=_h(r.json()["access_token"]))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["total"] >= 1
        mine = [s for s in body["subscribers"] if s["email"] == email]
        assert len(mine) == 1 and mine[0]["created_at"], body
    finally:
        async with eng.begin() as c:
            await c.execute(text("DELETE FROM newsletter_subscribers WHERE email = :e"), {"e": email})
            await c.execute(text("DELETE FROM refresh_tokens WHERE identity_id IN (SELECT id FROM staff_users WHERE email IN (:a, :s))"),
                            {"a": admin_email, "s": sales_email})
            await c.execute(text("DELETE FROM staff_users WHERE email IN (:a, :s)"),
                            {"a": admin_email, "s": sales_email})