"""The Asset Studio's image hub: upload, apply-to-model, and a lot's grade templates.

Three things here are easy to get wrong and are therefore pinned rather than assumed:

* BULK-APPLY IS SCOPED TO A LOT **AND** A MODEL. A box of twenty units is the unit of photographic
  work, but the shot of one iPhone is not the shot of the Galaxy beside it, and neither one belongs
  to a unit in the NEXT lot. The match is brand+model (through the products table, not by product
  id equality), which is what the brief asks for, so a fixture builds a second product row with the
  same brand and model and expects it to be matched.
* A GRADE TEMPLATE IS ONE PER GRADE PER LOT. Assigning a second image to grade A replaces the
  first; it does not add a second opinion. And a template may only point at an image that is on a
  unit of THAT lot.
* THE BYTES DO NOT MOVE. Applying one photo across four units writes four assignment rows against
  one file - the reason `media_objects` and `asset_images` are separate tables. The row count on
  `media_objects` is the assertion that the split survived.

Rows here cannot be cleaned up either (the suite runs against the shared dev DB), so every lot and
serial carries a unique pytest tag.
"""

import uuid

from sqlalchemy import text

from app.bootstrap_staff import bootstrap
from app.core.db import get_engine

# A 1x1 PNG. Real bytes with a real signature, so the sniffing the door does is exercised - and
# small enough that the suite does not carry a megabyte of fixture around.
PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000a49444154789c6360000002000154a24f5f0000000049454e44ae426082"
)


def _h(tok: str) -> dict:
    return {"Authorization": "Bearer " + tok}


async def _staff(client, role: str) -> str:
    email = "pytest-" + uuid.uuid4().hex + "@test.rfo"
    _, pw = await bootstrap(email, role)
    r = await client.post("/staff/auth/login", json={"email": email, "password": pw})
    return r.json()["access_token"]


def _tag() -> str:
    return "pytest-ai-" + uuid.uuid4().hex[:10]


async def _one(sql: str, **params):
    eng = get_engine()
    async with eng.begin() as c:
        return (await c.execute(text(sql), params)).scalar_one()


async def _audit_actions(entity: str, entity_id: int) -> list[str]:
    eng = get_engine()
    async with eng.begin() as c:
        rows = (await c.execute(text(
            "SELECT action FROM audit_log WHERE entity = :e AND entity_id = :i ORDER BY id"),
            {"e": entity, "i": entity_id})).scalars().all()
    return list(rows)


async def _product(client, tok, tag: str, model: str) -> int:
    r = await client.post("/staff/products", headers=_h(tok), json={
        "brand_slug": "apple", "category_slug": "phones", "model": model,
        "title": tag + " " + model, "slug": tag + "-" + model.lower().replace(" ", "-")})
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _lot_with_units(client, tok, tag: str, units: list[int | None]) -> tuple[int, str, list[int]]:
    """A lot holding one scanned unit per entry of `units` (a product id, or None for no product)."""
    r = await client.post("/staff/lots", json={"lot_number": tag + "-LOT", "warehouse": "WH-T"},
                          headers=_h(tok))
    assert r.status_code == 201, r.text
    lot = r.json()
    ids = []
    for i, pid in enumerate(units):
        body = {"lot_number": lot["lot_number"], "serial_number": f"{tag}-S{i}"}
        if pid is not None:
            body["product_id"] = pid
        s = await client.post("/staff/assets/scan-in", json=body, headers=_h(tok))
        assert s.status_code == 201, s.text
        ids.append(s.json()["id"])
    return lot["id"], lot["lot_number"], ids


async def _upload(client, tok, asset_id: int, name: str = "unit.png", ctype: str = "image/png",
                  blob: bytes = PNG):
    return await client.post(f"/staff/assets/{asset_id}/images", headers=_h(tok),
                             files={"file": (name, blob, ctype)})


async def test_upload_stores_the_file_and_shows_it_on_the_unit(client):
    tag = _tag()
    tok = await _staff(client, "admin")
    pid = await _product(client, tok, tag, "iPhone 13")
    _, _, ids = await _lot_with_units(client, tok, tag, [pid])

    up = await _upload(client, tok, ids[0], name="C:\\shots\\front.png")
    assert up.status_code == 201, up.text
    body = up.json()
    # The stored name is the basename: a client that sends a path must not put one in the record.
    assert body["filename"] == "front.png"
    assert body["byte_size"] == len(PNG)

    detail = (await client.get(f"/staff/assets/{ids[0]}", headers=_h(tok))).json()
    assert [i["id"] for i in detail["images"]] == [body["image_id"]]
    assert detail["images"][0]["media_id"] == body["media_id"]
    assert detail["images"][0]["applied_by_bulk"] is False
    # All four grades are always present, null where the lot has set none.
    assert detail["grade_templates"] == {"A": None, "B": None, "C": None, "D": None}

    raw = await client.get(f"/staff/assets/{ids[0]}/images/{body['image_id']}/raw", headers=_h(tok))
    assert raw.status_code == 200, raw.text
    assert raw.content == PNG
    assert raw.headers["content-type"] == "image/png"
    assert raw.headers["x-content-type-options"] == "nosniff"

    assert await _audit_actions("asset", ids[0]) == ["scan_in", "image_upload"]

    # THE SAME BYTES A SECOND TIME ARE A SECOND IMAGE. There is no content de-duplication and that
    # is a decision, not an oversight: the hub shows what the unit has, and two shots that happen
    # to be identical are two facts about it. What the unique key prevents is the same FILE ROW
    # being assigned twice - which is the bulk-apply path, pinned in its own test below.
    again = await _upload(client, tok, ids[0])
    assert again.status_code == 201, again.text
    assert again.json()["media_id"] != body["media_id"]
    assert await _one("SELECT count(*) FROM asset_images WHERE asset_id = :i", i=ids[0]) == 2
    # Every file row the door created is referenced by exactly one assignment: no orphans.
    assert await _one("SELECT count(*) FROM media_objects mo WHERE mo.id IN (:a, :b) AND NOT EXISTS "
                      "(SELECT 1 FROM asset_images ai WHERE ai.media_id = mo.id)",
                      a=body["media_id"], b=again.json()["media_id"]) == 0


