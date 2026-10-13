"""The parent's stock photos and the parent's full child list - the two things 0014 made real.

Four claims are pinned here rather than assumed, because each is a way the feature can be built
wrongly and still look right on the happy path:

* THE BYTES DO NOT MOVE INTO A SECOND STORE. A stock photo goes into `media_objects`, the table 0013
  built for unit photography, and `product_media` holds the ASSIGNMENT. The assertion is a row count
  on `media_objects` - if a future writer ever gives product photos their own byte table, this is
  the test that notices.
* PRIMARY IS COMPUTED, NOT SUPPLIED. The first photo a product gets is its primary one and later
  ones are not, because a card renders exactly one. A door that let the caller set the flag would
  make the card depend on who uploaded last.
* THE DETAIL READ IS NOT THE CATALOG READ. `GET /catalog/{slug}` shows LISTED units on an ACTIVE
  lot; `GET /staff/products/{id}` shows every child whatever it is doing. The same fixture is read
  through both doors in one test, so the difference is the assertion rather than a comment.
* THE TWO KINDS OF ROW COEXIST. A url-backed row (what the 0014 backfill created for the products
  that already had an `image_url`) and a byte-backed one are both in the same set, in one order, and
  only the byte-backed one has bytes to serve - the url-backed one is a 409, not an empty 200.

Rows here cannot be cleaned up (the suite runs against the shared dev DB), so every product, lot and
serial carries a unique pytest tag.
"""

import uuid

from sqlalchemy import text

from app.bootstrap_staff import bootstrap
from app.core.db import get_engine

# A 1x1 PNG. Real bytes with a real signature, so the door's type check is exercised, and small
# enough that the suite does not carry a megabyte of fixture around.
PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000a49444154789c6360000002000154a24f5f0000000049454e44ae426082"
)

# One byte over the door's cap, so the 413 is the door's and not the transport's.
OVERSIZED = PNG + b"\x00" * (5 * 1024 * 1024)


def _h(tok: str) -> dict:
    return {"Authorization": "Bearer " + tok}


async def _staff(client, role: str) -> str:
    email = "pytest-" + uuid.uuid4().hex + "@test.rfo"
    _, pw = await bootstrap(email, role)
    r = await client.post("/staff/auth/login", json={"email": email, "password": pw})
    return r.json()["access_token"]


def _tag() -> str:
    return "pytest-pm-" + uuid.uuid4().hex[:10]


async def _one(sql: str, **params):
    eng = get_engine()
    async with eng.begin() as c:
        return (await c.execute(text(sql), params)).scalar_one()


async def _exec(sql: str, **params) -> None:
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text(sql), params)


async def _product(client, tok, tag: str, model: str) -> int:
    r = await client.post("/staff/products", headers=_h(tok), json={
        "brand_slug": "apple", "category_slug": "phones", "model": model,
        "title": tag + " " + model, "slug": tag + "-" + model.lower().replace(" ", "-")})
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _lot_with_units(client, tok, tag: str, product_id: int, n: int) -> tuple[int, str, list[int]]:
    r = await client.post("/staff/lots", json={"lot_number": tag + "-LOT", "warehouse": "WH-T"},
                          headers=_h(tok))
    assert r.status_code == 201, r.text
    lot = r.json()
    ids = []
    for i in range(n):
        s = await client.post("/staff/assets/scan-in", headers=_h(tok), json={
            "lot_number": lot["lot_number"], "serial_number": f"{tag}-S{i}",
            "product_id": product_id})
        assert s.status_code == 201, s.text
        ids.append(s.json()["id"])
    return lot["id"], lot["lot_number"], ids


def _upload(client, tok, product_id: int, name: str = "stock.png", alt: str | None = None):
    data = {"alt_text": alt} if alt is not None else None
    return client.post(f"/staff/products/{product_id}/media", headers=_h(tok),
                       files={"file": (name, PNG, "image/png")}, data=data)


async def test_upload_writes_one_file_row_and_one_assignment_row(client):
    """One upload = one `media_objects` row + one `product_media` row, and the bytes are servable."""
    tok = await _staff(client, "admin")
    tag = _tag()
    pid = await _product(client, tok, tag, "Pytest Photo One")
    before = await _one("SELECT count(*) FROM media_objects")

    r = await _upload(client, tok, pid, alt="front three-quarter")
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["is_primary"] is True, "the product's first photo is its primary one"
    assert body["position"] == 0 and body["content_type"] == "image/png"

    after = await _one("SELECT count(*) FROM media_objects")
    assert after == before + 1, "the bytes go in ONE file row - no second byte store"

    detail = (await client.get(f"/staff/products/{pid}", headers=_h(tok))).json()
    assert detail["asset_count"] == 0 and detail["assets"] == []
    assert len(detail["media"]) == 1
    m = detail["media"][0]
    assert m["media_row_id"] == body["media_row_id"] and m["media_id"] == body["media_id"]
    assert m["storage_key"] is None, "a byte-backed row carries no address"
    assert m["alt_text"] == "front three-quarter"
    assert m["raw_path"] == f"/staff/products/{pid}/media/{body['media_row_id']}/raw"

    raw = await client.get(m["raw_path"], headers=_h(tok))
    assert raw.status_code == 200
    assert raw.content == PNG, "the served bytes are the uploaded ones"
    assert raw.headers["content-type"] == "image/png"
    assert raw.headers["x-content-type-options"] == "nosniff"


