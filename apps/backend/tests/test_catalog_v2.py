"""Catalog v2: the new categories reach the storefront, and every product points at a glyph.

Three halves, all hermetic:

* the GROWTH is asserted as a DELTA. The demo store is live and its owner seeds it, so a test that
  counted the products in `monitors` absolutely would pass or fail depending on whether the seeder
  has run; this one counts before and after its own product instead, one per category that held no
  products at all before catalog v2, and reads the counts from `/store/categories` - the chips' own
  source, so the assertion is about what a shopper can navigate to, not about a table.
* the SEEDER'S DATA is checked here rather than on the owner's store, because the live run is the
  owner's: the spread the spec asks for, unique slugs, the price bands, and - the failure that
  cannot be recovered from at run time - that every brand and category slug the catalog names
  really exists, since `POST /staff/products` answers 422 for a slug it does not know.
* the ICON URL round-trips through the CMS (where the seeder reads it back) and out to the public
  catalog page, and the seeder's own skip-when-unchanged rule is exercised on the real function.

WHAT THIS FILE LEAVES. Assets and their ledger rows are append-only, and the app role cannot delete
them (`stock_movements` refuses DELETE by design), so a unit this file lists cannot be removed - it
can only be sold. Each fixture unit is therefore checked out and paid for at the end, which takes
it out of the catalog exactly as the seeder's own order phase takes its units out, and then the
other two halves of the trail are put back by hand:

* the ORDER rows are deleted again, because `GET /store/best-sellers` rolls up `order_lines x
  orders` behind a twelve-row ceiling - a leftover paid order is a permanent row in the thing that
  endpoint measures, and enough of them tie another test's fixture out of its own response;
* the fixture PRODUCTS are archived (`status = 'archived'`, the schema's own off-storefront state),
  because a product row cannot be deleted while an asset references it and a live, stockless product
  still counts towards its category chip.

What is left is the ledger and the audit trail - append-only by design, and invisible to every
storefront route.
"""
import uuid

import httpx
from sqlalchemy import text

from app.bootstrap_staff import bootstrap
from app.core.db import get_engine
from scripts.seed_demo import (CATALOG, DEFAULT_UNITS, PRE_V2, UNITS_BY_CATEGORY, ensure_icon,
                               slug_for)

# The spread catalog v2 adds: one entry per line of the spec, seven categories. The three laptops
# job 4 seeded bring the laptop row to the spec's ten.
NEW_SPREAD = {"laptops": 7, "desktops": 6, "monitors": 6, "networking": 6,
              "accessories": 10, "parts": 6, "processors": 6}

# Grade-A base price per new category, in cents (the spec's AUD bands).
PRICE_BANDS = {"accessories": (1900, 19900), "parts": (2900, 39900), "monitors": (9900, 59900),
               "processors": (5900, 49900), "desktops": (39900, 99900),
               "networking": (4900, 150000), "laptops": (29900, 129900)}

# The categories this file seeds into, one product each: (slug, chip name, brand). The chip name is
# the migration's display name, which is what `/store/categories` and the catalog filter use.
SPREAD = (("monitors", "Monitors", "lg"), ("networking", "Networking", "netgear"),
          ("processors", "Processors", "amd"))

ADDRESS = {"shipping_country": "AU", "ship_to_name": "Pytest catalog v2", "ship_line1": "1 Test St",
           "ship_city": "Melbourne", "ship_state": "VIC", "ship_postcode": "3000"}


def _h(tok: str) -> dict:
    return {"Authorization": "Bearer " + tok}


class _FakeApi:
    """The one method `ensure_icon` uses, recording what it was asked to write."""

    def __init__(self):
        self.calls: list[tuple[int, str]] = []

    def patch(self, path: str, body=None, **kw) -> httpx.Response:
        self.calls.append((int(path.rsplit("/", 1)[-1]), (body or {}).get("image_url")))
        return httpx.Response(200, json={"ok": True})

    @staticmethod
    def need(r: httpx.Response, code: int) -> httpx.Response:
        assert r.status_code == code, r.status_code
        return r


async def _staff(client) -> tuple[dict, str]:
    email = "pytest-" + uuid.uuid4().hex + "@test.rfo"
    _, pw = await bootstrap(email, "admin")
    r = await client.post("/staff/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return _h(r.json()["access_token"]), email


async def _drop_staff(email: str) -> None:
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("DELETE FROM refresh_tokens WHERE identity_id IN "
                             "(SELECT id FROM staff_users WHERE email = :e)"), {"e": email})
        await c.execute(text("DELETE FROM staff_users WHERE email = :e"), {"e": email})


