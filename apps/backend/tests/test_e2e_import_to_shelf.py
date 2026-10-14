"""The safety net, part one: one supplier CSV walks from the dock to a price on the shelf.

Every door this chain crosses already has a suite of its own - `test_product_import` pins the
reader, `test_lot_process` the status ladder, `test_e2e_lifecycle` the scan-in path to the shop.
What none of them does is walk a SHEET to a SHOPPING PAGE, which is the only path a supplier's
workbook actually takes. The gap that leaves is specific: each door can be green while the join
between them is wrong - a commit that lands `listed` but in an intake lot, a release that publishes
the lot without the sheet's price surviving it, a role wall that holds on preview and not on
commit. Door tests cannot see any of that, because none of them owns both ends of the join.

So this file asserts the two things only a chain test can:

  * the shelf stays EMPTY until the lot is released, and carries the SHEET'S OWN PRICE the moment
    it is - the price is the one number the chain could plausibly lose, and the one the shopper
    is quoted;
  * the role walls hold at every rung of the chain. A plain staff identity (`sales`) reads no
    sheet, writes no sheet, and cannot release one either: importing stock and publishing it are
    two separate authorities, and this is the test that says so end to end.

The unit cannot be deleted. `rfo_app` holds only SELECT+INSERT on `stock_movements`, so the
ledger row is append-only by GRANT, and the ledger's FK then pins the asset; the asset references
its lot and product, which pins those too. The cleanup therefore CANCELS the lot rather than
deleting anything: the catalog requires an `active` lot, so a cancelled lot takes the unit off the
shop, and the transition is legal from whichever rung the test reached. The last assertion in the
test is that this actually works, because a cleanup nobody checks is a cleanup that stops working
in silence. Rows nothing references are purged outright; the rest keep the pytest tag and stay in
dev, invisible to the shop.
"""

import csv
import io
import uuid

from sqlalchemy import text

from app.bootstrap_staff import bootstrap
from app.core.db import get_engine

# The twelve-column sheet the original importer contract was written for. The wide workbook has
# its own suite; this test wants the shortest sheet that still states a price, a grade and a
# listed status, because those three are exactly what the shelf needs and nothing else is load
# bearing for the walk.
HEADER = ["Asset", "Status", "Lot", "Class", "Mfg", "Model", "Grade", "Serial#",
          "Resale", "Audit", "Cosmetic", "Functional"]


# --------------------------------------------------------------------------- helpers
# Per-file, as everywhere else in this suite: conftest carries the client fixture and nothing
# else, so each file copies the handful of tools it needs.

def _h(tok: str) -> dict:
    return {"Authorization": "Bearer " + tok}


def _tag() -> str:
    """One alphanumeric token that goes into the brand, the model, the lot and the serial.

    The catalog's `q` runs through `websearch_to_tsquery`, which splits on a hyphen: a tag with one
    in it would match several lexemes and stop being unique to this test. A single token cannot be
    split, so a hit is this test's product and no other. The tag is also the product's TITLE (the
    importer titles a new product with its model), which is what the search actually matches.
    """
    return "pytestSN" + uuid.uuid4().hex[:12]


