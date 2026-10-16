import uuid

from sqlalchemy import text

from app.bootstrap_staff import bootstrap
from app.core.db import get_engine


def _h(tok: str) -> dict:
    return {"Authorization": "Bearer " + tok}


async def _pytest_admin(client) -> tuple[str, dict]:
    """A throwaway admin and its bearer header. The caller removes the identity in its `finally`."""
    email = "pytest-" + uuid.uuid4().hex + "@test.rfo"
    _, pw = await bootstrap(email, "admin")
    r = await client.post("/staff/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return email, _h(r.json()["access_token"])


async def _drop_admin(email: str) -> None:
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("DELETE FROM refresh_tokens WHERE identity_id IN "
                             "(SELECT id FROM staff_users WHERE email = :e)"), {"e": email})
        await c.execute(text("DELETE FROM staff_users WHERE email = :e"), {"e": email})


async def _product(*, token: str, status: str = "active") -> int:
    """One product row, on whatever brand and category the database already has.

    Straight SQL for the row itself, and deliberately: it is the only way to make a product that is
    NOT buyable, which is half of what the catalogue's contract is about."""
    eng = get_engine()
    async with eng.begin() as c:
        return (await c.execute(text("""
            INSERT INTO products (brand_id, category_id, model, title, slug, status)
            SELECT (SELECT id FROM brands ORDER BY id LIMIT 1),
                   (SELECT id FROM categories ORDER BY id LIMIT 1), :m, :t, :s, :st
            RETURNING id"""),
            {"m": "Pytest " + token, "t": "Pytest fixture " + token,
             "s": "pytest-" + token, "st": status})).scalar_one()


async def _listed_units(client, h: dict, pid: int, *, n: int = 2, price: int = 27900) -> None:
    """`n` units of that product, walked to `listed` through the real doors, in a lot left active.

    Every step is a door a person uses - scan-in, tested, grade, price, listed - so the fixture
    cannot produce a state the application could not."""
    r = await client.post("/staff/lots", json={"notes": "pytest storefront"}, headers=h)
    assert r.status_code == 201, r.text
    lot = r.json()
    for _ in range(n):
        r = await client.post("/staff/assets/scan-in",
                              json={"lot_number": lot["lot_number"], "product_id": pid,
                                    "serial_number": "pytest-" + uuid.uuid4().hex}, headers=h)
        assert r.status_code == 201, r.text
        aid = r.json()["id"]
        for step, body in (("status", {"status": "tested"}), ("grade", {"grade": "A"}),
                           ("price", {"sale_price_cents": price}), ("status", {"status": "listed"})):
            r = await client.post(f"/staff/assets/{aid}/{step}", json=body, headers=h)
            assert r.status_code == 200, r.text
    r = await client.post(f"/staff/lots/{lot['id']}/activate", headers=h)
    assert r.status_code == 200, r.text


