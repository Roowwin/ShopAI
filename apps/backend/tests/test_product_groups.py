"""Product groups: one image and one hand-set price per brand+model+grade, and the publish door.

The four things pinned here are the four things that are easy to get subtly wrong:

* PUBLISH REFUSES A GROUP WITH NO PRICE. Not "publishes at the unit's own price", not "publishes at
  zero" - refuses, because an unpriced group is one nobody has made a decision about, and the whole
  point of the table is that the decision is made once and on purpose.
* PUBLISH WALKS THE LADDER, ONE RUNG PER STATEMENT. `rfo_assets_check_status` refuses
  `received -> graded`, so a publish that set `listed` in one statement would be rejected by the
  database. The test asserts the unit really ends at `listed`, which is the only proof that the three
  rungs were taken in the order the trigger admits.
* PUBLISH ACTIVATES THE LOT. An imported lot is `intake`; the shop requires `active`. A publish that
  forgot this would report success and show nothing, so the lot's own status is asserted.
* A SECOND IMPORT SKIPS WHAT IT ALREADY HAS. The importer used to refuse the whole file if any serial
  was already on the shelf, which made re-importing a supplier catalogue impossible. The test commits
  the same sheet twice and expects the second to succeed with the rows counted as skipped.

IDENTITIES ARE NAMED `mission-pgroup-%`, NOT `pytest-%`. Sibling files sweep
`DELETE FROM staff_users WHERE email LIKE 'pytest-%'` in their own teardown (test_auth,
test_agent_identity); a suite that borrowed that prefix would be logged out mid-test by a gate
running beside it, and the failure would read as a 401 from the door rather than as a test collision.
This file sweeps its own prefix, so nothing accumulates either way.
"""

import uuid

import pytest_asyncio
from sqlalchemy import text

from app.bootstrap_staff import bootstrap
from app.core.db import get_engine

# A 1x1 PNG: real bytes with a real signature, small enough not to carry a fixture megabyte around.
PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000a49444154789c6360000002000154a24f5f0000000049454e44ae426082"
)

IDENTITY_PREFIX = "mission-pgroup-"


def _h(tok: str) -> dict:
    return {"Authorization": "Bearer " + tok}


async def _staff(client, role: str = "admin") -> str:
    email = IDENTITY_PREFIX + uuid.uuid4().hex + "@test.rfo"
    _, pw = await bootstrap(email, role)
    r = await client.post("/staff/auth/login", json={"email": email, "password": pw})
    return r.json()["access_token"]