async def test_upload_refuses_what_it_cannot_serve_back(client):
    """A type the door will not serve and a file over the cap are both answered, not stored.

    The type check runs first and is a whitelist: SVG is a document that can carry script, and this
    door hands back what it takes, so raster-only is the rule rather than "starts with image/".
    """
    tag = _tag()
    tok = await _staff(client, "admin")
    pid = await _product(client, tok, tag, "iPhone 13")
    _, _, ids = await _lot_with_units(client, tok, tag, [pid])
    asset_id = ids[0]

    svg = await _upload(client, tok, asset_id, name="x.svg", ctype="image/svg+xml",
                        blob=b"<svg xmlns='http://www.w3.org/2000/svg'/>")
    assert svg.status_code == 422, svg.text
    empty = await _upload(client, tok, asset_id, blob=b"")
    assert empty.status_code == 422, empty.text
    huge = await client.post(f"/staff/assets/{asset_id}/images", headers=_h(tok),
                             files={"file": ("big.png", b"\x89PNG" + bytes(5 * 1024 * 1024),
                                             "image/png")})
    assert huge.status_code == 413, huge.text

    assert await _one("SELECT count(*) FROM asset_images WHERE asset_id = :i", i=asset_id) == 0
    assert await _audit_actions("asset", asset_id) == ["scan_in"], "a refused upload writes nothing"


async def test_apply_to_model_reaches_the_lot_and_the_model_only(client):
    tag = _tag()
    tok = await _staff(client, "admin")
    pid = await _product(client, tok, tag, "iPhone 13")
    # A second PRODUCT row for the same brand and model: the match is brand+model, not product id.
    twin = await _product(client, tok, tag + "b", "iPhone 13")
    other = await _product(client, tok, tag, "Galaxy S21")

    lot_id, _, ids = await _lot_with_units(client, tok, tag, [pid, pid, twin, other])
    far_lot_id, _, far = await _lot_with_units(client, tok, tag + "far", [pid])
    source = ids[0]

    up = await _upload(client, tok, source)
    assert up.status_code == 201, up.text
    image_id = up.json()["image_id"]
    media_id = up.json()["media_id"]

    r = await client.post(f"/staff/assets/{source}/images/{image_id}/apply-to-model", headers=_h(tok))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["applied"] == 2, body          # ids[1] and the twin-row unit
    assert body["matched_other_units"] == 2
    assert body["already_had_it"] == 0

    eng = get_engine()
    async with eng.begin() as c:
        holders = (await c.execute(text(
            "SELECT asset_id FROM asset_images WHERE media_id = :m ORDER BY asset_id"),
            {"m": media_id})).scalars().all()
    # The Galaxy and the unit in the next lot did not get it.
    assert sorted(holders) == sorted([ids[0], ids[1], ids[2]])
    assert far[0] not in holders
    assert ids[3] not in holders
    # ONE file, four assignments in the lot: the bytes were not copied.
    assert await _one("SELECT count(*) FROM media_objects WHERE id = :m", m=media_id) == 1
    assert await _one("SELECT count(*) FROM asset_images WHERE media_id = :m", m=media_id) == 3

    # The units that GAINED it each carry their own trail entry naming the unit it came from.
    assert await _audit_actions("asset", ids[1]) == ["scan_in", "image_apply"]
    assert await _audit_actions("asset", source) == ["scan_in", "image_upload"]

    # Pressing again adds nothing: the unique key, not a client-side check, is what makes it so.
    again = await client.post(f"/staff/assets/{source}/images/{image_id}/apply-to-model", headers=_h(tok))
    assert again.status_code == 200, again.text
    assert again.json()["applied"] == 0
    assert again.json()["already_had_it"] == 2
    assert await _one("SELECT count(*) FROM media_objects WHERE id = :m", m=media_id) == 1
    assert await _one("SELECT count(*) FROM asset_images WHERE media_id = :m", m=media_id) == 3
    assert lot_id != far_lot_id