async def test_catalog_lists_listed_stock_only(client):
    """The catalogue's contract with the shop floor: listed stock is buyable, unlisted stock is
    invisible - and a product with nothing on the shelf still has a LIVE page that says so.

    HERMETIC, and it had to be. This read `galaxy-s21` and the ten units migration 0002 seeds, which
    made it true only on a database whose seed had been published by hand (0002 leaves its products at
    the column default, `draft`, where the shop requires `active`) and false again the moment a real
    order bought one of those units - which is why it sat in the gate's deselect list. Nothing in the
    contract needs somebody else's stock.

    WINDOWED BY THE QUERY, NOT BY LUCK. The catalogue read is filtered to this fixture's own token
    rather than asking for the first hundred products and hoping: the rows this test leaves behind
    cannot be deleted (an asset is pinned by its append-only stock_movements), so an unfiltered
    window would drift out from under the fixture after enough runs - which is precisely how the
    old version of this test broke."""
    email, h = await _pytest_admin(client)
    on_token, off_token = uuid.uuid4().hex[:12], uuid.uuid4().hex[:12]
    try:
        pid = await _product(token=on_token)
        # The other one is ACTIVE and simply has nothing on the shelf - which is the state the
        # catalogue must hide but the product page must still serve. (A `draft` product would be a
        # different thing: its page is not meant to exist at all.)
        await _product(token=off_token)
        await _listed_units(client, h, pid, n=2)

        # the listed one is in the catalogue, at its own price, with its own count
        r = await client.get("/store/catalog", params={"q": on_token, "limit": 100})
        assert r.status_code == 200, r.text
        items = {i["slug"]: i for i in r.json()}
        assert "pytest-" + on_token in items, r.text
        mine = items["pytest-" + on_token]
        assert mine["units_available"] == 2, mine
        assert mine["price_from_cents"] == 27900, mine
        # ... and it carries the two fields a card is drawn from. This is what went missing once:
        # the search endpoint returned neither, and every result rendered as the same placeholder.
        assert "image_url" in mine and "category" in mine, mine

        # the unlisted one is not, and is not even matched
        r = await client.get("/store/catalog", params={"q": off_token, "limit": 100})
        assert r.status_code == 200, r.text
        assert r.json() == [], "a product with no listed unit must not appear in the catalogue"

        # its page is live anyway, and empty - a link to a sold-out model must not 404
        r = await client.get("/store/catalog/pytest-" + off_token)
        assert r.status_code == 200, r.text
        assert r.json()["units"] == [], "zero-stock product page: live but empty"

        # the listed one's page lists its units and never the whole serial
        r = await client.get("/store/catalog/pytest-" + on_token)
        assert r.status_code == 200, r.text
        u = r.json()["units"]
        assert len(u) == 2 and u[0]["sale_price_cents"] == 27900, u
        assert all(0 < len(x["serial_tail"] or "") <= 4 for x in u), "serials must be masked"
    finally:
        await _drop_admin(email)


async def test_search(client):
    """Search finds the shop's own stock, reports what a result card needs, and a term that matches
    nothing returns nothing.

    HERMETIC: it searches for a token only its own fixture contains, instead of for "galaxy" and
    the migration's seeded phone."""
    email, h = await _pytest_admin(client)
    token = uuid.uuid4().hex[:12]
    try:
        pid = await _product(token=token)
        await _listed_units(client, h, pid, n=2)

        r = await client.get("/store/search", params={"q": token})
        assert r.status_code == 200, r.text
        hits = [x for x in r.json() if x["slug"] == "pytest-" + token]
        assert len(hits) == 1, r.text
        assert hits[0]["units_available"] == 2, hits[0]
        # THE FIELDS A RESULT TILE IS DRAWN FROM. Both were missing once, and a search results page
        # of twenty identical grey placeholders is what that looked like.
        assert "image_url" in hits[0] and "category" in hits[0], hits[0]

        r = await client.get("/store/search", params={"q": "zzz-not-a-thing"})
        assert r.status_code == 200, r.text
        assert r.json() == []
    finally:
        await _drop_admin(email)


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