@pytest_asyncio.fixture(autouse=True)
async def _sweep(client):
    """Remove everything this file created - data AND identities - before and after every test.

    ONLY this file's rows, keyed on its own `mission-pgroup-` tag. Never another file's, and never
    the real catalogue.

    WHY THIS FILE NEEDS A REAL PURGE WHEN THE OTHERS SETTLE FOR LESS. Suites like
    `test_product_import` purge only products/lots/brands that NOTHING references, because a
    committed import writes stock movements and the append-only ledger then pins its assets. This
    file's fixtures write no movements at all - they insert units directly, the way the importer
    does, and publishing writes audit rows and no ledger entries - so everything here is genuinely
    removable, and all of it is: groups, units, products, lots, categories, brands and the uploaded
    bytes.

    The first cut swept only the identities, which left 117 units behind on the shared dev database
    and - worse - 22 groups sitting PUBLISHED with their lots activated, putting four test products
    on the shop floor and into the counts that other suites assert on. A suite whose fixtures end up
    on a storefront is not a suite that cleans up.

    It takes `client` as an argument on purpose, and only for the ordering: the conftest fixture
    DISPOSES the engine on teardown, so a cleanup that ran after it would open a session on a dead
    pool and error the NEXT test at setup rather than the one that actually leaked. Depending on
    `client` keeps this teardown inside the loop's lifetime - the same reason
    `test_agent_identity._clean_agents` names it.
    """
    async def sweep():
        eng = get_engine()
        # Every predicate is `brand name LIKE 'mission-pgroup-%'` or a lot/category slug carrying the
        # same tag, so a run can only ever remove its own rows. The NOT EXISTS guards on the two
        # deletes that could be pinned by another table are belt-and-braces: nothing in this file
        # writes a stock movement or an order line, but a leftover row from a crashed run must not
        # take the sweep down with a foreign-key error.
        async with eng.begin() as c:
            await c.execute(text(
                "DELETE FROM product_groups WHERE brand_id IN "
                "(SELECT id FROM brands WHERE name LIKE :p)"), {"p": "mission-pgroup-%"})
            # FIRST, TAKE ANYTHING OF MINE OFF THE SHOP FLOOR, whatever happens below. Two of the
            # tests go through the real importer, which writes one `stock_movements` row per unit,
            # and `rfo_app` holds only SELECT and INSERT on that table - so those units are pinned
            # by the append-only ledger and CANNOT be deleted, exactly as `test_product_import`
            # records. What must never happen is such a unit staying visible: unlisting is the one
            # lever that hides a unit while leaving its neighbours alone, and archiving the product
            # takes its page out of the catalogue as well. `listed -> graded` is a legal transition
            # (0023), and the lot trigger then re-computes the lot from its remaining listed units.
            await c.execute(text(
                "UPDATE assets SET status = 'graded' WHERE status = 'listed' AND product_id IN "
                "(SELECT id FROM products WHERE brand_id IN "
                " (SELECT id FROM brands WHERE name LIKE :p))"), {"p": "mission-pgroup-%"})
            await c.execute(text(
                "UPDATE products SET status = 'archived' WHERE brand_id IN "
                "(SELECT id FROM brands WHERE name LIKE :p)"), {"p": "mission-pgroup-%"})

            # THEN REMOVE WHAT IS GENUINELY REMOVABLE. The NOT EXISTS guards are the house rule
            # (`test_product_import._purge` states it the same way): a row the ledger pins stays,
            # and the sweep keeps going rather than failing every remaining test with a 23503.
            await c.execute(text(
                "DELETE FROM assets WHERE NOT EXISTS "
                "(SELECT 1 FROM stock_movements sm WHERE sm.asset_id = assets.id) AND product_id IN "
                "(SELECT id FROM products WHERE brand_id IN "
                " (SELECT id FROM brands WHERE name LIKE :p))"), {"p": "mission-pgroup-%"})
            await c.execute(text(
                "DELETE FROM products WHERE brand_id IN "
                "(SELECT id FROM brands WHERE name LIKE :p) AND NOT EXISTS "
                "(SELECT 1 FROM assets a WHERE a.product_id = products.id)"), {"p": "mission-pgroup-%"})
            await c.execute(text(
                "DELETE FROM lots WHERE lot_number LIKE :p AND NOT EXISTS "
                "(SELECT 1 FROM assets a WHERE a.lot_id = lots.id)"), {"p": "mission-pgroup-%"})
            await c.execute(text("DELETE FROM categories WHERE slug LIKE :p"),
                            {"p": "mission-pgroup-%"})
            await c.execute(text(
                "DELETE FROM media_objects WHERE uploaded_by IN "
                "(SELECT id FROM staff_users WHERE email LIKE :i) "
                "AND NOT EXISTS (SELECT 1 FROM product_groups g WHERE g.media_id = media_objects.id)"),
                {"i": IDENTITY_PREFIX + "%"})
            await c.execute(text(
                "DELETE FROM refresh_tokens WHERE identity_id IN "
                "(SELECT id FROM staff_users WHERE email LIKE :i)"), {"i": IDENTITY_PREFIX + "%"})
            await c.execute(text("DELETE FROM staff_users WHERE email LIKE :i"),
                            {"i": IDENTITY_PREFIX + "%"})
            # The brands go LAST: every delete above reaches its rows through them, and a brand the
            # ledger pinned stays behind with products that are archived and units that are unlisted.
            await c.execute(text(
                "DELETE FROM brands WHERE name LIKE :p AND NOT EXISTS "
                "(SELECT 1 FROM products p WHERE p.brand_id = brands.id)"), {"p": "mission-pgroup-%"})
    await sweep()
    yield
    await sweep()


def _tag() -> str:
    return "mission-pgroup-" + uuid.uuid4().hex[:8]


