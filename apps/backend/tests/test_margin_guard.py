"""The margin guard: one rule, four layers - importer, staff doors, checkout, storefront.

A unit is a LOSS-MAKER when its resale price is below what it cost us (``price < cost``); at cost is
zero margin, not a loss, and an unknown cost is never a loss. Because the rule has four enforcement
points that must never disagree, this file exercises all four against ONE fixture shape: a normally
listed unit, then the same unit nudged below its cost the way legacy or pre-guard data would be (a
direct UPDATE - the staff doors, correctly, will not make one).

Everything that writes here is either append-only (assets, ledger) or restored in a ``finally``: the
fixture PRODUCTS are archived (the schema's own off-state, which takes them off the storefront) and
the staff identity is removed. The importer's own lots/serials are left in place because the ledger
is append-only by grant and cannot be deleted - they carry a 'pytest' prefix so nothing else reads
them.
"""
import io
import uuid

from sqlalchemy import text

from app.bootstrap_staff import bootstrap
from app.core.db import get_engine


def _h(tok: str) -> dict:
    return {"Authorization": "Bearer " + tok}


# This file's own brand and category. `create_product` refuses an unknown slug, and the demo
# catalogue's brands are the owner's hand-created stock - which a freshly migrated database (and a
# busy shared one) does not have. So the fixture owns its two rows, created idempotently, exactly
# the way the accepted stock-seeded suites are moving to.
BRAND = "mission-margin-brand"
CATEGORY = "mission-margin-category"


async def _ensure_brand_category() -> None:
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("INSERT INTO brands (name, slug) VALUES (:n, :s)"
                             " ON CONFLICT (slug) DO NOTHING"), {"n": BRAND, "s": BRAND})
        await c.execute(text("INSERT INTO categories (name, slug) VALUES (:n, :s)"
                             " ON CONFLICT (slug) DO NOTHING"), {"n": CATEGORY, "s": CATEGORY})


async def _staff(client, role: str = "admin") -> tuple[dict, str]:
    # DELIBERATELY NOT the repo's usual "pytest-" prefix. Several suites - and the factory gate -
    # tear down with `DELETE FROM staff_users WHERE email LIKE 'pytest-%'`, so on a shared dev
    # database two runs in flight at once delete each other's identities mid-test and every door
    # then answers 401 "account unavailable". Naming these identities outside that pattern is what
    # makes this file's result a statement about the code rather than about who else was running.
    email = "mission-" + uuid.uuid4().hex + "@test.rfo"
    _, pw = await bootstrap(email, role)
    r = await client.post("/staff/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return _h(r.json()["access_token"]), email


async def _drop_staff(email: str) -> None:
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("DELETE FROM refresh_tokens WHERE identity_id IN "
                             "(SELECT id FROM staff_users WHERE email = :e)"), {"e": email})
        await c.execute(text("DELETE FROM staff_users WHERE email = :e"), {"e": email})


async def _archive(products: list[int]) -> None:
    eng = get_engine()
    async with eng.begin() as c:
        for pid in products:
            await c.execute(text("UPDATE products SET status = 'archived' WHERE id = :i"), {"i": pid})


async def _price_direct(asset_id: int, cents: int | None) -> None:
    """Write a price straight to the row - the state the staff doors will not create on purpose."""
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("UPDATE assets SET sale_price_cents = :p WHERE id = :i"),
                        {"p": cents, "i": asset_id})


async def _cost_direct(asset_id: int, cents: int | None) -> None:
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("UPDATE assets SET cost_cents = :p WHERE id = :i"),
                        {"p": cents, "i": asset_id})


