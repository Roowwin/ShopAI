"""The inventory read: the shape it must keep, and the filters it grew.

FOUR OTHER THINGS READ `GET /staff/assets` AND THREE OF THEM WOULD BREAK ON AN OBJECT - that is the
whole reason the envelope is opt-in, and the first test here is the alarm that rings if anybody
decides the flag is clutter:

  * `test_daily_ops` does `len(rows)` and indexes `x["serial_number"]`;
  * `seed_demo` and `rehearse_day` declare `-> list[dict]` and iterate;
  * `test_staff_read_walls` asserts the admin response is EXACTLY `[]`, and `{}` is not `[]`.

The rest pins what the Inventory screen now depends on: a total that agrees with the rows, facets
that do NOT filter themselves, and a search that reaches the database rather than the page.

Identities are named `mission-inv-`, not `pytest-`, so a sibling file's
`DELETE FROM staff_users WHERE email LIKE 'pytest-%'` teardown cannot log this suite out mid-test.
This file sweeps its own prefix.
"""

import uuid

import pytest_asyncio
from sqlalchemy import text

from app.bootstrap_staff import bootstrap
from app.core.db import get_engine

IDENTITY_PREFIX = "mission-inv-"


def _h(tok: str) -> dict:
    return {"Authorization": "Bearer " + tok}


async def _staff(client, role: str = "admin") -> str:
    email = IDENTITY_PREFIX + uuid.uuid4().hex + "@test.rfo"
    _, pw = await bootstrap(email, role)
    r = await client.post("/staff/auth/login", json={"email": email, "password": pw})
    return r.json()["access_token"]


@pytest_asyncio.fixture(autouse=True)
async def _sweep(client):
    """Remove only this file's rows. `client` is named for the ordering: the conftest fixture
    disposes the engine on teardown, so a cleanup outside its lifetime errors the NEXT test."""
    async def sweep():
        eng = get_engine()
        async with eng.begin() as c:
            await c.execute(text(
                "DELETE FROM assets WHERE lot_id IN "
                "(SELECT id FROM lots WHERE lot_number LIKE :p)"), {"p": "mission-inv-%"})
            await c.execute(text(
                "DELETE FROM assets WHERE product_id IN "
                "(SELECT id FROM products WHERE brand_id IN "
                " (SELECT id FROM brands WHERE name LIKE :p))"), {"p": "mission-inv-%"})
            await c.execute(text(
                "DELETE FROM products WHERE brand_id IN "
                "(SELECT id FROM brands WHERE name LIKE :p)"), {"p": "mission-inv-%"})
            await c.execute(text("DELETE FROM lots WHERE lot_number LIKE :p"), {"p": "mission-inv-%"})
            await c.execute(text("DELETE FROM categories WHERE slug LIKE :p"), {"p": "mission-inv-%"})
            await c.execute(text(
                "DELETE FROM brands WHERE name LIKE :p AND NOT EXISTS "
                "(SELECT 1 FROM products p WHERE p.brand_id = brands.id)"), {"p": "mission-inv-%"})
            await c.execute(text("DELETE FROM refresh_tokens WHERE identity_id IN "
                                 "(SELECT id FROM staff_users WHERE email LIKE :i)"),
                            {"i": IDENTITY_PREFIX + "%"})
            await c.execute(text("DELETE FROM staff_users WHERE email LIKE :i"),
                            {"i": IDENTITY_PREFIX + "%"})
    await sweep()
    yield
    await sweep()


async def _seed(tag: str, *, model: str, category: str, statuses: list[tuple[str, str | None]],
                warehouse: str = "Testville") -> dict:
    """A brand, a category, a product, a lot and one unit per (status, grade) pair.

    Written with plain SQL rather than through the doors for the same reason `test_product_groups`
    does: the filters must be exercised over combinations the doors cannot all produce, and a
    fixture that walked the ladder could only ever build a subset of the states the table has to
    render.
    """
    eng = get_engine()
    async with eng.begin() as c:
        brand = (await c.execute(text("INSERT INTO brands (name, slug) VALUES (:n, :n) RETURNING id"),
                                 {"n": tag})).scalar_one()
        cat = (await c.execute(text("INSERT INTO categories (name, slug) VALUES (:n, :n) RETURNING id"),
                               {"n": category})).scalar_one()
        product = (await c.execute(text(
            "INSERT INTO products (brand_id, category_id, model, title, slug, status)"
            " VALUES (:b, :c, :m, :m, :s, 'active') RETURNING id"),
            {"b": brand, "c": cat, "m": model, "s": tag + "-slug"})).scalar_one()
        lot = (await c.execute(text(
            "INSERT INTO lots (lot_number, status, warehouse) VALUES (:n, 'active', :w) RETURNING id"),
            {"n": tag + "-LOT", "w": warehouse})).scalar_one()
        for i, (status, grade) in enumerate(statuses):
            await c.execute(text("""
                INSERT INTO assets (serial_number, status, grade, sale_price_cents, lot_id, product_id)
                VALUES (:ser, :st, :g, :price, :lot, :prod)
            """), {"ser": f"{tag}-S{i}", "st": status, "g": grade, "price": 10000 + i, "lot": lot,
                   "prod": product})
    return {"brand": brand, "category": cat, "product": product, "lot": lot}


