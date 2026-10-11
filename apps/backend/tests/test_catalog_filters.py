"""The catalog's filters: brand, unit grade, price band, sort - and the URL that carries them.

Every test here is hermetic and delta-counted. The demo store is live and its owner seeds it, so a
"before" reading of the SAME filtered query is taken first and the growth this file's own rows
caused is what gets asserted; each test also asserts that every row a filter returned really matches
it. A count that moved for an unrelated reason cannot pass both halves.

The design decision these tests pin, because it is the one that is easy to get wrong: grade and
price narrow the UNITS a product is counted and priced by, not merely whether the product appears.
"3 in stock, from $X" under `grade=A` means three grade-A units - so a filter can change
`units_available` and `price_from_cents` for a product the shopper already knew.

What this file leaves behind is the same as every other test that needs stock: assets and their
ledger rows are append-only and the app role cannot delete them, so the fixture products are
ARCHIVED in the `finally` (the schema's own off-state, which takes them off the storefront and out
of the category chips) and the staff identity is removed. Nothing is sold, so no order row joins
`best-sellers`' rollup.
"""
import uuid

from sqlalchemy import text

from app.api.v1 import store_catalog
from app.bootstrap_staff import bootstrap
from app.core.db import get_engine

KINGSTON = "kingston"
SEAGATE = "seagate"


def _h(tok: str) -> dict:
    return {"Authorization": "Bearer " + tok}


async def _staff(client) -> tuple[dict, str]:
    email = "pytest-" + uuid.uuid4().hex + "@test.rfo"
    _, pw = await bootstrap(email, "admin")
    r = await client.post("/staff/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return _h(r.json()["access_token"]), email


async def _staged(client, h: dict, slug: str, brand: str, category: str,
                  units: list[tuple[str, int]]) -> int:
    """One live product with `units` listed - [(grade, sale_price_cents), ...] - in an active lot.

    Real doors all the way (product, lot, scan-in, tested, grade, price, activate, list), because
    the storefront's own query is what has to see them. Returns the product id.
    """
    r = await client.post("/staff/products", headers=h, json={
        "brand_slug": brand, "category_slug": category, "model": "Pytest filter device",
        "title": "Pytest filter device " + slug, "slug": slug, "specs": {"note": "pytest filters"}})
    assert r.status_code == 201, r.text
    pid = r.json()["id"]

    r = await client.post("/staff/lots", headers=h, json={"warehouse": "WH-A", "notes": "pytest filters"})
    assert r.status_code == 201, r.text
    lot_id, lot_number = r.json()["id"], r.json()["lot_number"]

    assets = []
    for grade, price in units:
        serial = "pytest-filter-" + uuid.uuid4().hex[:10]
        r = await client.post("/staff/assets/scan-in", headers=h,
                              json={"serial_number": serial, "lot_number": lot_number,
                                    "product_id": pid})
        assert r.status_code == 201, r.text
        aid = r.json()["id"]
        for path, body in ((f"/staff/assets/{aid}/status", {"status": "tested"}),
                           (f"/staff/assets/{aid}/grade", {"grade": grade}),
                           (f"/staff/assets/{aid}/price", {"sale_price_cents": price})):
            assert (await client.post(path, headers=h, json=body)).status_code == 200
        assets.append(aid)
    assert (await client.post(f"/staff/lots/{lot_id}/activate", headers=h)).status_code == 200
    for aid in assets:
        assert (await client.post(f"/staff/assets/{aid}/status", headers=h,
                                  json={"status": "listed"})).status_code == 200
    return pid


async def _archive(products: list[int]) -> None:
    eng = get_engine()
    async with eng.begin() as c:
        for pid in products:
            await c.execute(text("UPDATE products SET status = 'archived' WHERE id = :i"), {"i": pid})


async def _drop_staff(email: str) -> None:
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("DELETE FROM refresh_tokens WHERE identity_id IN "
                             "(SELECT id FROM staff_users WHERE email = :e)"), {"e": email})
        await c.execute(text("DELETE FROM staff_users WHERE email = :e"), {"e": email})