async def test_a_second_photo_appends_and_is_not_primary(client):
    """Primary is computed by the door: only the first photo is the one a card renders."""
    tok = await _staff(client, "admin")
    tag = _tag()
    pid = await _product(client, tok, tag, "Pytest Photo Two")

    first = await _upload(client, tok, pid)
    second = await _upload(client, tok, pid, name="back.png")
    assert first.status_code == 201 and second.status_code == 201, (first.text, second.text)
    assert first.json()["is_primary"] is True
    assert second.json()["is_primary"] is False, "a later photo must not claim the card"
    assert second.json()["position"] == 1

    detail = (await client.get(f"/staff/products/{pid}", headers=_h(tok))).json()
    assert [m["is_primary"] for m in detail["media"]] == [True, False], "primary sorts first"
    assert [m["position"] for m in detail["media"]] == [0, 1]


async def test_the_door_refuses_a_non_raster_and_an_oversized_file(client):
    """The 0001 CHECK is the floor; these are the sentences a person reads instead of a 23514."""
    tok = await _staff(client, "admin")
    tag = _tag()
    pid = await _product(client, tok, tag, "Pytest Photo Guard")

    bad = await client.post(f"/staff/products/{pid}/media", headers=_h(tok),
                            files={"file": ("notes.txt", b"hello", "text/plain")})
    assert bad.status_code == 422, bad.text

    big = await client.post(f"/staff/products/{pid}/media", headers=_h(tok),
                            files={"file": ("big.png", OVERSIZED, "image/png")})
    assert big.status_code == 413, big.text

    detail = (await client.get(f"/staff/products/{pid}", headers=_h(tok))).json()
    assert detail["media"] == [], "a refused upload leaves no row behind"


async def test_the_detail_returns_every_child_where_the_catalog_returns_only_listed_ones(client):
    """The acceptance: ALL the parent's assets, read through both doors over one fixture.

    Three units behind one model - one still on the dock, one tested, one fully listed - and an
    ACTIVE lot, so the only thing separating the two answers is the catalog's own status filter.
    """
    tok = await _staff(client, "admin")
    tag = _tag()
    pid = await _product(client, tok, tag, "Pytest Child Scope")
    slug = await _one("SELECT slug FROM products WHERE id = :i", i=pid)
    _, _, units = await _lot_with_units(client, tok, tag, pid, 3)
    dock, tested, listed = units

    r = await client.post(f"/staff/assets/{tested}/status", json={"status": "tested"}, headers=_h(tok))
    assert r.status_code == 200, r.text
    r = await client.post(f"/staff/assets/{listed}/status", json={"status": "tested"}, headers=_h(tok))
    assert r.status_code == 200, r.text
    r = await client.post(f"/staff/assets/{listed}/grade", json={"grade": "A", "cost_cents": 9000},
                          headers=_h(tok))
    assert r.status_code == 200, r.text
    r = await client.post(f"/staff/assets/{listed}/price", json={"sale_price_cents": 19900},
                          headers=_h(tok))
    assert r.status_code == 200, r.text
    r = await client.post(f"/staff/assets/{listed}/status", json={"status": "listed"}, headers=_h(tok))
    assert r.status_code == 200, r.text
    r = await client.post(f"/staff/lots/{await _one('SELECT lot_id FROM assets WHERE id = :i', i=listed)}"
                          "/activate", headers=_h(tok))
    assert r.status_code == 200, r.text

    # The catalog door only reads ACTIVE products; the fixture is a fresh draft.
    await _exec("UPDATE products SET status = 'active' WHERE id = :i", i=pid)
    catalog = (await client.get(f"/store/catalog/{slug}")).json()
    assert len(catalog["units"]) == 1 and catalog["units"][0]["id"] == listed, \
        "the shopper's door shows the listed unit and nothing else"

    detail = (await client.get(f"/staff/products/{pid}", headers=_h(tok))).json()
    assert detail["asset_count"] == 3, "the parent's door shows every child"
    assert {a["id"] for a in detail["assets"]} == set(units)
    assert detail["status_counts"] == {"received": 1, "tested": 1, "listed": 1}
    by_id = {a["id"]: a for a in detail["assets"]}
    assert by_id[dock]["status"] == "received" and by_id[dock]["grade"] is None
    assert by_id[listed]["sale_price_cents"] == 19900 and by_id[listed]["lot_number"].endswith("-LOT")
    assert by_id[listed]["lot_status"] == "active"
    assert by_id[dock]["serial_number"] == f"{tag}-S0", "staff read a full serial, as the asset page does"


