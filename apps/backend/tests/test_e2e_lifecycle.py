"""End-to-end validation of one unit's whole life: Import -> Grade -> Price -> List.

The other suites pin one door each - the importer, the status ladder, the grading workbench.
This one walks a single unit from a serial off the intake dock to a thing a shopper can buy, and
asserts the SHELF IS EMPTY at every stage before the last. That is the part a happy-path test
cannot tell you: "published correctly" and "published too early" both end with the unit on sale.

The second half pins the parent/child shape the storefront now renders. A `products` row is the
PARENT (the model, shared by every unit of it) and an `assets` row is the CHILD (one physical
unit, carrying its own grade, price and serial). The child is the only thing that has a price;
the parent only ever shows a minimum over whichever children happen to be listed and in an
active lot. These tests exist to catch the ways that shape can break the shop:

  * one parent's units showing up under another parent that merely shares a model,
  * a child leaking onto the shelf while its lot is still unreleased (intake),
  * a graded-but-unlisted or unpriced child reaching the shelf,
  * a full serial escaping in a payload that is only allowed to carry its last four digits,
  * a parent with no children 500-ing the product page instead of rendering an empty shelf.

As in the importer's and workbench's suites, the rows these tests create cannot be deleted:
`rfo_app` holds only SELECT+INSERT on `stock_movements`, and the ledger's FK pins every unit it
names. So every lot, serial, slug and title carries a unique pytest tag and stays in dev. Only
the identity rows and the orders this file creates are cleaned up.

Most tests deliberately leave their lots in `intake`, which keeps their stock off the storefront
entirely - a lot that is not active is invisible to the catalog whatever its units say. The two
tests that must prove the shelf really works do activate their lot, and clean up their order.
"""

import uuid

from sqlalchemy import text

from app.bootstrap_staff import bootstrap
from app.core.db import get_engine

BRAND = "apple"
CATEGORY = "phones"


# --------------------------------------------------------------------------- helpers
# Per-file, as everywhere else in this suite: conftest carries the client fixture and nothing
# else, so each file copies the handful of tools it needs.

def _h(tok: str) -> dict:
    return {"Authorization": "Bearer " + tok}


def _tag() -> str:
    """One hyphen-free alphanumeric token that also goes into the product TITLE.

    The storefront's `q` filter runs through `websearch_to_tsquery`, which would split a
    hyphenated tag into separate lexemes - and a partial match would then no longer be unique
    to this test. A single token cannot be split, so a hit is this test's product and no other.
    """
    return "pytestE2E" + uuid.uuid4().hex[:12]


async def _staff(client, role: str) -> str:
    email = "pytest-" + uuid.uuid4().hex + "@test.rfo"
    sid, pw = await bootstrap(email, role)
    r = await client.post("/staff/auth/login", json={"email": email, "password": pw})
    return r.json()["access_token"]


async def _one(sql: str, **params):
    eng = get_engine()
    async with eng.begin() as c:
        return (await c.execute(text(sql), params)).scalar_one()


async def _rows(sql: str, **params) -> list[dict]:
    eng = get_engine()
    async with eng.begin() as c:
        return [dict(r) for r in (await c.execute(text(sql), params)).mappings().all()]


async def _audit_actions(entity: str, entity_id: int) -> list[str]:
    eng = get_engine()
    async with eng.begin() as c:
        rows = (await c.execute(text(
            "SELECT action FROM audit_log WHERE entity = :e AND entity_id = :i ORDER BY id"),
            {"e": entity, "i": entity_id})).scalars().all()
    return list(rows)


async def _cleanup_identities() -> None:
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("DELETE FROM refresh_tokens WHERE identity_id IN "
                             "(SELECT id FROM staff_users WHERE email LIKE 'pytest-%')"))
        await c.execute(text("DELETE FROM staff_users WHERE email LIKE 'pytest-%'"))