async def _items(client, query: str) -> list:
    r = await client.get("/store/catalog?limit=100&" + query)
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body, list), "the plain response is the bare array the backoffice reads"
    return body


def _row(items: list, slug: str) -> dict | None:
    return next((i for i in items if i["slug"] == slug), None)


async def test_the_brand_filter_returns_one_brand_and_only_the_rows_we_added(client):
    h, email = await _staff(client)
    products: list[int] = []
    stamp = uuid.uuid4().hex[:8]
    try:
        before = await _items(client, "brand=" + KINGSTON)
        assert all(i["brand"] == "Kingston" for i in before), "the filter holds before we add anything"

        for n in (1, 2):
            products.append(await _staged(client, h, f"pytest-filter-brand-{n}-{stamp}", KINGSTON,
                                          "parts", [("B", 9900)]))

        after = await _items(client, "brand=" + KINGSTON)
        assert all(i["brand"] == "Kingston" for i in after)
        assert len(after) == len(before) + 2, (len(before), len(after))
        assert all(_row(after, f"pytest-filter-brand-{n}-{stamp}") for n in (1, 2))

        other = await _items(client, "brand=" + SEAGATE)
        assert _row(other, f"pytest-filter-brand-1-{stamp}") is None, "another brand must not match"
    finally:
        await _archive(products)
        await _drop_staff(email)


async def test_the_grade_filter_counts_and_prices_the_units_it_selected(client):
    """Two units of one product, grades A and D: each filter sees one unit, at its own price."""
    h, email = await _staff(client)
    slug = "pytest-filter-grade-" + uuid.uuid4().hex[:8]
    products: list[int] = []
    try:
        products.append(await _staged(client, h, slug, KINGSTON, "parts",
                                      [("A", 19900), ("D", 5900)]))

        a = _row(await _items(client, "brand=" + KINGSTON + "&grade=A"), slug)
        assert a is not None, "the grade-A unit must keep the product in the list"
        assert a["units_available"] == 1 and a["price_from_cents"] == 19900, a

        d = _row(await _items(client, "brand=" + KINGSTON + "&grade=D"), slug)
        assert d is not None and d["units_available"] == 1 and d["price_from_cents"] == 5900, d

        assert _row(await _items(client, "brand=" + KINGSTON + "&grade=B"), slug) is None, \
            "no unit of this product is grade B"
        assert _row(await _items(client, "brand=" + KINGSTON + "&grade=A&min_cents=20000"), slug) is None, \
            "grade and price narrow the same unit set"
    finally:
        await _archive(products)
        await _drop_staff(email)


async def test_the_price_band_filters_on_the_unit_price(client):
    h, email = await _staff(client)
    slug = "pytest-filter-band-" + uuid.uuid4().hex[:8]
    products: list[int] = []
    try:
        products.append(await _staged(client, h, slug, KINGSTON, "parts",
                                      [("A", 39900), ("D", 4900)]))

        under = await _items(client, "brand=" + KINGSTON + "&max_cents=10000")
        assert all(i["price_from_cents"] <= 10000 for i in under), "a band must bound every price"
        row = _row(under, slug)
        assert row is not None and row["price_from_cents"] == 4900 and row["units_available"] == 1, row

        middle = await _items(client, "brand=" + KINGSTON + "&min_cents=10000&max_cents=30000")
        assert _row(middle, slug) is None, "the cheap unit is below the band and the dear one above it"

        high = _row(await _items(client, "brand=" + KINGSTON + "&min_cents=30000"), slug)
        assert high is not None and high["price_from_cents"] == 39900, high
    finally:
        await _archive(products)
        await _drop_staff(email)