async def _seed(tag: str, *, model: str = "Widget One", grade: str = "B", n: int = 2,
                price: int | None = None, sale: int = 20000, basis: int = 5000,
                fmv: int = 9000, status: str = "received", lot_status: str = "intake",
                category: str | None = None) -> dict:
    """A brand, a category, a product, a lot and N units - written the way the IMPORTER writes them.

    Straight SQL rather than the scan-in door, and deliberately: the importer inserts `status` and
    `grade` as the sheet gives them, which is how 1917 units came to sit at `received` WITH a grade.
    A fixture that walked the doors instead could only produce units the doors can produce, and the
    whole publish path exists for units that arrived already graded.
    """
    eng = get_engine()
    async with eng.begin() as c:
        brand_id = (await c.execute(text(
            "INSERT INTO brands (name, slug) VALUES (:n, :s) RETURNING id"),
            {"n": tag, "s": tag})).scalar_one()
        cat_name = category or (tag + " kit")
        category_id = (await c.execute(text(
            "INSERT INTO categories (name, slug) VALUES (:n, :s) RETURNING id"),
            {"n": cat_name, "s": cat_name})).scalar_one()
        product_id = (await c.execute(text(
            "INSERT INTO products (brand_id, category_id, model, title, slug, status)"
            " VALUES (:b, :c, :m, :m, :s, 'active') RETURNING id"),
            {"b": brand_id, "c": category_id, "m": model, "s": tag + "-" + model.lower().replace(" ", "-")})).scalar_one()
        lot_id = (await c.execute(text(
            "INSERT INTO lots (lot_number, status) VALUES (:n, :s) RETURNING id"),
            {"n": tag + "-LOT-1", "s": lot_status})).scalar_one()
        asset_ids = []
        for i in range(n):
            asset_ids.append((await c.execute(text("""
                INSERT INTO assets (serial_number, status, grade, sale_price_cents, settlement_cents,
                                    fmv_cents, cost_cents, lot_id, product_id)
                VALUES (:ser, :st, :g, :sale, :basis, :fmv, NULL, :lot, :prod) RETURNING id
            """), {"ser": f"{tag}-S{i}", "st": status, "g": grade, "sale": sale, "basis": basis,
                   "fmv": fmv, "lot": lot_id, "prod": product_id})).scalar_one())
        # The group the importer would have declared. `price_override` is NULL unless the test says
        # otherwise, because that is the state a freshly imported model+grade is in.
        #
        # The source is decided in PYTHON, not by a `CASE WHEN :p IS NULL` in the SQL: asyncpg infers
        # a parameter's type from the Describe, and a parameter appearing only inside an IS NULL test
        # has nothing to infer FROM - it raises AmbiguousParameterError at execution. This is the same
        # trap `staff_groups.patch_product_group` casts around; a fixture is not exempt from it.
        group_id = (await c.execute(text("""
            INSERT INTO product_groups (brand_id, model, grade, price_override, price_source)
            VALUES (:b, :m, :g, :p, :s) RETURNING id
        """), {"b": brand_id, "m": model, "g": grade, "p": price,
               "s": None if price is None else "custom"})).scalar_one()
    return {"brand_id": brand_id, "category_id": category_id, "product_id": product_id,
            "lot_id": lot_id, "asset_ids": asset_ids, "group_id": group_id}


async def _one(sql: str, **params):
    eng = get_engine()
    async with eng.begin() as c:
        return (await c.execute(text(sql), params)).scalar_one()


async def _all(sql: str, **params):
    eng = get_engine()
    async with eng.begin() as c:
        return (await c.execute(text(sql), params)).mappings().all()


async def test_publish_refuses_a_group_with_no_price(client):
    """The whole contract of the table: no decision, no listing."""
    tok = await _staff(client)
    seeded = await _seed(_tag())
    r = await client.post(f"/staff/product-groups/{seeded['group_id']}/publish", headers=_h(tok))
    assert r.status_code == 409, r.text
    assert "set a price" in r.json()["detail"]
    # And nothing moved: a refused publish must not have walked anything part of the way.
    statuses = await _all("SELECT status FROM assets WHERE id = ANY(:i)", i=seeded["asset_ids"])
    assert {s["status"] for s in statuses} == {"received"}


