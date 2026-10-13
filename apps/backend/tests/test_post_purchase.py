"""The post-purchase reads: what a shopper can see after they have paid.

WHY THE FIXTURES ARE `mission-` AND NOT `pytest-`. The repo's other suites tear down with
`DELETE FROM staff_users WHERE email LIKE 'pytest-%'` (and the same sweep over `users`). On this box
several sessions run their gates at once against one dev database, so a concurrent teardown deletes
the `pytest-%` identities out from under whoever else is mid-test, and every later door in that run
answers 401 - which reads exactly like a regression in the code under test. Naming this suite's
identities outside that pattern makes a failure here a statement about the code.

WHAT IS BEING PINNED. Three properties, each of which is easy to get wrong in a way no status code
catches:

  * A QUOTE MUST NOT WRITE. The checkout screen shows a total before it takes any money, and a
    "quote" that created an order would leave a trail of abandoned orders behind every price check.
  * THE QUOTE AND THE CHARGE MUST AGREE. They read the same rows through the same helper; this is
    the test that says so out loud.
  * THE ORDER LINK CARRIES THE STATUS AND THE TOTALS, NOT THE STREET ADDRESS. The id is the only
    credential a guest confirmation has, so what it reveals is a real decision - full address for
    the order's own customer, destination only for anyone else.

The assets these tests buy cannot be deleted (the append-only ledger's FK pins them), so the teardown
archives the products it minted instead: a tagged row nobody can remove is at least a row the shop
does not show.
"""

import uuid

from sqlalchemy import text

from app.bootstrap_staff import bootstrap
from app.core.db import get_engine


def _h(tok: str) -> dict:
    return {"Authorization": "Bearer " + tok}


def _tag() -> str:
    """Hyphen-free, because the catalog's `q` runs through `websearch_to_tsquery`."""
    return "missionPP" + uuid.uuid4().hex[:12]


async def _sql(sql: str, **params):
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text(sql), params)


async def _one(sql: str, **params):
    eng = get_engine()
    async with eng.begin() as c:
        return (await c.execute(text(sql), params)).scalar_one_or_none()