async def _listed_unit(client, h: dict, *, slug: str, cost: int, price: int) -> tuple[int, int, str]:
    """A real product with one listed unit, built through the same doors the storefront reads.

    Returns (product_id, asset_id, product_slug).
    """
    await _ensure_brand_category()
    r = await client.post("/staff/products", headers=h, json={
        "brand_slug": BRAND, "category_slug": CATEGORY, "model": "Pytest margin device",
        "title": "Pytest margin " + slug, "slug": slug, "specs": {"note": "pytest margin"}})
    assert r.status_code == 201, r.text
    pid = r.json()["id"]

    r = await client.post("/staff/lots", headers=h, json={"warehouse": "WH-A", "notes": "pytest margin"})
    assert r.status_code == 201, r.text
    lot_id, lot_number = r.json()["id"], r.json()["lot_number"]

    serial = "mission-margin-" + uuid.uuid4().hex[:10]
    r = await client.post("/staff/assets/scan-in", headers=h,
                          json={"serial_number": serial, "lot_number": lot_number, "product_id": pid})
    assert r.status_code == 201, r.text
    aid = r.json()["id"]

    # One call walks received -> tested -> graded (the ladder's own rung) and sets the cost.
    r = await client.post(f"/staff/assets/{aid}/grade", headers=h,
                          json={"grade": "A", "cost_cents": cost, "test_first": True})
    assert r.status_code == 200, r.text
    r = await client.post(f"/staff/assets/{aid}/price", headers=h, json={"sale_price_cents": price})
    assert r.status_code == 200, r.text
    assert (await client.post(f"/staff/lots/{lot_id}/activate", headers=h)).status_code == 200
    r = await client.post(f"/staff/assets/{aid}/status", headers=h, json={"status": "listed"})
    assert r.status_code == 200, r.text
    return pid, aid, slug


# ---------------------------------------------------------------------------
# Layer 2: the staff doors
# ---------------------------------------------------------------------------
async def test_pricing_below_cost_is_refused(client):
    h, email = await _staff(client)
    slug = "mission-margin-price-" + uuid.uuid4().hex[:8]
    products: list[int] = []
    try:
        await _ensure_brand_category()
        r = await client.post("/staff/products", headers=h, json={
            "brand_slug": BRAND, "category_slug": CATEGORY, "model": "Pytest margin device",
            "title": "Pytest margin " + slug, "slug": slug})
        pid = r.json()["id"]
        products.append(pid)
        r = await client.post("/staff/lots", headers=h, json={"notes": "pytest margin"})
        lot_number = r.json()["lot_number"]
        r = await client.post("/staff/assets/scan-in", headers=h, json={
            "serial_number": "mission-margin-" + uuid.uuid4().hex[:10], "lot_number": lot_number,
            "product_id": pid})
        aid = r.json()["id"]
        await client.post(f"/staff/assets/{aid}/grade", headers=h,
                          json={"grade": "A", "cost_cents": 20000, "test_first": True})

        r = await client.post(f"/staff/assets/{aid}/price", headers=h, json={"sale_price_cents": 15000})
        assert r.status_code == 422, "a price below cost must be refused: " + r.text
        assert "below cost" in r.json()["detail"]

        r = await client.post(f"/staff/assets/{aid}/price", headers=h, json={"sale_price_cents": 20000})
        assert r.status_code == 200, "at cost is zero margin, not a loss: " + r.text
    finally:
        await _archive(products)
        await _drop_staff(email)


async def test_listing_a_loss_maker_is_refused(client):
    h, email = await _staff(client)
    slug = "mission-margin-list-" + uuid.uuid4().hex[:8]
    products: list[int] = []
    try:
        pid, aid, _ = await _listed_unit(client, h, slug=slug, cost=20000, price=25000)
        products.append(pid)
        # Take it back off the shelf and make it a loss-maker directly, then try to list it again.
        await client.post(f"/staff/assets/{aid}/status", headers=h, json={"status": "tested"})
        await _cost_direct(aid, 30000)          # cost now above the 25000 price
        r = await client.post(f"/staff/assets/{aid}/status", headers=h, json={"status": "listed"})
        assert r.status_code == 422, "listing a loss-maker must be refused: " + r.text
        assert "below cost" in r.json()["detail"]
    finally:
        await _archive(products)
        await _drop_staff(email)


async def test_a_unit_with_no_cost_is_never_a_loss(client):
    """An unknown cost is the absence of the fact, not the claim the unit was free."""
    h, email = await _staff(client)
    slug = "mission-margin-nocost-" + uuid.uuid4().hex[:8]
    products: list[int] = []
    try:
        await _ensure_brand_category()
        r = await client.post("/staff/products", headers=h, json={
            "brand_slug": BRAND, "category_slug": CATEGORY, "model": "Pytest margin device",
            "title": "Pytest margin " + slug, "slug": slug})
        pid = r.json()["id"]; products.append(pid)
        r = await client.post("/staff/lots", headers=h, json={"notes": "pytest margin"})
        lot_id, lot_number = r.json()["id"], r.json()["lot_number"]
        r = await client.post("/staff/assets/scan-in", headers=h, json={
            "serial_number": "mission-margin-" + uuid.uuid4().hex[:10], "lot_number": lot_number,
            "product_id": pid})
        aid = r.json()["id"]
        # No cost_cents anywhere - grade without it.
        await client.post(f"/staff/assets/{aid}/grade", headers=h, json={"grade": "B", "test_first": True})
        r = await client.post(f"/staff/assets/{aid}/price", headers=h, json={"sale_price_cents": 1})
        assert r.status_code == 200, "a 1-cent unit with no cost on record is not a loss: " + r.text
        await client.post(f"/staff/lots/{lot_id}/activate", headers=h)
        assert (await client.post(f"/staff/assets/{aid}/status", headers=h,
                                  json={"status": "listed"})).status_code == 200
    finally:
        await _archive(products)
        await _drop_staff(email)