async def test_a_url_backed_row_is_in_the_set_and_serves_no_bytes(client):
    """What the 0014 backfill created for existing stock, and what the CMS keeps in step."""
    tok = await _staff(client, "admin")
    tag = _tag()
    pid = await _product(client, tok, tag, "Pytest Photo Url")
    url = "https://cdn.test.rfo/" + tag + ".png"

    r = await client.patch(f"/staff/cms/products/{pid}", json={"image_url": url}, headers=_h(tok))
    assert r.status_code == 200, r.text
    # Idempotent: the (product_id, storage_key) index makes a second PATCH the same row, not a
    # second photo of the same address.
    r = await client.patch(f"/staff/cms/products/{pid}", json={"image_url": url}, headers=_h(tok))
    assert r.status_code == 200, r.text

    detail = (await client.get(f"/staff/products/{pid}", headers=_h(tok))).json()
    assert len(detail["media"]) == 1, "one address is one photo"
    m = detail["media"][0]
    assert m["storage_key"] == url and m["media_id"] is None
    assert m["is_primary"] is True and m["raw_path"] is None
    assert detail["product"]["image_url"] == url, "the legacy column is unchanged"

    raw = await client.get(f"/staff/products/{pid}/media/{m['media_row_id']}/raw", headers=_h(tok))
    assert raw.status_code == 409, "a url-backed photo lives elsewhere - not an empty 200, not a 404"


async def test_the_write_doors_are_admin_or_manager_only(client):
    """Same pair as the asset-media doors and the page's own read - no role may write what it cannot read."""
    admin = await _staff(client, "admin")
    tag = _tag()
    pid = await _product(client, admin, tag, "Pytest Photo Roles")
    row = (await _upload(client, admin, pid)).json()["media_row_id"]

    for role in ("warehouse", "sales", "technician"):
        tok = await _staff(client, role)
        r = await _upload(client, tok, pid)
        assert r.status_code == 403, f"{role} may not upload: {r.text}"
        d = await client.delete(f"/staff/products/{pid}/media/{row}", headers=_h(tok))
        assert d.status_code == 403, f"{role} may not delete: {d.text}"
        g = await client.get(f"/staff/products/{pid}", headers=_h(tok))
        assert g.status_code == 403, f"{role} may not read the parent: {g.text}"

    # A sales token can still reach its own doors - this is a wall on THIS route, not a lockout.
    # `/staff/ai/whoami` admits every role, so it is the control: it proves the token is good and
    # that the 403 above is the door refusing a role, not a dead session refusing everyone.
    sales = await _staff(client, "sales")
    assert (await client.get("/staff/ai/whoami", headers=_h(sales))).status_code == 200, \
        "a sales token is valid; the 403s above are this door's wall"
    assert (await client.get(f"/staff/products/{pid}")).status_code == 401, "no credential, no read"


async def test_delete_removes_only_this_products_row_and_its_orphaned_bytes(client):
    """The bytes go when nothing names them - and the other product's set is untouched."""
    tok = await _staff(client, "admin")
    tag = _tag()
    mine = await _product(client, tok, tag, "Pytest Photo Delete A")
    theirs = await _product(client, tok, tag, "Pytest Photo Delete B")
    before = await _one("SELECT count(*) FROM media_objects")

    row = (await _upload(client, tok, mine)).json()["media_row_id"]
    assert (await _upload(client, tok, theirs)).status_code == 201
    assert await _one("SELECT count(*) FROM media_objects") == before + 2

    d = await client.delete(f"/staff/products/{mine}/media/{row}", headers=_h(tok))
    assert d.status_code == 200, d.text
    assert (await client.get(f"/staff/products/{mine}", headers=_h(tok))).json()["media"] == []
    other = (await client.get(f"/staff/products/{theirs}", headers=_h(tok))).json()
    assert len(other["media"]) == 1, "the other product's photo is not collateral"
    assert await _one("SELECT count(*) FROM media_objects") == before + 1, \
        "the orphaned file row is gone with its only assignment"

    again = await client.delete(f"/staff/products/{mine}/media/{row}", headers=_h(tok))
    assert again.status_code == 404, "a removed row is not a second delete"

    # A row id from another product's set is a 404, not a delete: the product scopes the lookup.
    theirs_row = other["media"][0]["media_row_id"]
    cross = await client.delete(f"/staff/products/{mine}/media/{theirs_row}", headers=_h(tok))
    assert cross.status_code == 404, cross.text
    assert len((await client.get(f"/staff/products/{theirs}", headers=_h(tok))).json()["media"]) == 1