async def _purge_order(public_id: str) -> None:
    """Child rows first: the FK chain runs order_tax_lines/payments/order_lines -> orders."""
    eng = get_engine()
    async with eng.begin() as c:
        for table in ("order_tax_lines", "payments", "order_lines"):
            await c.execute(text(f"DELETE FROM {table} WHERE order_id IN "
                                 "(SELECT id FROM orders WHERE public_id = :o)"), {"o": public_id})
        await c.execute(text("DELETE FROM orders WHERE public_id = :o"), {"o": public_id})


async def _product(client, tok, tag: str, model: str | None = None) -> tuple[int, str]:
    """The PARENT: an active product. `status='active'` is set at creation, so a brand-new parent
    with no children is already live - which is exactly the empty-shelf case under test."""
    model = model or ("Model " + tag[-6:])
    slug = tag.lower() + "-" + model.lower().replace(" ", "-")
    r = await client.post("/staff/products",
                          json={"brand_slug": BRAND, "category_slug": CATEGORY, "model": model,
                                "title": tag + " " + model, "slug": slug,
                                "description": "pytest e2e", "specs": {"storage": "128GB"}},
                          headers=_h(tok))
    assert r.status_code == 201, r.text
    return r.json()["id"], r.json()["slug"]


async def _lot(client, tok, tag: str, suffix: str = "LOT") -> dict:
    r = await client.post("/staff/lots", json={"lot_number": tag + "-" + suffix, "warehouse": "WH-T"},
                          headers=_h(tok))
    assert r.status_code == 201, r.text
    return r.json()


async def _scan(client, tok, lot_number: str, serial: str, product_id: int) -> int:
    r = await client.post("/staff/assets/scan-in",
                          json={"lot_number": lot_number, "serial_number": serial,
                                "product_id": product_id}, headers=_h(tok))
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _sellable(client, tok, lot_number: str, serial: str, product_id: int,
                    price: int, grade: str = "A") -> int:
    """Walk one child all the way to the shelf: received -> tested -> graded -> priced -> listed.

    `test_first` walks the tested rung in the same call because `rfo_assets_check_status` refuses
    `received -> graded` outright (see test_lot_process). The unit is listed but NOT yet visible:
    visibility also needs its lot active, which the caller controls.
    """
    aid = await _scan(client, tok, lot_number, serial, product_id)
    r = await client.post(f"/staff/assets/{aid}/grade",
                          json={"grade": grade, "test_first": True}, headers=_h(tok))
    assert r.status_code == 200, r.text
    assert r.json()["stepped_through_tested"] is True, r.text
    r = await client.post(f"/staff/assets/{aid}/price", json={"sale_price_cents": price},
                          headers=_h(tok))
    assert r.status_code == 200, r.text
    r = await client.post(f"/staff/assets/{aid}/status", json={"status": "listed"}, headers=_h(tok))
    assert r.status_code == 200, r.text
    return aid


async def _catalog_item(client, tag: str) -> dict | None:
    """This test's parent as the SHOPPING LIST shows it - or None when the shelf is empty."""
    r = await client.get("/store/catalog", params={"q": tag, "limit": 100})
    assert r.status_code == 200, r.text
    hits = [x for x in r.json() if tag.lower() in x["title"].lower()]
    assert len(hits) <= 1, hits
    return hits[0] if hits else None


async def _shelf(client, slug: str):
    """The product page's own payload: the parent and the children it offers."""
    return await client.get(f"/store/catalog/{slug}")


CHECKOUT = {"shipping_country": "AU", "ship_to_name": "Pytest E2E", "ship_line1": "1 Test St",
            "ship_city": "Sydney", "ship_postcode": "2000"}


# --------------------------------------------------------------------------- the lifecycle