async def _staff(client, role: str) -> str:
    email = "pytest-" + uuid.uuid4().hex + "@test.rfo"
    sid, pw = await bootstrap(email, role)
    r = await client.post("/staff/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _csv(rows) -> bytes:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(HEADER)
    for row in rows:
        writer.writerow(row)
    return buf.getvalue().encode("utf-8")


def _row(tag: str) -> list:
    """One row of the sheet, in HEADER's order: listed, priced and graded.

    A `listed` row is the shortest honest route to the shelf - the importer writes the status the
    sheet states, so the unit lands one release away from the shop instead of needing three more
    doors walked. The price is the sheet's own `Resale` column, which is the number this test
    follows all the way to the catalog.
    """
    values = {
        "Asset": "TAG-" + tag, "Status": "listed", "Lot": tag + "-LOT-1", "Class": "Phones",
        "Mfg": tag, "Model": tag, "Grade": "A", "Serial#": tag + "-S1", "Resale": "279.00",
        "Audit": "audit notes", "Cosmetic": "cosmetic notes", "Functional": "functional notes",
    }
    return [values[c] for c in HEADER]


async def _one(sql: str, **params):
    eng = get_engine()
    async with eng.begin() as c:
        return (await c.execute(text(sql), params)).scalar_one()


async def _counts(tag: str) -> dict:
    eng = get_engine()
    async with eng.begin() as c:
        assets = (await c.execute(text(
            "SELECT count(*) FROM assets WHERE serial_number::text LIKE :p"), {"p": tag + "%"})).scalar_one()
        lots = (await c.execute(text(
            "SELECT count(*) FROM lots WHERE lot_number LIKE :p"), {"p": tag + "%"})).scalar_one()
        products = (await c.execute(text(
            "SELECT count(*) FROM products WHERE title = :t"), {"t": tag})).scalar_one()
    return {"assets": assets, "lots": lots, "products": products}


async def _catalog_item(client, tag: str) -> dict | None:
    """This test's parent as the SHOPPING LIST shows it - or None when the shelf is empty."""
    r = await client.get("/store/catalog", params={"q": tag, "limit": 100})
    assert r.status_code == 200, r.text
    hits = [x for x in r.json() if tag.lower() in x["title"].lower()]
    assert len(hits) <= 1, hits
    return hits[0] if hits else None


async def _cleanup(tag: str):
    """Take the unit off the shop, then delete only what nothing references.

    The lot itself survives - the asset points at it, and the asset cannot be deleted because the
    append-only ledger's FK pins it. That is a property of the database, not an oversight here:
    `test_product_import` records the same concession for the same reason. Cancelling the lot is
    what makes the leftover invisible rather than merely tagged, because the catalog's join
    requires `l.status = 'active'`.
    """
    eng = get_engine()
    async with eng.begin() as c:
        # The product groups FIRST. The importer now declares one per brand+model+grade on the
        # sheet (`_ensure_product_groups`), and these hang off the BRAND rather than the product -
        # so the brand delete below cannot succeed while one is left, and the suite would leave a
        # row behind on every run for a reason that has nothing to do with what it tests.
        await c.execute(text(
            "DELETE FROM product_groups WHERE brand_id IN"
            " (SELECT id FROM brands WHERE name = :n)"), {"n": tag})
        await c.execute(text("UPDATE lots SET status = 'cancelled' WHERE lot_number LIKE :p"
                             " AND status IN ('intake', 'active')"), {"p": tag + "%"})
        await c.execute(text(
            "DELETE FROM products WHERE title = :t AND NOT EXISTS"
            " (SELECT 1 FROM assets a WHERE a.product_id = products.id)"), {"t": tag})
        await c.execute(text(
            "DELETE FROM lots WHERE lot_number LIKE :p AND NOT EXISTS"
            " (SELECT 1 FROM assets a WHERE a.lot_id = lots.id)"), {"p": tag + "%"})
        await c.execute(text(
            "DELETE FROM brands WHERE name = :n AND NOT EXISTS"
            " (SELECT 1 FROM products p WHERE p.brand_id = brands.id)"), {"n": tag})


async def _cleanup_identities():
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("DELETE FROM refresh_tokens WHERE identity_id IN "
                             "(SELECT id FROM staff_users WHERE email LIKE 'pytest-%')"))
        await c.execute(text("DELETE FROM staff_users WHERE email LIKE 'pytest-%'"))
        await c.execute(text("DELETE FROM users WHERE email LIKE 'pytest-%'"))


# --------------------------------------------------------------------------- the chain