# ---------------------------------------------------------------------------
# Layer 4 + 3: the storefront hides it, and the checkout refuses it
# ---------------------------------------------------------------------------
async def test_a_loss_maker_vanishes_from_the_storefront_and_cannot_be_bought(client):
    h, email = await _staff(client)
    slug = "mission-margin-shop-" + uuid.uuid4().hex[:8]
    products: list[int] = []
    try:
        pid, aid, _ = await _listed_unit(client, h, slug=slug, cost=20000, price=25000)
        products.append(pid)

        items = (await client.get("/store/catalog?limit=100")).json()
        assert any(i["slug"] == slug for i in items), "the unit is on the shelf to begin with"

        # A pre-guard row: priced below cost directly, exactly how legacy data looks.
        await _price_direct(aid, 15000)

        items = (await client.get("/store/catalog?limit=100")).json()
        assert not any(i["slug"] == slug for i in items), "a loss-maker must vanish from the shop"

        detail = await client.get(f"/store/catalog/{slug}")
        assert detail.status_code == 200, detail.text
        assert detail.json()["units"] == [], "the product page must offer no loss-making unit"

        r = await client.post("/store/checkout", json={"asset_ids": [aid], "shipping_country": "AU"})
        assert r.status_code == 409, "a crafted checkout of a hidden unit must be refused: " + r.text
        r = await client.post("/store/reservations", json={"asset_id": aid})
        assert r.status_code == 409, "a held loss-maker must be refused too: " + r.text

        # And the guard is exactly the price-vs-cost comparison: restore the price and it returns.
        await _price_direct(aid, 25000)
        items = (await client.get("/store/catalog?limit=100")).json()
        assert any(i["slug"] == slug for i in items), "a unit back above its cost is on the shelf again"
    finally:
        await _archive(products)
        await _drop_staff(email)


# ---------------------------------------------------------------------------
# Layer 1: the importer
# ---------------------------------------------------------------------------
def _csv(rows: list[list[str]]) -> bytes:
    return ("\n".join(",".join(r) for r in rows) + "\n").encode()


async def _import(client, h, rows, *, commit: bool):
    files = {"file": ("mission-margin.csv", io.BytesIO(_csv(rows)), "text/csv")}
    path = "/staff/imports/products/" + ("commit" if commit else "preview")
    return await client.post(path, headers=h, files=files)


async def test_the_importer_blocks_a_row_priced_below_its_cost(client):
    h, email = await _staff(client)
    stamp = uuid.uuid4().hex[:8]
    try:
        rows = [["Serial#", "Lot", "Resale", "Cost"],
                [f"mission-margin-a-{stamp}", f"MISSION-MG-{stamp}", "150", "200"]]
        r = await _import(client, h, rows, commit=False)
        assert r.status_code == 200, r.text
        rep = r.json()
        assert rep["summary"]["blocked"] == 1, rep["summary"]
        assert any("below cost" in i["message"] for i in rep["issues"]), rep["issues"]

        r = await _import(client, h, rows, commit=True)
        assert r.status_code == 422, "the whole file is refused, not the row: " + r.text
    finally:
        await _drop_staff(email)


async def test_the_importer_allows_a_row_at_cost(client):
    """Zero margin is allowed; only strictly below cost is a loss. This pins the boundary."""
    h, email = await _staff(client)
    stamp = uuid.uuid4().hex[:8]
    try:
        rows = [["Serial#", "Lot", "Resale", "Cost"],
                [f"mission-margin-b-{stamp}", f"MISSION-MG-{stamp}", "200", "200"]]
        r = await _import(client, h, rows, commit=False)
        assert r.status_code == 200, r.text
        assert r.json()["summary"]["blocked"] == 0, r.json()["issues"]
    finally:
        await _drop_staff(email)