async def test_e2e_import_grade_price_list_publishes_once_at_the_end(client):
    """One unit, four stages, and the shelf stays empty until the last one.

    Import creates the parent and the child; Grade and Price move the child along; List is the
    stage where it actually becomes buyable. The assertion that earns this test its keep is the
    one run between every pair of stages: the unit is nowhere on the storefront yet.
    """
    tag = _tag()
    tok = await _staff(client, "admin")
    pid, slug = await _product(client, tok, tag)
    lot = await _lot(client, tok, tag)

    # -- Import ------------------------------------------------------------------------
    serial = tag + "-SN-1234"
    aid = await _scan(client, tok, lot["lot_number"], serial, pid)
    assert await _one("SELECT status FROM assets WHERE id = :i", i=aid) == "received"
    assert await _one("SELECT status FROM products WHERE id = :i", i=pid) == "active"

    # A parent with no children is still a valid page - it just has an empty shelf.
    r = await _shelf(client, slug)
    assert r.status_code == 200, r.text
    assert r.json()["units"] == [], r.text
    assert await _catalog_item(client, tag) is None, "an unstocked parent must not be listed"

    # -- Grade -------------------------------------------------------------------------
    r = await client.post(f"/staff/assets/{aid}/grade",
                          json={"grade": "A", "test_first": True}, headers=_h(tok))
    assert r.status_code == 200, r.text
    assert r.json() == {"id": aid, "status": "graded", "grade": "A", "stepped_through_tested": True}
    assert await _audit_actions("asset", aid) == ["scan_in", "test", "grade"]
    assert (await _shelf(client, slug)).json()["units"] == [], "graded is not listed"

    # -- Price -------------------------------------------------------------------------
    r = await client.post(f"/staff/assets/{aid}/price", json={"sale_price_cents": 24900},
                          headers=_h(tok))
    assert r.status_code == 200 and r.json()["sale_price_cents"] == 24900, r.text
    assert await _one("SELECT sale_price_cents FROM assets WHERE id = :i", i=aid) == 24900
    assert (await _shelf(client, slug)).json()["units"] == [], "priced is not listed"

    # A listed child in an INTAKE lot is still not on the shelf: the lot is the release switch.
    r = await client.post(f"/staff/assets/{aid}/status", json={"status": "listed"}, headers=_h(tok))
    assert r.status_code == 200, r.text
    assert (await _shelf(client, slug)).json()["units"] == [], "a listed unit in an intake lot"
    assert await _catalog_item(client, tag) is None, "intake lot must not publish the parent"

    # -- List --------------------------------------------------------------------------
    r = await client.post(f"/staff/lots/{lot['id']}/activate", headers=_h(tok))
    assert r.status_code == 200 and r.json()["status"] == "active", r.text

    body = (await _shelf(client, slug)).json()
    assert [u["id"] for u in body["units"]] == [aid], body
    assert body["units"][0] == {"id": aid, "grade": "A", "sale_price_cents": 24900,
                                "serial_tail": "1234"}
    # The parent describes the model; it never carries a price of its own.
    assert "sale_price_cents" not in body, body

    item = await _catalog_item(client, tag)
    assert item is not None
    assert item["slug"] == slug and item["units_available"] == 1
    assert item["price_from_cents"] == 24900
    assert item["specs"] == {"storage": "128GB"}

    await _cleanup_identities()