async def test_a_supplier_csv_reaches_the_storefront_price_through_the_role_walls(client):
    """Import a sheet -> the walls hold at both ends -> the shopper sees the sheet's price.

    The four stages, and what each one is here to catch:

      * REFUSE - a `sales` token reads no sheet and writes none, and a refused import writes
        NOTHING (asserted by count, not by status code alone);
      * IMPORT - the row lands `listed` at the sheet's own 27900, inside a lot that is still
        `intake`, so importing stock does not publish it;
      * RELEASE - the same `sales` token is refused the release switch, and a refused release
        publishes nothing; the admin release is what puts the unit on the shelf;
      * QUOTE - the catalog's `price_from_cents` and the product page's per-unit
        `sale_price_cents` are both the sheet's 27900, and the serial is masked to four digits.
    """
    tag = _tag()
    serial = tag + "-S1"
    try:
        await _cleanup_identities()
        admin = _h(await _staff(client, "admin"))
        sales = _h(await _staff(client, "sales"))
        data = _csv([_row(tag)])

        # -- Refuse: the import door is admin/manager, and a refusal writes nothing ------------
        r = await client.post("/staff/imports/products/preview",
                              files={"file": ("sheet.csv", data)}, headers=sales)
        assert r.status_code == 403, r.text
        r = await client.post("/staff/imports/products/commit",
                              files={"file": ("sheet.csv", data)}, headers=sales)
        assert r.status_code == 403, r.text
        anon = await client.post("/staff/imports/products/commit", files={"file": ("sheet.csv", data)})
        assert anon.status_code in (401, 403), anon.text
        assert (await _counts(tag)) == {"assets": 0, "lots": 0, "products": 0}, "a refused import wrote"

        # -- Import: the sheet's price and status, in a lot that is held back -------------------
        r = await client.post("/staff/imports/products/preview",
                              files={"file": ("sheet.csv", data)}, headers=admin)
        assert r.status_code == 200, r.text
        preview = r.json()
        assert preview["summary"]["ready"] == 1 and preview["summary"]["blocked"] == 0, preview
        assert preview["sample"][0]["sale_price_cents"] == 27900, preview["sample"][0]

        c = await client.post("/staff/imports/products/commit",
                              files={"file": ("sheet.csv", data)}, headers=admin)
        assert c.status_code == 200, c.text
        body = c.json()
        assert body["summary"]["assets_created"] == 1, body
        unit = body["assets"][0]
        assert unit["status"] == "listed" and unit["sale_price_cents"] == 27900, unit
        lot_id = body["lots_created"][0]["id"]

        pid = await _one("SELECT id FROM products WHERE title = :t", t=tag)
        slug = await _one("SELECT slug FROM products WHERE id = :i", i=pid)
        assert slug.startswith(tag.lower()), slug
        assert (await _one("SELECT status FROM lots WHERE id = :i", i=lot_id)) == "intake", \
            "an import must not release its own stock"

        # Held back: listed, priced, graded, and nowhere the shopper can see it.
        assert await _catalog_item(client, tag) is None, "an intake lot must not publish the sheet"

        # -- Release: a separate authority, and the wall holds ----------------------------------
        r = await client.post(f"/staff/lots/{lot_id}/activate", headers=sales)
        assert r.status_code == 403, r.text
        assert await _catalog_item(client, tag) is None, "a refused release published the lot"

        r = await client.post(f"/staff/lots/{lot_id}/activate", headers=admin)
        assert r.status_code == 200 and r.json()["status"] == "active", r.text

        # -- Quote: the sheet's number, on both the list and the product page -------------------
        item = await _catalog_item(client, tag)
        assert item is not None, "a released, listed, priced unit must be on the shelf"
        assert item["slug"] == slug and item["units_available"] == 1, item
        assert item["price_from_cents"] == 27900, item

        page = await client.get("/store/catalog/" + slug)
        assert page.status_code == 200, page.text
        shelf = page.json()
        assert [u["id"] for u in shelf["units"]] == [unit["asset_id"]], shelf
        assert shelf["units"][0]["sale_price_cents"] == 27900, shelf
        assert shelf["units"][0]["serial_tail"] == serial[-4:], shelf
        assert serial not in page.text, "the full serial must not travel to the storefront"

        # -- And the cleanup really takes it back off ------------------------------------------
        await _cleanup(tag)
        assert await _catalog_item(client, tag) is None, \
            "a cancelled lot must not stay on the shelf"
    finally:
        await _cleanup(tag)
        await _cleanup_identities()