async def _make_product(client, h: dict, slug: str, brand: str, category: str, title: str) -> int:
    """One live product in `category`. No stock: a product is on the storefront once its lot is."""
    r = await client.post("/staff/products", headers=h, json={
        "brand_slug": brand, "category_slug": category, "model": title, "title": title, "slug": slug,
        "specs": {"note": "pytest catalog v2"}, "description": "Pytest catalog v2 fixture."})
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _list_one(client, h: dict, product_id: int) -> int:
    """Put one listed unit on a product, in an active lot - the least that makes it catalog-visible.

    Every step is a real door (lot, scan-in, tested, grade, price, activate, list), because the
    storefront's own query is what decides whether the product shows: a listed unit in an ACTIVE
    lot. Returns the asset id.
    """
    r = await client.post("/staff/lots", headers=h,
                          json={"warehouse": "WH-A", "notes": "pytest catalog v2"})
    assert r.status_code == 201, r.text
    lot_id, lot_number = r.json()["id"], r.json()["lot_number"]

    serial = "pytest-cat2-" + uuid.uuid4().hex[:12]
    r = await client.post("/staff/assets/scan-in", headers=h,
                          json={"serial_number": serial, "lot_number": lot_number,
                                "product_id": product_id})
    assert r.status_code == 201, r.text
    asset_id = r.json()["id"]
    for path, body in ((f"/staff/assets/{asset_id}/status", {"status": "tested"}),
                       (f"/staff/assets/{asset_id}/grade", {"grade": "B"}),
                       (f"/staff/assets/{asset_id}/price", {"sale_price_cents": 24900})):
        assert (await client.post(path, headers=h, json=body)).status_code == 200
    assert (await client.post(f"/staff/lots/{lot_id}/activate", headers=h)).status_code == 200
    assert (await client.post(f"/staff/assets/{asset_id}/status", headers=h,
                              json={"status": "listed"})).status_code == 200
    return asset_id


async def _sell(client, asset_id: int) -> str:
    """Buy the fixture unit: the only way left to take a listed asset out of the catalog.

    Returns the order's public id, which the caller MUST remove again (see the module docstring):
    the sale is what takes the unit off the storefront, the order row is what would otherwise stay
    in best-sellers' rollup for good.
    """
    r = await client.post("/store/checkout", json={"asset_ids": [asset_id], **ADDRESS})
    assert r.status_code == 200, r.text
    oid = r.json()["order_public_id"]
    assert (await client.post(f"/store/orders/{oid}/pay")).status_code == 200
    assert (await client.post(f"/store/orders/{oid}/simulate-payment")).status_code == 200
    return oid


async def _drop_orders(oids: list[str]) -> None:
    """Delete the order side of a sale - the same rows, in the same order, that
    `test_storefront_api.test_best_sellers_lists_paid_product_and_binds_limit` deletes."""
    eng = get_engine()
    async with eng.begin() as c:
        for oid in oids:
            for table in ("order_tax_lines", "payments", "order_lines"):
                await c.execute(text(f"DELETE FROM {table} WHERE order_id IN "
                                     "(SELECT id FROM orders WHERE public_id = :o)"), {"o": oid})
            await c.execute(text("DELETE FROM orders WHERE public_id = :o"), {"o": oid})


async def _retire(products: list[int]) -> None:
    """Take the fixture products off the storefront: `archived` is the schema's own off state, and a
    product row cannot be deleted while an asset of its own still references it."""
    eng = get_engine()
    async with eng.begin() as c:
        for pid in products:
            await c.execute(text("UPDATE products SET status = 'archived' WHERE id = :i"), {"i": pid})


async def _category_counts(client) -> dict:
    r = await client.get("/store/categories")
    assert r.status_code == 200, r.text
    return {c["name"]: c["n"] for c in r.json()}


async def test_products_in_the_new_categories_reach_the_storefront(client):
    """A delta of exactly one product per never-seeded category, seen where a shopper sees it.

    Three categories that held nothing before catalog v2, one product each with one listed unit, so
    the count that moves is the category chip's own count and the catalog page for that chip. A
    product that never became buyable cannot be counted by mistake: the storefront query needs the
    listed unit in an active lot, which is exactly what the seeder creates per entry.
    """
    h, email = await _staff(client)
    units: list[int] = []
    products: list[int] = []
    orders: list[str] = []
    try:
        before = await _category_counts(client)
        stamp = uuid.uuid4().hex[:8]
        created = []
        for category, name, brand in SPREAD:
            slug = f"pytest-cat2-{category}-{stamp}"
            pid = await _make_product(client, h, slug, brand, category,
                                      f"Pytest {name} device {stamp}")
            products.append(pid)
            units.append(await _list_one(client, h, pid))
            created.append((category, name, slug))

        after = await _category_counts(client)
        moved = {name: (before.get(name, 0), after.get(name, 0)) for _c, name, _s in created}
        assert all(now == was + 1 for was, now in moved.values()), moved

        for category, name, slug in created:
            r = await client.get("/store/catalog", params={"category": name, "limit": 100})
            assert r.status_code == 200, r.text
            slugs = [i["slug"] for i in r.json()]
            assert slug in slugs, f"{slug} is not on the {name} chip: {slugs}"

        # Spend the fixtures: a sold unit leaves the catalog, which is both the proof that the
        # listed state above was real stock and the way this file leaves no pytest product buyable.
        for asset_id in units:
            orders.append(await _sell(client, asset_id))
        mine = {s for _c, _n, s in created}
        for _c, name, _s in created:
            r = await client.get("/store/catalog", params={"category": name, "limit": 100})
            assert not (mine & {i["slug"] for i in r.json()}), f"a sold fixture is still on {name}"

        # ... and the storefront goes back to what it was: no chip counts a fixture product.
        await _retire(products)
        restored = await _category_counts(client)
        for _c, name, _s in created:
            was, now = before.get(name, 0), restored.get(name, 0)
            assert now == was, f"the {name} chip still counts a fixture: {was} -> {now}"
    finally:
        await _drop_orders(orders)
        await _retire(products)
        await _drop_staff(email)