async def test_the_filters_compose_and_the_url_is_the_state(client):
    """A four-filter URL - the shape a shared link has - and the same link twice, identically."""
    h, email = await _staff(client)
    slug = "pytest-filter-compose-" + uuid.uuid4().hex[:8]
    products: list[int] = []
    try:
        products.append(await _staged(client, h, slug, KINGSTON, "parts", [("D", 5900), ("D", 6900)]))
        query = "category=parts&brand=kingston&grade=D&min_cents=5000&max_cents=8000&sort=price_asc"

        first = await _items(client, query)
        second = await _items(client, query)
        assert [i["slug"] for i in first] == [i["slug"] for i in second], \
            "the same URL must reproduce the same view"

        row = _row(first, slug)
        assert row is not None and row["units_available"] == 2 and row["price_from_cents"] == 5900, row
        assert all(i["category"] == "Parts" for i in first), "the category filter holds"
        assert [i["price_from_cents"] for i in first] == sorted(i["price_from_cents"] for i in first), \
            "sort=price_asc must order by the price it reports"

        # The URL state writes the category SLUG; the display name has always worked too. Same view.
        by_name = await _items(client, query.replace("category=parts", "category=Parts"))
        assert [i["slug"] for i in by_name] == [i["slug"] for i in first]

        # ... and the empty state's own case, for this fixture: a band nothing of its kind is in.
        assert _row(await _items(client, "grade=D&max_cents=1"), slug) is None
    finally:
        await _archive(products)
        await _drop_staff(email)


async def test_the_response_envelope_is_opt_in_and_echoes_the_applied_filters(client):
    """`with_filters=1` adds the applied set and the brand options; without it, the same array."""
    h, email = await _staff(client)
    slug = "pytest-filter-envelope-" + uuid.uuid4().hex[:8]
    products: list[int] = []
    try:
        products.append(await _staged(client, h, slug, KINGSTON, "parts", [("C", 12900)]))

        bare = await _items(client, "brand=" + KINGSTON + "&grade=C")

        r = await client.get("/store/catalog?limit=100&brand=Kingston&grade=c&with_filters=1")
        assert r.status_code == 200, r.text
        body = r.json()
        assert isinstance(body, dict), body
        assert [i["slug"] for i in body["items"]] == [i["slug"] for i in bare], \
            "the envelope must not change which rows come back"
        # The applied set is the SERVER's normalisation, not the caller's spelling.
        assert body["applied"] == {"category": None, "brand": "kingston", "grade": "C",
                                   "min_cents": None, "max_cents": None, "sort": "featured"}
        brands = {b["slug"]: b for b in body["brands"]}
        assert KINGSTON in brands and brands[KINGSTON]["n"] >= 1 and brands[KINGSTON]["name"], brands

        r = await client.get("/store/catalog?limit=100&sort=nonsense&with_filters=1")
        assert r.json()["applied"]["sort"] == "featured", "an unknown sort falls back, as it always did"
    finally:
        await _archive(products)
        await _drop_staff(email)


async def test_a_malformed_filter_is_refused(client):
    for query in ("grade=Z", "grade=AA", "brand=Not%20A%20Slug", "min_cents=-1",
                  "min_cents=100&max_cents=50", "min_cents=999999999999"):
        r = await client.get("/store/catalog?" + query)
        assert r.status_code == 422, (query, r.status_code, r.text)


def test_the_unfiltered_query_is_the_one_this_endpoint_has_always_run():
    """The additive promise, as a property of the statement rather than a promise in a comment."""
    sql = store_catalog._catalog_sql(None, None, None, None, None, "featured")
    assert sql == store_catalog.CATALOG_SELECT.replace("%CAT%", "").replace("%UNIT%", "")
    assert "%" not in sql, "a placeholder that did not expand would be a broken statement"
    for leak in ("a.grade", "a.sale_price_cents >", "a.sale_price_cents <", "b.slug =", "c.slug ="):
        assert leak not in sql, "an unset filter leaked into the statement: " + leak

    # Each filter adds its own clause, and only its own.
    assert "AND a.grade = :grade" in store_catalog._catalog_sql(None, None, "A", None, None, "featured")
    assert "AND a.sale_price_cents >= :min_cents" in store_catalog._catalog_sql(None, None, None, 100, None, "featured")
    assert "AND b.slug = :brand" in store_catalog._catalog_sql(None, "apple", None, None, None, "featured")
    assert store_catalog._catalog_sql(None, None, None, None, None, "price_asc").endswith(
        "ORDER BY min(a.sale_price_cents), p.title\nLIMIT :lim OFFSET :off")