async def test_e2e_the_unit_a_shopper_buys_is_the_exact_child(client):
    """Checkout locks the child, not the parent: the order line names the unit that was bought."""
    tag = _tag()
    tok = await _staff(client, "admin")
    oid = None
    try:
        pid, slug = await _product(client, tok, tag)
        lot = await _lot(client, tok, tag)
        aid = await _sellable(client, tok, lot["lot_number"], tag + "-BUY", pid, 31900)
        await client.post(f"/staff/lots/{lot['id']}/activate", headers=_h(tok))

        r = await client.post("/store/reservations", json={"asset_id": aid})
        assert r.status_code == 201 and r.json()["asset_id"] == aid, r.text

        # Reserving the only child takes it off the shelf - the parent is still there, empty.
        assert (await _shelf(client, slug)).json()["units"] == []
        assert await _catalog_item(client, tag) is None, "a fully reserved parent leaves the list"

        # ... and releasing it puts the child back.
        r = await client.post(f"/store/reservations/{r.json()['reservation_id']}/release")
        assert r.status_code == 200 and r.json()["asset_status"] == "listed", r.text
        assert [u["id"] for u in (await _shelf(client, slug)).json()["units"]] == [aid]

        r = await client.post("/store/checkout", json={"asset_ids": [aid], **CHECKOUT})
        assert r.status_code == 200, r.text
        out = r.json()
        oid = out["order_public_id"]
        assert out["subtotal_cents"] == 31900, out

        # The line carries the CHILD id (and its parent alongside, for reporting).
        line = await _rows("SELECT asset_id, product_id, unit_price_cents FROM order_lines "
                           "WHERE order_id = (SELECT id FROM orders WHERE public_id = :o)",
                           o=oid)
        assert len(line) == 1, line
        assert line[0] == {"asset_id": aid, "product_id": pid, "unit_price_cents": 31900}, line

        r = await client.post(f"/store/orders/{oid}/pay")
        assert r.status_code == 200, r.text
        r = await client.post(f"/store/orders/{oid}/simulate-payment")
        assert r.status_code == 200 and r.json()["status"] == "paid", r.text
        assert await _one("SELECT status FROM assets WHERE id = :i", i=aid) == "sold"
    finally:
        if oid is not None:
            await _purge_order(oid)
        await _cleanup_identities()


# ------------------------------------------------------------------- the parent/child shape

async def test_two_parents_sharing_a_model_keep_their_own_shelves(client):
    """The market-hint case: one model arrives as two product records. Their children must not mix.

    A shopper who finds parent A must see A's units and A's price - not the cheaper sibling B that
    happens to carry the same model string.
    """
    tag = _tag()
    tok = await _staff(client, "admin")
    model = "Model " + tag[-6:]
    pid_a, slug_a = await _product(client, tok, tag + "A", model)
    pid_b, slug_b = await _product(client, tok, tag + "B", model)
    assert slug_a != slug_b

    lot = await _lot(client, tok, tag)
    a1 = await _sellable(client, tok, lot["lot_number"], tag + "-A1", pid_a, 40000)
    b1 = await _sellable(client, tok, lot["lot_number"], tag + "-B1", pid_b, 15000)
    await client.post(f"/staff/lots/{lot['id']}/activate", headers=_h(tok))

    a, b = (await _shelf(client, slug_a)).json(), (await _shelf(client, slug_b)).json()
    assert [u["id"] for u in a["units"]] == [a1], a
    assert [u["id"] for u in b["units"]] == [b1], b
    assert a["units"][0]["sale_price_cents"] == 40000
    assert b["units"][0]["sale_price_cents"] == 15000

    # Each parent's headline price is the min over its OWN children, so the 15000 sibling cannot
    # drag parent A's "from" price down.
    item_a = await _catalog_item(client, tag + "A")
    assert item_a is not None and item_a["price_from_cents"] == 40000, item_a
    await _cleanup_identities()


async def test_a_child_is_held_back_until_its_own_lot_is_released(client):
    """Two lots, one active: only the released lot's child is on the shelf, in price order."""
    tag = _tag()
    tok = await _staff(client, "admin")
    pid, slug = await _product(client, tok, tag)
    open_lot = await _lot(client, tok, tag, "OPEN")
    held_lot = await _lot(client, tok, tag, "HELD")

    dear = await _sellable(client, tok, open_lot["lot_number"], tag + "-DEAR", pid, 52000)
    cheap = await _sellable(client, tok, held_lot["lot_number"], tag + "-CHEAP", pid, 11000)
    await client.post(f"/staff/lots/{open_lot['id']}/activate", headers=_h(tok))

    body = (await _shelf(client, slug)).json()
    assert [u["id"] for u in body["units"]] == [dear], "the held lot's child must not be visible"
    item = await _catalog_item(client, tag)
    assert item is not None and item["units_available"] == 1
    assert item["price_from_cents"] == 52000, "the held child must not affect the from-price"

    # Releasing the second lot adds its child, and the cheapest child now leads.
    await client.post(f"/staff/lots/{held_lot['id']}/activate", headers=_h(tok))
    body = (await _shelf(client, slug)).json()
    assert [u["id"] for u in body["units"]] == [cheap, dear], "units arrive cheapest first"
    item = await _catalog_item(client, tag)
    assert item["units_available"] == 2 and item["price_from_cents"] == 11000, item

    # A child in a lot that is still held back cannot be reserved even by its exact id: the lot
    # is the gate, not the unit's own status, and knowing the id does not get around it.
    third_lot = await _lot(client, tok, tag, "STILL-HELD")
    still_held = await _sellable(client, tok, third_lot["lot_number"], tag + "-HELD", pid, 8000)
    r = await client.post("/store/reservations", json={"asset_id": still_held})
    assert r.status_code == 409 and "lot" in r.json()["detail"], r.text
    r = await client.post("/store/checkout", json={"asset_ids": [still_held], **CHECKOUT})
    assert r.status_code == 409 and "lot" in r.json()["detail"], r.text
    assert [u["id"] for u in (await _shelf(client, slug)).json()["units"]] == [cheap, dear]
    await _cleanup_identities()