async def test_the_icon_url_round_trips_from_the_cms_to_the_catalog_page(client):
    """The two ends of the seeder's icon step: the CMS list it reads back, and the storefront.

    The product is this test's own - no stock, so it can be deleted again - and the URL shape is the
    seeder's own, asserted where the storefront receives it rather than as the string the seeder
    happened to build.
    """
    h, email = await _staff(client)
    stamp = uuid.uuid4().hex[:8]
    slug = "pytest-cat2-icon-" + stamp
    pid = await _make_product(client, h, slug, "dell", "monitors", f"Pytest Monitor {stamp}")
    try:
        rows = (await client.get("/staff/cms/products", headers=h)).json()
        row = next((r for r in rows if r["slug"] == slug), None)
        assert row is not None and row["image_url"] is None, "a fresh product carries no art"

        url = "/icons/" + slug + ".svg"
        r = await client.patch(f"/staff/cms/products/{pid}", headers=h, json={"image_url": url})
        assert r.status_code == 200, r.text

        row = next((r for r in (await client.get("/staff/cms/products", headers=h)).json()
                    if r["slug"] == slug), None)
        assert row is not None and row["image_url"] == url, row
        detail = (await client.get("/store/catalog/" + slug)).json()
        assert detail["image_url"] == url, detail

        # The rule the seeder is idempotent on: a product already carrying its glyph URL is not
        # PATCHed again. Exercised on the real function with a client that records the call - the
        # seeder itself cannot run here, it drives the live API over HTTP.
        fake = _FakeApi()
        assert ensure_icon(fake, pid, slug, {slug: {"id": pid, "image_url": url}}) is False
        assert fake.calls == [], "an unchanged icon URL must not be written again"
        assert ensure_icon(fake, pid, slug, {}) is True and fake.calls == [(pid, url)], fake.calls
    finally:
        eng = get_engine()
        async with eng.begin() as c:
            await c.execute(text("DELETE FROM products WHERE id = :i"), {"i": pid})
        await _drop_staff(email)


async def test_the_catalog_v2_spread_is_complete_and_resolvable(client):
    """The data half of the seeder, checked in the gate instead of on the owner's live run.

    The spread, the slugs, the bands and the specs are the spec's requirements; the slug check is
    the one that matters most, because a brand or category this database does not have makes
    `POST /staff/products` answer 422 and takes the whole live run down with it.

    `client` is not used for HTTP here: it is the fixture whose teardown disposes the engine, and
    this test opens a connection of its own. Leaving it out pools a connection inside a finished
    event loop, and the next file to touch the database inherits it ("Future attached to a
    different loop") - the same reason `tests/test_agent_identity.py`'s cleanup fixture depends on
    `client` on purpose.
    """
    new = CATALOG[PRE_V2:]
    spread: dict[str, int] = {}
    for entry in new:
        spread[entry[2]] = spread.get(entry[2], 0) + 1
    assert spread == NEW_SPREAD, spread
    assert sum(1 for e in CATALOG if e[2] == "laptops") == 10, "job 4's three laptops make ten"

    codes = [e[0] for e in CATALOG]
    slugs = [slug_for(c) for c in codes]
    assert len(set(codes)) == len(codes) and len(set(slugs)) == len(slugs), "codes and slugs unique"
    assert all(s and s == s.lower() for s in slugs), slugs

    for code, brand, category, model, title, base, specs in new:
        low, high = PRICE_BANDS[category]
        assert low <= base <= high, f"{code}: {base} outside the {category} band {low}-{high}"
        assert specs and all(isinstance(k, str) and str(v).strip() for k, v in specs.items()), code
        assert model.strip() and title.strip(), code

    async with get_engine().connect() as c:
        brands = set((await c.execute(text("SELECT slug FROM brands"))).scalars().all())
        categories = set((await c.execute(text("SELECT slug FROM categories"))).scalars().all())
    missing = sorted({e[1] for e in new} - brands) + sorted({e[2] for e in new} - categories)
    assert not missing, f"slugs /staff/products would refuse with 422: {missing}"

    # Units per product, per the acceptance ("accessories 2-3 units, others 2").
    assert UNITS_BY_CATEGORY.get("accessories", DEFAULT_UNITS) == 3
    assert DEFAULT_UNITS == 2
