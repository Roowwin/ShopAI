"""The margin floor on the storefront: a unit priced below what it cost never reaches the shop.

WHY THIS FILE EXISTS. The floor is one predicate (`services.margin.ON_SALE`) that five statements
share, and a predicate can be present in a statement while still being applied to the wrong set of
rows. These tests are the behavioural half: they put real stock on a real shelf, price it under what
it cost, and assert the shop stops showing it.

BOTH DIRECTIONS, because only the hidden half would pass on an empty catalogue. A unit priced below
its cost is ABSENT from the shopping list and from the product page's buy box, and THE SAME UNIT at
a price at or above its cost is PRESENT. The second half is what makes the first meaningful - and
the pair is also what proves the price, rather than some fixture accident, is what moved it.

SELF-SUFFICIENT ON TAXONOMY. The seeded brands and categories this suite's siblings lean on are not
required here: the file mints its own, carrying the pytest tag, because the dev catalogue is
periodically truncated and a test that needs `apple`/`phones` to exist cannot run against an empty
one. The assets it creates CANNOT be deleted at all - `rfo_app` holds only SELECT+INSERT on
`stock_movements`, whose FK pins every unit it names - so each test deliberately LEAVES its unit
below its cost, which keeps the row it cannot delete off the dev shop.
"""

import uuid

from sqlalchemy import text

from app.bootstrap_staff import bootstrap
from app.core.db import get_engine


def _h(tok: str) -> dict:
    return {"Authorization": "Bearer " + tok}


def _tag() -> str:
    """Hyphen-free on purpose: the catalog's `q` runs through `websearch_to_tsquery`, which would
    split a hyphenated tag into separate lexemes and let a partial match stop being unique."""
    return "pytestMargin" + uuid.uuid4().hex[:12]


async def _staff(client, role: str) -> str:
    email = "pytest-" + uuid.uuid4().hex + "@test.rfo"
    sid, pw = await bootstrap(email, role)
    r = await client.post("/staff/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


async def _sql(sql: str, **params):
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text(sql), params)


async def _one(sql: str, **params):
    eng = get_engine()
    async with eng.begin() as c:
        return (await c.execute(text(sql), params)).scalar_one_or_none()


async def _purge(tag: str) -> None:
    """Remove this test's taxonomy and identities, and only what nothing else references.

    The product and its assets stay: the ledger pins the asset, and the product is what the asset
    points at. `NOT EXISTS` is what keeps this from deleting a row another suite is using - the tag
    makes a collision unlikely and the guard makes one harmless.
    """
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text(
            "DELETE FROM brands WHERE slug LIKE :p AND NOT EXISTS"
            " (SELECT 1 FROM products p WHERE p.brand_id = brands.id)"), {"p": tag.lower() + "%"})
        await c.execute(text(
            "DELETE FROM categories WHERE slug LIKE :p AND NOT EXISTS"
            " (SELECT 1 FROM products p WHERE p.category_id = categories.id)"), {"p": tag.lower() + "%"})
        await c.execute(text(
            "DELETE FROM refresh_tokens WHERE identity_id IN"
            " (SELECT id FROM staff_users WHERE email LIKE 'pytest-%')"))
        await c.execute(text("DELETE FROM staff_users WHERE email LIKE 'pytest-%'"))


async def _seed_taxonomy(tag: str) -> tuple[str, str]:
    """A brand and a category of this test's own, so the seeded catalogue is not required."""
    brand_slug, category_slug = tag.lower() + "-brand", tag.lower() + "-cat"
    await _sql("INSERT INTO brands (name, slug) VALUES (:n, :s)",
               n=tag + " brand", s=brand_slug)
    await _sql("INSERT INTO categories (name, slug) VALUES (:n, :s)",
               n=tag + " category", s=category_slug)
    return brand_slug, category_slug


async def _product(client, tok, tag: str, brand: str, category: str) -> tuple[int, str]:
    """The PARENT: an active product. It only reaches the shop through a sellable CHILD."""
    model = "Model " + tag[-6:]
    slug = tag.lower() + "-" + model.lower().replace(" ", "-")
    r = await client.post("/staff/products",
                          json={"brand_slug": brand, "category_slug": category, "model": model,
                                "title": tag + " " + model, "slug": slug,
                                "description": "pytest margin", "specs": {"storage": "128GB"}},
                          headers=_h(tok))
    assert r.status_code == 201, r.text
    return r.json()["id"], r.json()["slug"]


async def _sellable(client, tok, lot_number: str, serial: str, product_id: int, price: int,
                    cost: int | None = None, grade: str = "A") -> int:
    """Walk one CHILD to the shelf: received -> tested -> graded -> priced -> listed.

    `test_first` walks the tested rung in the same call because `rfo_assets_check_status` refuses
    `received -> graded` outright. `cost` is what the unit cost - omitted leaves the column NULL,
    which is the "this sheet never carried one" case the floor has to treat as publishable.
    """
    r = await client.post("/staff/assets/scan-in",
                          json={"lot_number": lot_number, "serial_number": serial,
                                "product_id": product_id}, headers=_h(tok))
    assert r.status_code == 201, r.text
    aid = r.json()["id"]
    body: dict = {"grade": grade, "test_first": True}
    if cost is not None:
        body["cost_cents"] = cost
    r = await client.post(f"/staff/assets/{aid}/grade", json=body, headers=_h(tok))
    assert r.status_code == 200, r.text
    r = await client.post(f"/staff/assets/{aid}/price", json={"sale_price_cents": price},
                          headers=_h(tok))
    assert r.status_code == 200, r.text
    r = await client.post(f"/staff/assets/{aid}/status", json={"status": "listed"}, headers=_h(tok))
    assert r.status_code == 200, r.text
    return aid