async def test_publish_walks_the_ladder_activates_the_lot_and_audits_every_unit(client):
    """Three rungs in one transaction, the lot opened, and a trail row per unit."""
    tok = await _staff(client)
    seeded = await _seed(_tag(), n=2)
    r = await client.patch(f"/staff/product-groups/{seeded['group_id']}", headers=_h(tok),
                           json={"price_override": 12345, "price_source": "fmv"})
    assert r.status_code == 200, r.text
    r = await client.post(f"/staff/product-groups/{seeded['group_id']}/publish", headers=_h(tok))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["listed"] == 2
    assert body["skipped_already_listed"] == 0
    assert body["lots_activated"] == 1
    assert body["storefront_id"] is not None

    # The units really reached `listed` - which is only possible if received->tested->graded->listed
    # were each their own statement, because the trigger refuses the two-rung jump.
    rows = await _all("SELECT status, sale_price_cents FROM assets WHERE id = ANY(:i)",
                      i=seeded["asset_ids"])
    assert {r["status"] for r in rows} == {"listed"}
    assert {r["sale_price_cents"] for r in rows} == {12345}

    # The lot the shop needs to be `active` for any of it to be visible.
    assert await _one("SELECT status FROM lots WHERE id = :i", i=seeded["lot_id"]) == "active"

    # One audit row per unit, with the status it actually came from - not a jump it never made.
    actions = await _all(
        "SELECT action, before, after FROM audit_log WHERE entity = 'asset' AND entity_id = ANY(:i)"
        " AND action = 'publish' ORDER BY entity_id", i=seeded["asset_ids"])
    assert len(actions) == 2
    assert {a["before"]["status"] for a in actions} == {"received"}
    assert {a["after"]["status"] for a in actions} == {"listed"}


async def test_publish_counts_the_units_the_shop_will_hide(client):
    """A price below the unit's cost basis is LISTED and HIDDEN - the door says so rather than lying."""
    tok = await _staff(client)
    # Basis is settlement (cost is NULL, exactly as the importer leaves it); 500 < 5000.
    seeded = await _seed(_tag(), n=3, basis=5000)
    await client.patch(f"/staff/product-groups/{seeded['group_id']}", headers=_h(tok),
                       json={"price_override": 500})
    r = await client.post(f"/staff/product-groups/{seeded['group_id']}/publish", headers=_h(tok))
    assert r.status_code == 200, r.text
    assert r.json()["listed"] == 3
    assert r.json()["hidden_below_cost"] == 3
    # Listed, not refused: hiding is the shop's job (ON_SALE), and saying "3 listed" without saying
    # "3 hidden" is the lie this count exists to prevent.
    assert await _one("SELECT count(*) FROM assets WHERE id = ANY(:i) AND status = 'listed'",
                      i=seeded["asset_ids"]) == 3


async def test_patch_sets_and_clears_the_price_with_its_source(client):
    """A source that outlives the number it described would be a claim about nothing."""
    tok = await _staff(client)
    seeded = await _seed(_tag())
    gid = seeded["group_id"]
    r = await client.patch(f"/staff/product-groups/{gid}", headers=_h(tok),
                           json={"price_override": 4242, "price_source": "resale"})
    assert r.status_code == 200, r.text
    assert r.json()["price_source"] == "resale"
    # A price with no source is 'custom' - never mistaken for an imported one.
    r = await client.patch(f"/staff/product-groups/{gid}", headers=_h(tok),
                           json={"price_override": 4343})
    assert r.json()["price_source"] == "custom"
    # An omitted field is left alone; an explicit null clears the pair.
    r = await client.patch(f"/staff/product-groups/{gid}", headers=_h(tok), json={"price_override": None})
    assert r.status_code == 200, r.text
    row = await _one("SELECT (price_override IS NULL AND price_source IS NULL)::text FROM product_groups"
                     " WHERE id = :i", i=gid)
    assert row == "true"


async def test_a_group_image_is_addressed_on_the_shop_origin_and_served_without_a_token(client):
    """The address the storefront can actually fetch: same origin as the page, and public."""
    tok = await _staff(client)
    seeded = await _seed(_tag())
    rsp = await client.post(f"/staff/product-groups/{seeded['group_id']}/image", headers=_h(tok),
                            files={"file": ("shot.png", PNG, "image/png")})
    assert rsp.status_code == 201, rsp.text
    address = rsp.json()["image_url"]
    # Shop-relative, NOT an API URL: the storefront's CSP is `img-src 'self'` and an absolute
    # https://api... address would be a second origin the browser refuses.
    assert address.startswith("/media/"), address
    public_id = address.rsplit("/", 1)[1]

    # Fetched with NO credential at all - which is how a plain <img> fetches it.
    served = await client.get("/store/media/" + public_id)
    assert served.status_code == 200, served.text
    assert served.headers["content-type"].startswith("image/png")
    assert served.content == PNG

    # And an id that no group points at is not served, so the media table is not enumerable.
    assert (await client.get("/store/media/" + str(uuid.uuid4()))).status_code == 404
    assert (await client.get("/store/media/not-a-uuid")).status_code == 404