async def test_unlisted_and_unpriced_children_never_reach_the_shelf(client):
    """Only listed children are offered, and a serial is masked to its last four digits."""
    tag = _tag()
    tok = await _staff(client, "admin")
    pid, slug = await _product(client, tok, tag)
    lot = await _lot(client, tok, tag)
    ln = lot["lot_number"]

    on_sale = await _sellable(client, tok, ln, tag + "-SALE-9F3C", pid, 27500)
    # Graded and priced, but never listed: it exists, it is real, and it is not for sale.
    graded_only = await _scan(client, tok, ln, tag + "-GRADED-ONLY", pid)
    r = await client.post(f"/staff/assets/{graded_only}/grade",
                          json={"grade": "B", "test_first": True}, headers=_h(tok))
    assert r.status_code == 200, r.text
    r = await client.post(f"/staff/assets/{graded_only}/price", json={"sale_price_cents": 9900},
                          headers=_h(tok))
    assert r.status_code == 200, r.text
    # Fresh off the dock, not even graded.
    received_only = await _scan(client, tok, ln, tag + "-RECEIVED-ONLY", pid)

    await client.post(f"/staff/lots/{lot['id']}/activate", headers=_h(tok))

    body = (await _shelf(client, slug)).json()
    assert [u["id"] for u in body["units"]] == [on_sale], body
    item = await _catalog_item(client, tag)
    assert item["units_available"] == 1 and item["price_from_cents"] == 27500, item
    for hidden in (graded_only, received_only):
        assert await _one("SELECT status FROM assets WHERE id = :i", i=hidden) != "listed"

    # The shop is told the last four digits and nothing more.
    assert body["units"][0]["serial_tail"] == "9F3C"
    raw = (await _shelf(client, slug)).text
    assert tag + "-SALE-9F3C" not in raw, "the full serial must not travel to the storefront"
    await _cleanup_identities()


async def test_a_parent_with_no_children_renders_empty_rather_than_missing(client):
    """The empty shelf is a page, not an error - and an unknown slug is a clean 404."""
    tag = _tag()
    tok = await _staff(client, "admin")
    pid, slug = await _product(client, tok, tag)
    lot = await _lot(client, tok, tag)

    r = await _shelf(client, slug)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["units"] == [] and body["slug"] == slug
    assert body["title"].startswith(tag) and body["brand"] and body["category"]
    assert "sale_price_cents" not in body and "price_from_cents" not in body, body

    # Every child hidden: an intake lot hides a fully listed child too.
    aid = await _sellable(client, tok, lot["lot_number"], tag + "-HIDDEN", pid, 19900)
    assert (await _shelf(client, slug)).json()["units"] == []
    assert await _one("SELECT status FROM assets WHERE id = :i", i=aid) == "listed"

    r = await client.get("/store/catalog/" + tag.lower() + "-no-such-product")
    assert r.status_code == 404, r.text
    await _cleanup_identities()