async def test_the_list_is_still_a_bare_array_unless_the_flag_is_passed(client):
    """THE ALARM. Four other callers read this endpoint; three would break on an object."""
    tok = await _staff(client)
    r = await client.get("/staff/assets", headers=_h(tok), params={"limit": 2})
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body, list), "the unflagged response must stay a bare array"
    assert len(body) == 2
    # ...and the keys the other callers index are all still there.
    for key in ("id", "serial_number", "status", "grade", "lot_number", "model", "brand"):
        assert key in body[0], key


async def test_the_envelope_reports_a_total_that_agrees_with_its_rows(client):
    tok = await _staff(client)
    tag = "mission-inv-" + uuid.uuid4().hex[:8]
    seeded = await _seed(tag, model="Widget One", category=tag + "-cat",
                         statuses=[("listed", "A"), ("listed", "B"), ("sold", "A")])
    r = await client.get("/staff/assets", headers=_h(tok),
                         params={"with_meta": 1, "lot_number": tag + "-LOT", "limit": 100})
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body, dict) and "items" in body
    assert body["total"] == 3, body["total"]
    assert len(body["items"]) == 3
    assert {i["serial_number"] for i in body["items"]} == {f"{tag}-S{i}" for i in range(3)}
    # The two columns the table added, on a unit that has them.
    row = next(i for i in body["items"] if i["serial_number"] == tag + "-S0")
    assert row["category"] == tag + "-cat"
    assert row["sale_price_cents"] == 10000


async def test_a_facet_does_not_filter_itself(client):
    """Filtered to `listed`, the status facet must still offer `sold` - otherwise there is no way
    back, which is the rule store_catalog states for its own brand facet."""
    tok = await _staff(client)
    tag = "mission-inv-" + uuid.uuid4().hex[:8]
    await _seed(tag, model="Widget Two", category=tag + "-cat",
                statuses=[("listed", "A"), ("sold", "A")])
    r = await client.get("/staff/assets", headers=_h(tok),
                         params={"with_meta": 1, "lot_number": tag + "-LOT", "status": "listed"})
    body = r.json()
    assert body["total"] == 1
    statuses = {f["value"]: f["count"] for f in body["facets"]["statuses"]}
    assert statuses.get("listed") == 1
    assert statuses.get("sold") == 1, "the status facet filtered itself"
    # The OTHER dimensions are still filtered by status, so their counts are the listed subset.
    assert {f["value"] for f in body["facets"]["grades"]} == {"A"}


async def test_the_search_reaches_the_database_and_not_just_the_page(client):
    """The limitation this replaced: the old search filtered the fifty rows already fetched, so a
    serial on the next page read as "not in stock"."""
    tok = await _staff(client)
    tag = "mission-inv-" + uuid.uuid4().hex[:8]
    await _seed(tag, model="Widget Three", category=tag + "-cat",
                statuses=[("listed", "A"), ("listed", "A"), ("listed", "A")])
    # A page of ONE cannot contain the third unit, so a page-local filter could never find it.
    r = await client.get("/staff/assets", headers=_h(tok),
                         params={"with_meta": 1, "q": tag + "-S2", "limit": 1})
    body = r.json()
    assert body["total"] == 1, body["total"]
    assert body["items"][0]["serial_number"] == tag + "-S2"
    # A term that matches nothing is a total of zero rather than an error.
    r = await client.get("/staff/assets", headers=_h(tok),
                         params={"with_meta": 1, "q": tag + "-NOPE"})
    assert r.json()["total"] == 0 and r.json()["items"] == []


async def test_the_other_filters_narrow_by_name_or_slug(client):
    tok = await _staff(client)
    tag = "mission-inv-" + uuid.uuid4().hex[:8]
    await _seed(tag, model="Widget Four", category=tag + "-cat",
                statuses=[("graded", "C")], warehouse="Testville")
    for params in ({"category": tag + "-cat"}, {"brand": tag},
                    {"grade": "c"}, {"warehouse": "Testville"}):
        r = await client.get("/staff/assets", headers=_h(tok),
                             params={"with_meta": 1, "lot_number": tag + "-LOT", **params})
        assert r.status_code == 200, (params, r.text)
        assert r.json()["total"] == 1, (params, r.json()["total"])
    # A grade filter is normalised the way the row stores it, so a lower-case letter still matches.
    r = await client.get("/staff/assets", headers=_h(tok),
                         params={"with_meta": 1, "lot_number": tag + "-LOT", "grade": "Z"})
    assert r.json()["total"] == 0


async def test_a_filter_the_endpoint_would_not_accept_does_not_become_a_500(client):
    tok = await _staff(client)
    r = await client.get("/staff/assets", headers=_h(tok), params={"with_meta": 1, "sort": "; DROP"})
    assert r.status_code == 200, r.text
    assert r.json()["applied"]["sort"] == "newest", "an unknown sort must fall back, not reach the SQL"