async def _set_price(client, tok, aid: int, cents: int) -> None:
    r = await client.post(f"/staff/assets/{aid}/price", json={"sale_price_cents": cents},
                          headers=_h(tok))
    assert r.status_code == 200, r.text


async def _set_price_direct(aid: int, cents: int) -> None:
    """Price a unit below its cost the way such a row actually gets there: straight to the table.

    The staff price door now REFUSES a below-cost price (services/margin layer 2), so a fixture that
    needs a loss-maker on the shelf cannot build one through it. Writing the row directly is not a
    workaround - it is the exact shape of a below-cost unit that predates the guard, which is the row
    the storefront floor exists to catch. The door's own refusal is proven in test_margin_guard.
    """
    await _sql("UPDATE assets SET sale_price_cents = :c WHERE id = :i", c=cents, i=aid)


async def _shelf_units(client, slug: str) -> list[int]:
    """The buy box's own list: the children the product page offers, priced."""
    r = await client.get(f"/store/catalog/{slug}")
    assert r.status_code == 200, r.text
    return [u["id"] for u in r.json()["units"]]


async def _listed(client, tag: str) -> bool:
    """Whether this test's parent is on the shopping list at all."""
    r = await client.get("/store/catalog", params={"q": tag, "limit": 100})
    assert r.status_code == 200, r.text
    return any(tag.lower() in x["title"].lower() for x in r.json())


async def _shop(client, tok, tag: str):
    """A parent with one listed child, an active lot, and the brand/category it needed."""
    brand, category = await _seed_taxonomy(tag)
    pid, slug = await _product(client, tok, tag, brand, category)
    r = await client.post("/staff/lots", json={"lot_number": tag + "-LOT", "warehouse": "WH-T"},
                          headers=_h(tok))
    assert r.status_code == 201, r.text
    lot = r.json()
    r = await client.post(f"/staff/lots/{lot['id']}/activate", headers=_h(tok))
    assert r.status_code == 200, r.text
    return pid, slug, lot["lot_number"]


async def test_a_unit_priced_below_its_cost_leaves_the_shop(client):
    """The drop that matters: the shelf, then the price under cost, then the shelf again.

    The unit stays `listed` throughout. Nothing about the listing changes when the price moves - and
    that is the point: the shop cannot tell a deliberate loss-leader from a typo, so the rule is
    stated on the only thing it can see, which is the arithmetic.
    """
    tag = _tag()
    tok = await _staff(client, "admin")
    try:
        pid, slug, lot_number = await _shop(client, tok, tag)
        aid = await _sellable(client, tok, lot_number, tag + "-S1", pid, price=30000, cost=20000)

        # On the shelf: 300.00 asked against a 200.00 cost.
        assert await _shelf_units(client, slug) == [aid], "a unit above its cost must be offered"
        assert await _listed(client, tag) is True

        # The price drops under the cost. Same row, same status, same lot - only the margin moved.
        # Written directly: the staff price door refuses a below-cost price outright, so this is the
        # state a pre-guard or imported row is in, and the floor must still catch it.
        await _set_price_direct(aid, 15000)
        assert await _shelf_units(client, slug) == [], \
            "a unit priced below its cost must not be in the buy box"
        assert await _listed(client, tag) is False, \
            "a parent whose only child is under water must leave the shopping list"

        # Raising it back is what proves the absence was the MARGIN and not a broken fixture.
        await _set_price(client, tok, aid, 30000)
        assert await _shelf_units(client, slug) == [aid], "the unit returns once it is profitable"
        assert await _listed(client, tag) is True

        # Left hidden on purpose - see the module docstring: this asset cannot be deleted, so it is
        # left in the one state the rule guarantees a shopper will never be offered.
        await _set_price_direct(aid, 15000)
    finally:
        await _purge(tag)


async def test_a_unit_with_no_cost_is_offered_and_a_settled_one_that_loses_money_is_not(client):
    """A blank cost is an ABSENCE, not a claim of a loss - and Settlement is the cost when it is.

    Both halves are one rule read in two places: the floor treats "nobody said what this cost" as
    publishable (a rule that hid every unpriced unit would empty the shop of everything the supplier
    did not cost), and it reads the workbook's own Settlement column as the cost when `cost_cents`
    is empty, which is the column a supplier sheet actually fills.
    """
    tag = _tag()
    tok = await _staff(client, "admin")
    try:
        pid, slug, lot_number = await _shop(client, tok, tag)
        aid = await _sellable(client, tok, lot_number, tag + "-S1", pid, price=5000, cost=None)

        assert await _shelf_units(client, slug) == [aid], \
            "a unit nobody has costed must still be offered"
        assert await _listed(client, tag) is True

        # Now it acquires a cost - the workbook's own column, which is where a supplier sheet puts
        # it - and the cost is above the price, so it is a loss-maker the shop must drop.
        await _sql("UPDATE assets SET settlement_cents = :c WHERE id = :i", c=9000, i=aid)
        assert await _shelf_units(client, slug) == [], \
            "settlement is the cost basis when cost_cents is empty"
        assert await _listed(client, tag) is False
    finally:
        await _purge(tag)