async def test_the_importer_blocked_message_names_the_two_figures(client):
    """A refusal the operator can act on: it must carry the price and the cost."""
    h, email = await _staff(client)
    stamp = uuid.uuid4().hex[:8]
    try:
        rows = [["Serial#", "Lot", "Resale", "Cost"],
                [f"mission-margin-c-{stamp}", f"MISSION-MG-{stamp}", "15000", "20000"]]
        rep = (await _import(client, h, rows, commit=False)).json()
        issue = next(i for i in rep["issues"] if "below cost" in i["message"])
        assert "15000" in issue["message"] and "20000" in issue["message"], issue
        assert issue["field"] == "price", issue
        assert issue["row"] == 2, issue
    finally:
        await _drop_staff(email)


async def test_a_sku_repeated_in_the_file_is_refused(client):
    h, email = await _staff(client)
    stamp = uuid.uuid4().hex[:8]
    try:
        rows = [["Serial#", "Lot", "SKU #"],
                [f"mission-sku-a-{stamp}", f"MISSION-SKU-{stamp}", f"MISSION-SKU-{stamp}"],
                [f"mission-sku-b-{stamp}", f"MISSION-SKU-{stamp}", f"MISSION-SKU-{stamp}"]]
        rep = (await _import(client, h, rows, commit=False)).json()
        assert rep["summary"]["blocked"] == 1, rep["summary"]
        assert any(i["field"] == "sku" and "also appears on row 2" in i["message"] for i in rep["issues"]), \
            rep["issues"]
    finally:
        await _drop_staff(email)


async def test_a_sku_already_on_the_shelf_is_refused(client):
    """Case-insensitive, and the DB half of the rule: a re-import of the same SKU is refused."""
    h, email = await _staff(client)
    stamp = uuid.uuid4().hex[:8]
    sku = f"MISSION-SKU-{stamp}"
    try:
        first = [["Serial#", "Lot", "SKU #"],
                 [f"mission-sku-d-{stamp}", f"MISSION-SKU-{stamp}", sku]]
        r = await _import(client, h, first, commit=True)
        assert r.status_code == 200, r.text

        # A NEW serial carrying the SAME sku (lowercased, to prove the case-fold), new lot.
        second = [["Serial#", "Lot", "SKU #"],
                  [f"mission-sku-e-{stamp}", f"MISSION-SKU2-{stamp}", sku.lower()]]
        rep = (await _import(client, h, second, commit=False)).json()
        assert rep["summary"]["blocked"] == 1, rep["summary"]
        assert any(i["field"] == "sku" and "already in the system" in i["message"]
                   for i in rep["issues"]), rep["issues"]
    finally:
        await _drop_staff(email)


async def test_the_importer_writes_the_cost_onto_the_unit(client):
    """The guard's input must actually persist, or every later door is blind to it."""
    h, email = await _staff(client)
    stamp = uuid.uuid4().hex[:8]
    serial = f"mission-margin-w-{stamp}"
    try:
        rows = [["Serial#", "Lot", "Resale", "Cost", "Grade", "Status"],
                [serial, f"MISSION-MGW-{stamp}", "250", "200", "A", "graded"]]
        r = await _import(client, h, rows, commit=True)
        assert r.status_code == 200, r.text
        asset = next(a for a in r.json()["assets"] if a["serial_number"] == serial)
        assert asset["cost_cents"] == 20000 and asset["sale_price_cents"] == 25000, asset
        eng = get_engine()
        async with eng.begin() as c:
            stored = (await c.execute(text("SELECT cost_cents FROM assets WHERE id = :i"),
                                      {"i": asset["asset_id"]})).scalar_one()
        assert stored == 20000, stored
    finally:
        await _drop_staff(email)


async def test_the_importer_blocks_on_the_settlement_basis_too(client):
    """The workbook has no Cost column; a supplier sheet puts the cost in Settlement.

    This is the importer reading the SAME cost basis the storefront floor does
    (`COALESCE(cost_cents, settlement_cents)`), so a row refused here is exactly the row the shop
    would refuse to publish - not a second, differently-derived judgement.
    """
    h, email = await _staff(client)
    stamp = uuid.uuid4().hex[:8]
    try:
        rows = [["Serial#", "Lot", "Resale", "Settlement"],
                [f"mission-margin-s-{stamp}", f"MISSION-MGS-{stamp}", "279", "300"]]
        rep = (await _import(client, h, rows, commit=False)).json()
        assert rep["summary"]["blocked"] == 1, rep["summary"]
        assert any("below cost" in i["message"] for i in rep["issues"]), rep["issues"]
    finally:
        await _drop_staff(email)