async def test_grade_template_is_one_per_grade_per_lot(client):
    tag = _tag()
    tok = await _staff(client, "admin")
    pid = await _product(client, tok, tag, "iPhone 13")
    lot_id, _, ids = await _lot_with_units(client, tok, tag, [pid, pid])
    _, _, far = await _lot_with_units(client, tok, tag + "far", [pid])

    first = (await _upload(client, tok, ids[0], name="a.png")).json()
    second = (await _upload(client, tok, ids[1], name="b.png")).json()
    elsewhere = (await _upload(client, tok, far[0], name="other-lot.png")).json()

    r = await client.post(f"/staff/lots/{lot_id}/grade-templates", headers=_h(tok),
                          json={"grade": "a", "image_id": first["image_id"]})
    assert r.status_code == 200, r.text
    assert r.json() == {"lot_id": lot_id, "grade": "A", "media_id": first["media_id"]}

    # A second image for the same grade REPLACES the first - one grade, one template.
    r = await client.post(f"/staff/lots/{lot_id}/grade-templates", headers=_h(tok),
                          json={"grade": "A", "image_id": second["image_id"]})
    assert r.status_code == 200, r.text
    assert r.json()["media_id"] == second["media_id"]
    assert await _one("SELECT count(*) FROM lot_grade_templates WHERE lot_id = :l AND grade = 'A'",
                      l=lot_id) == 1

    r = await client.post(f"/staff/lots/{lot_id}/grade-templates", headers=_h(tok),
                          json={"grade": "B", "image_id": first["image_id"]})
    assert r.status_code == 200, r.text
    detail = (await client.get(f"/staff/assets/{ids[0]}", headers=_h(tok))).json()
    assert detail["grade_templates"] == {"A": second["media_id"], "B": first["media_id"],
                                         "C": None, "D": None}

    # An image that is not on a unit of THIS lot cannot be a template for it.
    bad = await client.post(f"/staff/lots/{lot_id}/grade-templates", headers=_h(tok),
                            json={"grade": "C", "image_id": elsewhere["image_id"]})
    assert bad.status_code == 409, bad.text
    # A grade outside A-D, and a lot that does not exist.
    assert (await client.post(f"/staff/lots/{lot_id}/grade-templates", headers=_h(tok),
                              json={"grade": "E", "image_id": first["image_id"]})).status_code == 422
    assert (await client.post("/staff/lots/999999999/grade-templates", headers=_h(tok),
                              json={"grade": "A", "image_id": first["image_id"]})).status_code == 404

    # Clearing is an explicit null, not a missing field.
    r = await client.post(f"/staff/lots/{lot_id}/grade-templates", headers=_h(tok),
                          json={"grade": "A", "image_id": None})
    assert r.status_code == 200, r.text
    assert r.json()["media_id"] is None
    assert (await client.get(f"/staff/assets/{ids[0]}", headers=_h(tok))).json()["grade_templates"]["A"] is None
    assert (await client.post(f"/staff/lots/{lot_id}/grade-templates", headers=_h(tok),
                              json={"grade": "A"})).status_code == 422

    assert "grade_template_set" in await _audit_actions("lot", lot_id)
    assert "grade_template_clear" in await _audit_actions("lot", lot_id)


async def test_the_image_doors_take_the_asset_pages_own_roles(client):
    """A `sales` token - which may price and publish - may not touch the media, and neither may a
    technician. The tuple is the asset detail page's read wall: a door onto a record a role cannot
    open would be the wider gate this suite exists to prevent."""
    tag = _tag()
    boss = await _staff(client, "admin")
    pid = await _product(client, boss, tag, "iPhone 13")
    lot_id, _, ids = await _lot_with_units(client, boss, tag, [pid, pid])
    image_id = (await _upload(client, boss, ids[0])).json()["image_id"]

    for role in ("sales", "technician", "warehouse"):
        tok = await _staff(client, role)
        assert (await _upload(client, tok, ids[0])).status_code == 403, role
        assert (await client.post(f"/staff/assets/{ids[0]}/images/{image_id}/apply-to-model",
                                  headers=_h(tok))).status_code == 403, role
        assert (await client.post(f"/staff/lots/{lot_id}/grade-templates", headers=_h(tok),
                                  json={"grade": "A", "image_id": image_id})).status_code == 403, role
        assert (await client.get(f"/staff/assets/{ids[0]}/images/{image_id}/raw",
                                 headers=_h(tok))).status_code == 403, role

    # A manager - the store manager - may do all four.
    mgr = await _staff(client, "manager")
    assert (await _upload(client, mgr, ids[1])).status_code == 201
    assert (await client.post(f"/staff/assets/{ids[0]}/images/{image_id}/apply-to-model",
                              headers=_h(mgr))).status_code == 200
    assert (await client.post(f"/staff/lots/{lot_id}/grade-templates", headers=_h(mgr),
                              json={"grade": "D", "image_id": image_id})).status_code == 200
    assert (await client.get(f"/staff/assets/{ids[0]}/images/{image_id}/raw",
                             headers=_h(mgr))).status_code == 200