async def _staff(client, role: str = "admin") -> str:
    email = "mission-staff-" + uuid.uuid4().hex + "@test.rfo"
    sid, pw = await bootstrap(email, role)
    r = await client.post("/staff/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


async def _customer(client) -> tuple[str, str]:
    """A signed-in customer: (access token, email). Registered through the real door, so the
    session this file carries is the one a shopper would have."""
    email = "mission-cust-" + uuid.uuid4().hex + "@test.rfo"
    r = await client.post("/store/auth/register",
                          json={"email": email, "password": "mission-pass-9182", "display_name": "Mission"})
    assert r.status_code == 200, r.text
    return r.json()["access_token"], email


async def _cleanup() -> None:
    """Remove this suite's orders and identities, and take its products off the shop.

    THE ORDERS ARE FOUND BY THE SERIAL OF THE UNITS THEY BOUGHT, not by the customer. Most of what
    this file creates is a GUEST order - `customer_id` is NULL, which is the whole reason the
    confirmation page is addressed by its own id - so a cleanup keyed on the customer would leave
    every one of them behind, pointing at assets nothing can delete.

    The ids are read into Python BEFORE anything is deleted, because the query that finds them runs
    over `order_lines`, which the first delete below removes. The stock itself cannot go at all:
    `rfo_app` holds only SELECT+INSERT on `stock_movements`, whose FK pins every unit it names, so the
    product is ARCHIVED instead - a tagged row nobody can delete is at least a row the shop does not
    show.
    """
    eng = get_engine()
    async with eng.begin() as c:
        ids = (await c.execute(text(
            "SELECT DISTINCT ol.order_id FROM order_lines ol JOIN assets a ON a.id = ol.asset_id"
            " WHERE a.serial_number::text LIKE 'mission%'"), {})).scalars().all()
        if ids:
            for table in ("order_tax_lines", "payments", "order_lines"):
                await c.execute(text(f"DELETE FROM {table} WHERE order_id = ANY(:ids)"), {"ids": list(ids)})
            # Shipments cascade from orders (0018), so they need no statement of their own.
            await c.execute(text("DELETE FROM orders WHERE id = ANY(:ids)"), {"ids": list(ids)})
        await c.execute(text("UPDATE products SET status = 'archived' WHERE slug LIKE 'mission%'"))
        await c.execute(text(
            "DELETE FROM refresh_tokens WHERE identity_id IN"
            " (SELECT id FROM staff_users WHERE email LIKE 'mission-%')"
            " OR identity_id IN (SELECT id FROM users WHERE email LIKE 'mission-%')"))
        await c.execute(text("DELETE FROM password_credentials WHERE user_id IN"
                             " (SELECT id FROM users WHERE email LIKE 'mission-%')"))
        await c.execute(text("DELETE FROM staff_passwords WHERE staff_id IN"
                             " (SELECT id FROM staff_users WHERE email LIKE 'mission-%')"))
        await c.execute(text("DELETE FROM staff_users WHERE email LIKE 'mission-%'"))
        await c.execute(text("DELETE FROM users WHERE email LIKE 'mission-%'"))
        await c.execute(text(
            "DELETE FROM brands WHERE slug LIKE 'mission%' AND NOT EXISTS"
            " (SELECT 1 FROM products p WHERE p.brand_id = brands.id)"))
        await c.execute(text(
            "DELETE FROM categories WHERE slug LIKE 'mission%' AND NOT EXISTS"
            " (SELECT 1 FROM products p WHERE p.category_id = categories.id)"))


async def _seed_taxonomy(tag: str) -> tuple[str, str]:
    """A brand and a category of this suite's own, so the seeded catalogue is not required - the dev
    database is truncated from time to time and a test that needs `apple`/`phones` cannot run against
    an empty one."""
    brand, category = tag.lower() + "-brand", tag.lower() + "-cat"
    await _sql("INSERT INTO brands (name, slug) VALUES (:n, :s)", n=tag + " brand", s=brand)
    await _sql("INSERT INTO categories (name, slug) VALUES (:n, :s)", n=tag + " category", s=category)
    return brand, category


async def _buyable(client, tok, tag: str, price: int = 30000, cost: int = 10000) -> dict:
    """A product with ONE listed unit in an active lot, ready to be checked out.

    Returns {product_slug, asset_id, lot_number}. The cost is deliberately below the price: the shop
    refuses to sell a loss-maker (see store_catalog's floor and store_ops._margin_409), so a fixture
    that priced a unit under its cost would be testing the refusal instead of the purchase.
    """
    brand, category = await _seed_taxonomy(tag)
    model = "Model " + tag[-6:]
    slug = tag.lower() + "-" + model.lower().replace(" ", "-")
    r = await client.post("/staff/products",
                          json={"brand_slug": brand, "category_slug": category, "model": model,
                                "title": tag + " " + model, "slug": slug,
                                "description": "mission post-purchase", "specs": {}},
                          headers=_h(tok))
    assert r.status_code == 201, r.text
    pid = r.json()["id"]

    r = await client.post("/staff/lots", json={"lot_number": tag + "-LOT", "warehouse": "WH-T"},
                          headers=_h(tok))
    assert r.status_code == 201, r.text
    lot = r.json()
    r = await client.post(f"/staff/lots/{lot['id']}/activate", headers=_h(tok))
    assert r.status_code == 200, r.text

    r = await client.post("/staff/assets/scan-in",
                          json={"lot_number": lot["lot_number"], "serial_number": tag + "-S1",
                                "product_id": pid}, headers=_h(tok))
    assert r.status_code == 201, r.text
    aid = r.json()["id"]
    r = await client.post(f"/staff/assets/{aid}/grade",
                          json={"grade": "A", "cost_cents": cost, "test_first": True},
                          headers=_h(tok))
    assert r.status_code == 200, r.text
    r = await client.post(f"/staff/assets/{aid}/price", json={"sale_price_cents": price},
                          headers=_h(tok))
    assert r.status_code == 200, r.text
    r = await client.post(f"/staff/assets/{aid}/status", json={"status": "listed"}, headers=_h(tok))
    assert r.status_code == 200, r.text
    return {"slug": slug, "asset_id": aid, "lot_number": lot["lot_number"]}


ADDRESS = {"shipping_country": "AU", "ship_to_name": "Mission Buyer", "ship_line1": "1 Test Street",
           "ship_city": "Sydney", "ship_state": "NSW", "ship_postcode": "2000"}


async def _quote(client, asset_id: int, country: str = "AU") -> dict:
    r = await client.post("/store/checkout/quote",
                          json={"asset_ids": [asset_id], "shipping_country": country})
    assert r.status_code == 200, r.text
    return r.json()


async def test_a_quote_prices_the_cart_and_creates_nothing(client):
    """The checkout screen's number, and the proof that asking for it leaves no trace."""
    tag = _tag()
    tok = await _staff(client)
    try:
        buy = await _buyable(client, tok, tag)

        q = await _quote(client, buy["asset_id"])
        assert q["subtotal_cents"] == 30000, q
        assert q["total_cents"] == q["subtotal_cents"] + q["tax_cents"] + q["shipping_cents"], q
        assert q["rate_bp"] > 0 and q["jurisdiction"], "the rate that priced it is named"
        assert q["lines"][0]["asset_id"] == buy["asset_id"]
        assert q["lines"][0]["grade"] == "A"

        # Nothing was written, and the check is scoped to THIS unit rather than counted over the
        # whole table: another session's gate is minting orders against the same database, so a
        # global count would fail on their traffic instead of on anything this endpoint did.
        assert (await _one("SELECT count(*) FROM order_lines WHERE asset_id = :a",
                           a=buy["asset_id"])) == 0, "a quote must not create an order"
        assert (await _one("SELECT status FROM assets WHERE id = :i", i=buy["asset_id"])) == "listed", \
            "a quote must not reserve the unit"

        # ... and the charge agrees with the quote, which is the whole promise of showing it.
        r = await client.post("/store/checkout", json={"asset_ids": [buy["asset_id"]], **ADDRESS})
        assert r.status_code == 200, r.text
        charged = r.json()
        assert charged["subtotal_cents"] == q["subtotal_cents"], (charged, q)
        assert charged["tax_cents"] == q["tax_cents"], (charged, q)
        assert charged["total_cents"] == q["total_cents"], (charged, q)
    finally:
        await _cleanup()


async def test_a_guest_order_is_readable_by_id_and_never_carries_the_street_address(client):
    """The confirmation screen's contract: the status and the money, not where a stranger lives."""
    tag = _tag()
    tok = await _staff(client)
    try:
        buy = await _buyable(client, tok, tag)
        r = await client.post("/store/checkout", json={"asset_ids": [buy["asset_id"]], **ADDRESS})
        assert r.status_code == 200, r.text
        oid = r.json()["order_public_id"]

        # The page a guest lands on, fetched with NO credential at all.
        r = await client.get(f"/store/orders/{oid}")
        assert r.status_code == 200, r.text
        seen = r.json()
        assert seen["status"] == "pending" and seen["paid"] is False, seen
        assert seen["subtotal_cents"] == 30000, seen
        # Derived rather than spelled out: the GST rate is a SETTING an operator may change, and a
        # confirmation page's arithmetic has to hold at whatever rate priced the order.
        assert seen["total_cents"] == seen["subtotal_cents"] + seen["tax_cents"] + seen["shipping_cents"], seen
        # The MASK is the last four characters of the serial, which is the shop's own rule for what a
        # payload may carry (see store_catalog): asserted as that rule rather than against a literal,
        # so the fixture's own serial spelling cannot make this pass for the wrong reason.
        serial = tag + "-S1"
        assert len(seen["lines"]) == 1, seen
        assert seen["lines"][0]["serial_tail"] == serial[-4:], seen

        assert seen["ship_to"]["full"] is False, "an anonymous caller is not the order's customer"
        assert seen["ship_to"].get("line1") is None, \
            "the street address must not travel on an order id alone"
        assert seen["ship_to"].get("name") is None, seen
        # ... but the destination still is, which is what lets the buyer check it was right.
        assert seen["ship_to"]["city"] == "Sydney" and seen["ship_to"]["country"] == "AU", seen

        # Paying moves the order, and the SAME link then reports it. Two calls, in this order: `/pay`
        # is what creates the payment row and `/simulate-payment` is what settles it, which is the
        # pair the checkout screen runs and the pair the confirmation page's "finish payment" reruns.
        r = await client.post(f"/store/orders/{oid}/pay")
        assert r.status_code == 200, r.text
        r = await client.post(f"/store/orders/{oid}/simulate-payment")
        assert r.status_code == 200, r.text
        r = await client.get(f"/store/orders/{oid}")
        assert r.json()["status"] == "paid" and r.json()["paid"] is True, r.json()
        assert r.json()["payment_status"] == "succeeded", r.json()

        # A malformed id is a 404, not a 500: a truncated link is an ordinary thing to be handed.
        assert (await client.get("/store/orders/not-a-uuid")).status_code == 404
    finally:
        await _cleanup()


async def test_the_owning_customer_sees_the_full_address_and_a_stranger_does_not(client):
    """The order list is scoped to the caller, and the address is scoped with it."""
    tag = _tag()
    tok = await _staff(client)
    try:
        buy = await _buyable(client, tok, tag)
        owner_tok, _ = await _customer(client)

        r = await client.post("/store/checkout",
                              json={"asset_ids": [buy["asset_id"]], **ADDRESS}, headers=_h(owner_tok))
        assert r.status_code == 200, r.text
        oid = r.json()["order_public_id"]

        # The owner: the full address, because it is their own order.
        r = await client.get(f"/store/orders/{oid}", headers=_h(owner_tok))
        assert r.status_code == 200, r.text
        mine = r.json()
        assert mine["ship_to"]["full"] is True, mine["ship_to"]
        assert mine["ship_to"]["name"] == "Mission Buyer", mine["ship_to"]
        assert mine["ship_to"]["line1"] == "1 Test Street", mine["ship_to"]

        # A different signed-in customer holds the same link and is still not the buyer.
        other_tok, _ = await _customer(client)
        r = await client.get(f"/store/orders/{oid}", headers=_h(other_tok))
        assert r.status_code == 200, r.text
        assert r.json()["ship_to"]["full"] is False, "a stranger must not read the address"
        assert r.json()["ship_to"].get("line1") is None, r.json()["ship_to"]

        # The list is the caller's own, and it is closed to nobody at all.
        r = await client.get("/store/orders", headers=_h(owner_tok))
        assert r.status_code == 200, r.text
        mine_ids = [o["public_id"] for o in r.json()]
        assert oid in mine_ids, mine_ids
        assert r.json()[0]["first_title"], "a row names what was bought, not just a UUID"

        r = await client.get("/store/orders", headers=_h(other_tok))
        assert r.status_code == 200, r.text
        assert oid not in [o["public_id"] for o in r.json()], "another customer's order leaked"

        anon = await client.get("/store/orders")
        assert anon.status_code in (401, 403), anon.text
    finally:
        await _cleanup()


async def test_a_parcel_can_be_followed_by_its_tracking_number_and_nothing_else(client):
    """The public tracking read: the parcel's movement, and none of the order behind it.

    The dispatch goes through the real staff door (`POST /staff/logistics/orders/{id}/ship`), so this walks the
    same road an operator walks rather than writing a shipment row by hand - and the read is then
    made with NO credential at all, because a tracking reference is meant to be enough.
    """
    tag = _tag()
    tok = await _staff(client)
    try:
        buy = await _buyable(client, tok, tag)
        r = await client.post("/store/checkout", json={"asset_ids": [buy["asset_id"]], **ADDRESS})
        assert r.status_code == 200, r.text
        oid = r.json()["order_public_id"]
        # A parcel only exists for a PAID order (`ship_order` refuses anything else).
        assert (await client.post(f"/store/orders/{oid}/pay")).status_code == 200
        assert (await client.post(f"/store/orders/{oid}/simulate-payment")).status_code == 200

        order_id = await _one("SELECT id FROM orders WHERE public_id = :p", p=oid)
        ref = tag + "-REF"
        r = await client.post(f"/staff/logistics/orders/{order_id}/ship",
                              json={"carrier": "MissionPost", "service": "Express",
                                    "tracking_ref": ref, "promised_days": 2},
                              headers=_h(tok))
        assert r.status_code == 201, r.text

        # ANYONE with the reference, and no credential at all - typed in the wrong case, because a
        # number read off a label gets typed the way it is printed and carriers disagree on case.
        r = await client.get("/store/track/" + ref.lower())
        assert r.status_code == 200, r.text
        seen = r.json()
        assert seen["carrier"] == "MissionPost" and seen["service"] == "Express", seen
        assert seen["order_status"] == "shipped", seen
        assert seen["status"] == "in_transit" and seen["delivered_at"] is None, seen

        # THE NARROW PAYLOAD IS THE POINT. A tracking reference is short and guessable in a way an
        # order's UUID is not, so an exact key set is asserted rather than a few spot checks: an
        # item, an amount or an address added to this response would be a disclosure nobody asked
        # the page for, and only an equality assertion notices one arriving.
        assert set(seen) == {"tracking_ref", "carrier", "service", "order_status", "status",
                             "dispatched_at", "promised_at", "delivered_at"}, sorted(seen)

        # The buyer's own order page still shows the parcel, and now reads `shipped`.
        r = await client.get(f"/store/orders/{oid}")
        assert r.json()["status"] == "shipped", r.json()
        assert r.json()["shipment"]["tracking_ref"] == ref, r.json()

        # Delivery moves the same two reads.
        shipment_id = await _one("SELECT id FROM shipments WHERE order_id = :o", o=order_id)
        r = await client.post(f"/staff/logistics/shipments/{shipment_id}/deliver", json={}, headers=_h(tok))
        assert r.status_code == 200, r.text
        r = await client.get("/store/track/" + ref)
        assert r.json()["status"] == "delivered" and r.json()["delivered_at"], r.json()
        assert r.json()["order_status"] == "delivered", r.json()

        # An unknown reference is a 404 that says so, not a 500 and not an empty page.
        assert (await client.get("/store/track/NO-SUCH-REF-9182")).status_code == 404
    finally:
        await _cleanup()