def _csv(rows: list[list[str]], header: list[str] | None = None) -> bytes:
    import csv
    import io
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(header or ["Status", "Lot", "Class", "Mfg", "Model", "Grade", "Serial#", "Resale"])
    for row in rows:
        w.writerow(row)
    return buf.getvalue().encode("utf-8")


async def _commit(client, tok, data):
    return await client.post("/staff/imports/products/commit",
                             files={"file": ("sheet.csv", data, "text/csv")}, headers=_h(tok))


async def test_a_second_sheet_skips_the_serials_it_already_has_instead_of_refusing_the_file(client):
    """The reason this feature exists: a supplier runs the same catalogue twice.

    Before this, re-sending a sheet whose serials were already on the shelf was a 422 for the WHOLE
    file - so the handful of genuinely new units in it could never be brought in at all.
    """
    tok = await _staff(client)
    tag = _tag()
    rows = [[ "received", tag + "-LOT-1", "Phones", tag, "Widget One", "B",
              tag + "-S0", "279.00"],
            [ "received", tag + "-LOT-1", "Phones", tag, "Widget One", "B",
              tag + "-S1", "279.00"]]

    first = await _commit(client, tok, _csv(rows))
    assert first.status_code == 200, first.text
    assert first.json()["summary"]["assets_created"] == 2
    assert first.json()["summary"]["skipped_existing"] == 0
    # The sheet declared a group per (brand, model, grade); they are new and unpriced.
    assert first.json()["summary"]["groups_new"] == 1
    assert first.json()["summary"]["groups_ready"] == 0

    second = await _commit(client, tok, _csv(rows))
    assert second.status_code == 200, second.text
    body = second.json()
    assert body["summary"]["assets_created"] == 0
    assert body["summary"]["skipped_existing"] == 2
    assert len(body["skipped"]) == 2
    assert {s["serial"] for s in body["skipped"]} == {tag + "-S0", tag + "-S1"}
    # The group is not re-declared as new - it already exists, and the importer must not reset it.
    assert body["summary"]["groups_new"] == 0
    # Nor does it claim the group is IN THE STORE: it was declared by the first sheet and never
    # published, so it still needs an image and a price. `storefront_id` is the only thing that says
    # otherwise, and nothing has minted one.
    assert body["summary"]["groups_ready"] == 0

    # A third sheet that adds ONE new unit to the same model+grade writes exactly that one.
    third = await _commit(client, tok, _csv(rows + [
        ["received", tag + "-LOT-2", "Phones", tag, "Widget One", "B", tag + "-S2", "279.00"]]))
    assert third.status_code == 200, third.text
    assert third.json()["summary"]["assets_created"] == 1
    assert third.json()["summary"]["skipped_existing"] == 2


async def test_a_group_is_found_by_brand_model_and_grade_even_when_the_category_is_respelled(client):
    """Why the group is keyed (brand, model, grade) and NOT product_id.

    `_resolve_product` keys a product on (brand, category, model). A sheet that spells the Class
    differently mints a SECOND product row for one model - and a group hung off the product would
    fork with it, asking the operator again for a photograph and a price they had already given.
    """
    tok = await _staff(client)
    tag = _tag()
    row = ["received", tag + "-LOT-1", "Phones", tag, "Widget One", "B", tag + "-S0", "279.00"]
    assert (await _commit(client, tok, _csv([row]))).status_code == 200

    gid = await _one("SELECT id FROM product_groups WHERE model = 'Widget One' AND grade = 'B'"
                     " AND brand_id = (SELECT id FROM brands WHERE name = :n)", n=tag)
    # Give it a price, then stamp the marker the publish door mints - done directly rather than by
    # calling publish, because this test is about the IMPORTER finding an existing group and publish
    # has tests of its own. Going through publish here would list this fixture's units and activate
    # its lot, and a unit that has been through the importer carries a stock movement, so the
    # append-only ledger would pin it: the test would leave test stock on the shop floor for good.
    assert (await client.patch(f"/staff/product-groups/{gid}", headers=_h(tok),
                               json={"price_override": 3210})).status_code == 200
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("UPDATE product_groups SET storefront_id = gen_random_uuid(),"
                             " published_at = now() WHERE id = :i"), {"i": gid})

    # Same brand, same model, same grade - a different Class, so a different product row.
    other = ["received", tag + "-LOT-2", "Tablets", tag, "Widget One", "B", tag + "-S1", "279.00"]
    r = await _commit(client, tok, _csv([other]))
    assert r.status_code == 200, r.text
    body = r.json()
    products = await _one("SELECT count(*) FROM products WHERE brand_id ="
                          " (SELECT id FROM brands WHERE name = :n)", n=tag)
    assert products == 2, "the fixture did not actually mint a second product row"
    # ...and yet the group was found, not forked, and its price survived untouched.
    assert body["summary"]["groups_new"] == 0
    assert body["summary"]["groups_ready"] == 1
    assert await _one("SELECT price_override FROM product_groups WHERE id = :i", i=gid) == 3210