async def test_best_sellers_lists_paid_product_and_binds_limit(client):
    """GET /store/best-sellers executes and reports paid sales.

    Before this test the route bound :lim in SQL while passing an empty params dict, so asyncpg
    could not prepare it and every request 500'd - which the storefront home page swallowed in a
    bare except, leaving the block permanently empty.

    Hermetic: builds its own product -> lot -> one listed unit through the real staff flow and
    buys it. finally-cleanup covers the staff identity AND the order side of the sale.

    The order rows have to go: this endpoint's rollup is exactly `order_lines x orders`, so a
    leftover paid order is a leftover row in the thing under test. Assets/products cannot be
    removed at all (rfo_app has no DELETE on the append-only stock_movements, which references
    assets, and both assets and order_lines reference the product), so each run that stayed
    behind would add one permanent `sold = 1` row to the rollup - and every row in the rollup
    competes for the route's 12-row ceiling by `ORDER BY sold DESC`, ties broken arbitrarily.
    Enough runs of a leave-it-behind version tie the fixture out of its own response and the
    test goes flaky. Deleting the order keeps the rollup at its seed baseline: the sale is still
    on the ledger (stock_movements -1 cannot be deleted, audit_log keeps the trail) and the
    product/asset rows stay, they are just invisible to this query without an order line.
    """
    await _staff_cleanup()
    eng = get_engine()
    email = "pytest-" + uuid.uuid4().hex + "@test.rfo"
    slug = "pytest-best-" + uuid.uuid4().hex
    sn = "pytest-best-" + uuid.uuid4().hex
    oid = None
    try:
        _, pw = await bootstrap(email, "admin")
        r = await client.post("/staff/auth/login", json={"email": email, "password": pw})
        assert r.status_code == 200, r.text
        h = _h(r.json()["access_token"])

        r = await client.post("/staff/products", json={"brand_slug": "apple", "category_slug": "phones",
                                                       "model": "Pytest Best", "title": "Pytest Best Phone",
                                                       "slug": slug}, headers=h)
        assert r.status_code == 201, r.text
        pid = r.json()["id"]

        r = await client.post("/staff/lots", json={"notes": "pytest best-sellers"}, headers=h)
        assert r.status_code == 201, r.text
        lot = r.json()

        r = await client.post("/staff/assets/scan-in", json={"lot_number": lot["lot_number"],
                                                             "serial_number": sn, "product_id": pid}, headers=h)
        assert r.status_code == 201, r.text
        aid = r.json()["id"]
        for step, body in (("status", {"status": "tested"}), ("grade", {"grade": "A"}),
                           ("price", {"sale_price_cents": 19900}), ("status", {"status": "listed"})):
            r = await client.post(f"/staff/assets/{aid}/{step}", json=body, headers=h)
            assert r.status_code == 200, r.text
        r = await client.post(f"/staff/lots/{lot['id']}/activate", headers=h)
        assert r.status_code == 200, r.text

        r = await client.post("/store/checkout", json={"asset_ids": [aid], "shipping_country": "AU",
                                                       "ship_to_name": "T", "ship_line1": "x",
                                                       "ship_city": "Sydney", "ship_postcode": "2000"})
        assert r.status_code == 200, r.text
        oid = r.json()["order_public_id"]
        r = await client.post(f"/store/orders/{oid}/pay")
        assert r.status_code == 200, r.text
        r = await client.post(f"/store/orders/{oid}/simulate-payment")
        assert r.status_code == 200, r.text

        # the rollup must execute at all - it used to be a hard 500 on every request
        r = await client.get("/store/best-sellers")
        assert r.status_code == 200, r.text

        # ... and must report the sale. Rows sharing a sold count are tie-broken arbitrarily, so
        # ask for the widest window the route allows (le=12) rather than the default 4: the seed
        # data already holds a `sold = 1` seller that would race this fixture for the last slot.
        r = await client.get("/store/best-sellers", params={"limit": 12})
        assert r.status_code == 200, r.text
        hits = [x for x in r.json() if x["slug"] == slug]
        assert len(hits) == 1 and hits[0]["sold"] == 1, r.text

        # an explicit small limit exercises the :lim bind that was previously missing entirely
        r = await client.get("/store/best-sellers", params={"limit": 1})
        assert r.status_code == 200, r.text
        assert len(r.json()) == 1, r.text
    finally:
        async with eng.begin() as c:
            await c.execute(text("DELETE FROM refresh_tokens WHERE identity_id IN (SELECT id FROM staff_users WHERE email = :e)"),
                            {"e": email})
            await c.execute(text("DELETE FROM staff_users WHERE email = :e"), {"e": email})
            if oid is not None:
                for table in ("order_tax_lines", "payments", "order_lines"):
                    await c.execute(text(f"DELETE FROM {table} WHERE order_id IN (SELECT id FROM orders WHERE public_id = :o)"),
                                    {"o": oid})
                await c.execute(text("DELETE FROM orders WHERE public_id = :o"), {"o": oid})