async def test_bulk_publish_names_the_groups_it_held_back(client):
    """The 'Publish remaining lots' button: publish what is set up, name what is not."""
    tok = await _staff(client)
    ready = await _seed(_tag(), n=2)
    unpriced = await _seed(_tag(), n=1)
    await client.patch(f"/staff/product-groups/{ready['group_id']}", headers=_h(tok),
                       json={"price_override": 7777})
    r = await client.post("/staff/product-groups/publish", headers=_h(tok),
                          json={"ids": [ready["group_id"], unpriced["group_id"]]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["totals"]["groups_published"] == 1
    assert body["totals"]["units_listed"] == 2
    assert body["totals"]["groups_skipped"] == 1
    assert [s["id"] for s in body["skipped"]] == [unpriced["group_id"]]
    assert body["skipped"][0]["reason"] == "no price set"
    # The priced group published; the other was left exactly as it was.
    assert await _one("SELECT count(*) FROM assets WHERE id = ANY(:i) AND status = 'listed'",
                      i=ready["asset_ids"]) == 2
    assert await _one("SELECT count(*) FROM assets WHERE id = ANY(:i) AND status = 'received'",
                      i=unpriced["asset_ids"]) == 1


# ---------------------------------------------------------------------------
# The photo pool: a folder uploaded in one go, and the suggestion each group offers.
#
# The pure cases run without a database on purpose. The rule they pin - a grade is a TOKEN, not a
# letter - is the one a substring implementation gets wrong, and it is worth being able to point at
# a red test rather than at a paragraph of prose when somebody proposes "just use `in`".
# ---------------------------------------------------------------------------


def test_the_grade_marker_is_a_whole_token_and_not_a_letter():
    """The trap the whole rule exists for: `a` lives inside latitude, apple and carbon."""
    from app.services.group_image_match import grade_marker
    assert grade_marker("latitude-5420_A.jpg") == "A"
    assert grade_marker("latitude_5420_a.png") == "A"
    assert grade_marker("Latitude 5420 Grade B.webp") == "B"
    # ...and none of these claims anything, though every one of them contains the letter.
    assert grade_marker("latitude.jpg") is None
    assert grade_marker("apple-iphone-13.jpg") is None
    assert grade_marker("carbon-x1-carbon.jpg") is None
    assert grade_marker("") is None


def test_a_file_naming_a_different_grade_is_excluded_rather_than_ranked_lower():
    """Excluded, not down-ranked: the Grade B photograph must never reach a Grade A group."""
    from app.services.group_image_match import candidates
    pool = [{"media_id": 1, "filename": "latitude-5420_A.jpg", "uploaded_at": None},
            {"media_id": 2, "filename": "latitude-5420_B.jpg", "uploaded_at": None}]
    assert [c["media_id"] for c in candidates("Dell", "Latitude 5420", "A", pool)] == [1]
    assert [c["media_id"] for c in candidates("Dell", "Latitude 5420", "B", pool)] == [2]


def test_a_file_missing_a_word_of_the_model_matches_nothing():
    """Not a weaker match - a different device."""
    from app.services.group_image_match import candidates
    assert candidates("Dell", "Latitude 5420", "A",
                      [{"media_id": 1, "filename": "latitude.jpg", "uploaded_at": None}]) == []
    # And the other direction: a longer model is not satisfied by the shorter name.
    assert candidates("Dell", "Latitude 5420 Carbon", "A",
                      [{"media_id": 1, "filename": "latitude-5420_A.jpg", "uploaded_at": None}]) == []


def test_the_brand_is_not_required_because_filenames_do_not_carry_it():
    """The first cut required it, and matched nothing at all."""
    from app.services.group_image_match import candidates
    pool = [{"media_id": 1, "filename": "latitude-5420_A.jpg", "uploaded_at": None}]
    assert [c["media_id"] for c in candidates("Dell", "Latitude 5420", "A", pool)] == [1]


def test_a_file_that_names_the_grade_outranks_one_that_says_nothing():
    from app.services.group_image_match import candidates
    pool = [{"media_id": 1, "filename": "latitude-5420.jpg", "uploaded_at": None},
            {"media_id": 2, "filename": "latitude-5420_A.jpg", "uploaded_at": None}]
    got = candidates("Dell", "Latitude 5420", "A", pool)
    assert [c["media_id"] for c in got] == [2, 1]
    assert got[0]["grade_marker"] == "A" and got[1]["grade_marker"] is None


async def _pool_upload(client, tok, names):
    """Post one batch of images into the pool. `names` are the filenames to invent."""
    return await client.post("/staff/product-groups/images", headers=_h(tok),
                             files=[("files", (n, PNG, "image/png")) for n in names])


async def test_a_folder_upload_stores_every_image_and_names_the_ones_it_refused(client):
    """One bad file must not fail the batch - a real folder always contains one."""
    tok = await _staff(client)
    tag = _tag()
    r = await client.post("/staff/product-groups/images", headers=_h(tok), files=[
        ("files", (tag + "-one.png", PNG, "image/png")),
        ("files", (tag + "-two.png", PNG, "image/png")),
        ("files", (tag + "-notes.pdf", b"%PDF-1.4 not an image", "application/pdf")),
    ])
    assert r.status_code == 201, r.text
    j = r.json()
    assert len(j["uploaded"]) == 2, j
    assert len(j["refused"]) == 1, j
    assert j["refused"][0]["filename"] == tag + "-notes.pdf"
    assert "JPEG" in j["refused"][0]["reason"]
    assert j["pool_size"] >= 2
    # Both good files are in the pool, and nothing points at them yet - that is what a pool is.
    pool = await client.get("/staff/product-groups/image-pool?limit=400", headers=_h(tok))
    ids = [i["media_id"] for i in pool.json()["items"]]
    assert {u["media_id"] for u in j["uploaded"]} <= set(ids)


async def test_the_pool_stops_offering_an_image_a_group_already_points_at(client):
    tok = await _staff(client)
    seeded = await _seed(_tag())
    rsp = await client.post(f"/staff/product-groups/{seeded['group_id']}/image", headers=_h(tok),
                            files={"file": ("shot.png", PNG, "image/png")})
    assert rsp.status_code == 201, rsp.text
    mid = rsp.json()["media_id"]
    pool = await client.get("/staff/product-groups/image-pool?limit=400", headers=_h(tok))
    assert mid not in [i["media_id"] for i in pool.json()["items"]]


async def test_attaching_points_a_group_at_a_pooled_image_without_moving_bytes(client):
    """The pool's half of the upload door: three hundred files cross once, attaching is an UPDATE."""
    tok = await _staff(client)
    tag = _tag()
    seeded = await _seed(tag, model="Latitude 5420")
    up = await _pool_upload(client, tok, [tag + "-latitude-5420-A.png"])
    mid = up.json()["uploaded"][0]["media_id"]
    r = await client.post(f"/staff/product-groups/{seeded['group_id']}/image/attach",
                          headers=_h(tok), json={"media_id": mid})
    assert r.status_code == 200, r.text
    assert r.json()["media_id"] == mid
    assert r.json()["image_url"].startswith("/media/")
    assert await _one("SELECT media_id FROM product_groups WHERE id = :i",
                      i=seeded["group_id"]) == mid


async def test_a_group_offers_the_photo_named_for_its_own_grade(client):
    """End to end: upload a folder, ask a group, and the B file must not be in the answer."""
    tok = await _staff(client)
    tag = _tag()
    seeded = await _seed(tag, model="Latitude 5420", grade="A")
    up = await _pool_upload(client, tok, [tag + "-latitude-5420-A.png",
                                          tag + "-latitude-5420-B.png"])
    assert up.status_code == 201 and len(up.json()["uploaded"]) == 2, up.text
    r = await client.get(f"/staff/product-groups/{seeded['group_id']}/image-suggestions",
                         headers=_h(tok))
    assert r.status_code == 200, r.text
    names = [s["filename"] for s in r.json()["suggestions"]]
    assert any("5420-A" in n for n in names), names
    assert not any("5420-B" in n for n in names), names
    assert r.json()["suggestions"][0]["raw_path"].endswith("/raw")


async def test_discard_refuses_an_image_a_group_points_at_and_frees_the_rest(client):
    tok = await _staff(client)
    tag = _tag()
    seeded = await _seed(tag)
    up = await _pool_upload(client, tok, [tag + "-keep.png", tag + "-free.png"])
    ids = [u["media_id"] for u in up.json()["uploaded"]]
    await client.post(f"/staff/product-groups/{seeded['group_id']}/image/attach",
                      headers=_h(tok), json={"media_id": ids[0]})
    held = await client.delete(f"/staff/product-groups/image-pool/{ids[0]}", headers=_h(tok))
    assert held.status_code == 409, held.text
    assert "in use" in held.json()["detail"]
    free = await client.delete(f"/staff/product-groups/image-pool/{ids[1]}", headers=_h(tok))
    assert free.status_code == 200, free.text


async def test_discard_refuses_an_image_only_a_return_photograph_points_at(client):
    """`rma_photos.media_id` has NO foreign key - the reference a constraint-built check misses.

    This is the one that would have shipped a defect: the pool would have offered a customer's
    photograph of a broken laptop as a product photo, and `discard` would then have deleted it.
    """
    tok = await _staff(client)
    tag = _tag()
    up = await _pool_upload(client, tok, [tag + "-rma.png"])
    mid = up.json()["uploaded"][0]["media_id"]
    eng = get_engine()
    try:
        async with eng.begin() as c:
            rma = (await c.execute(text("""
                INSERT INTO rma_requests (number, order_id, email, reason)
                VALUES (:n, 0, :e, 'defective') RETURNING id
            """), {"n": tag + "-RMA", "e": tag + "@test.rfo"})).scalar_one()
            await c.execute(text("INSERT INTO rma_photos (rma_id, media_id) VALUES (:r, :m)"),
                            {"r": rma, "m": mid})
        # Not offered as a product photo...
        pool = await client.get("/staff/product-groups/image-pool?limit=400", headers=_h(tok))
        assert mid not in [i["media_id"] for i in pool.json()["items"]]
        # ...and not deletable through a door that only knows about products.
        r = await client.delete(f"/staff/product-groups/image-pool/{mid}", headers=_h(tok))
        assert r.status_code == 409, r.text
    finally:
        # The RMA is this test's own row and nothing in the sweep knows about it; left behind it
        # would pin the media row for good.
        async with eng.begin() as c:
            await c.execute(text("DELETE FROM rma_photos WHERE media_id = :m"), {"m": mid})
            await c.execute(text("DELETE FROM rma_requests WHERE number LIKE :p"), {"p": tag + "%"})


async def test_the_category_filter_narrows_the_list_and_carries_its_own_options(client):
    """The category lives on the PRODUCT, so this is an EXISTS and not a join.

    A join would multiply the row's unit counts whenever one group spans two product rows, which is
    the normal state after a Category has been respelled on a later sheet.
    """
    tok = await _staff(client)
    tag = _tag()
    one = await _seed(tag + "a", model="Widget One", grade="B", category=tag + "-cat-one")
    two = await _seed(tag + "b", model="Widget Two", grade="B", category=tag + "-cat-two")

    r = await client.get(f"/staff/product-groups?limit=200&q={tag}", headers=_h(tok))
    assert r.status_code == 200, r.text
    assert {g["id"] for g in r.json()} >= {one["group_id"], two["group_id"]}
    row = next(g for g in r.json() if g["id"] == one["group_id"])
    assert row["categories"] == [tag + "-cat-one"], row

    r = await client.get(f"/staff/product-groups?limit=200&q={tag}&category={tag}-cat-one",
                         headers=_h(tok))
    assert {g["id"] for g in r.json()} == {one["group_id"]}, r.json()

    # The filter's options are the categories that actually HOLD a group, with their counts.
    r = await client.get("/staff/product-groups/categories", headers=_h(tok))
    assert r.status_code == 200, r.text
    opts = {c["slug"]: c["groups"] for c in r.json()["categories"]}
    assert opts.get(tag + "-cat-one") == 1, opts.get(tag + "-cat-one")
    assert opts.get(tag + "-cat-two") == 1, opts.get(tag + "-cat-two")
