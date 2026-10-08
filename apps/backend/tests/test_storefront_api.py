import uuid

from sqlalchemy import text

from app.bootstrap_staff import bootstrap
from app.core.db import get_engine


def _h(tok: str) -> dict:
    return {"Authorization": "Bearer " + tok}


async def test_catalog_from_seed_stock(client):
    r = await client.get("/store/catalog")
    assert r.status_code == 200, r.text
    items = {i["slug"]: i for i in r.json()}
    assert "galaxy-s21" in items
    g = items["galaxy-s21"]
    assert g["units_available"] >= 10 and g["price_from_cents"] == 27900
    assert "iphone-13" not in items

    r = await client.get("/store/catalog/galaxy-s21")
    assert r.status_code == 200, r.text
    u = r.json()["units"]
    assert len(u) >= 10 and u[0]["sale_price_cents"] == 27900
    assert all(len(x["serial_tail"] or "") <= 4 for x in u), "serials must be masked"

    r = await client.get("/store/catalog/iphone-13")
    assert r.status_code == 200, r.text
    assert r.json()["units"] == [], "zero-stock product page: live but empty"


async def test_search(client):
    r = await client.get("/store/search", params={"q": "galaxy"})
    items = r.json()
    hit = [x for x in items if x["slug"] == "galaxy-s21"]
    assert len(hit) == 1 and hit[0]["units_available"] >= 10
    r = await client.get("/store/search", params={"q": "zzz-not-a-thing"})
    assert r.json() == []


async def test_guest_checkout_to_paid(client):
    await _staff_cleanup()
    eng = get_engine()

    email = "pytest-" + uuid.uuid4().hex + "@test.rfo"
    sid, pw = await bootstrap(email, "admin")
    r = await client.post("/staff/auth/login", json={"email": email, "password": pw})
    tok = r.json()["access_token"]

    r = await client.post("/staff/lots", json={"notes": "pytest"}, headers=_h(tok))
    lot = r.json()
    ln = lot["lot_number"]

    sn = "pytest-" + uuid.uuid4().hex
    r = await client.post("/staff/assets/scan-in", json={"lot_number": ln, "serial_number": sn}, headers=_h(tok))
    assert r.status_code == 201, r.text
    aid = r.json()["id"]
    await client.post(f"/staff/assets/{aid}/status", json={"status": "tested"}, headers=_h(tok))
    await client.post(f"/staff/assets/{aid}/grade", json={"grade": "A"}, headers=_h(tok))
    await client.post(f"/staff/assets/{aid}/price", json={"sale_price_cents": 19900}, headers=_h(tok))
    await client.post(f"/staff/assets/{aid}/status", json={"status": "listed"}, headers=_h(tok))

    r = await client.post("/store/reservations", json={"asset_id": aid})
    assert r.status_code == 409 and "lot" in r.json()["detail"], r.text
    r = await client.post("/store/checkout", json={"asset_ids": [aid], "shipping_country": "AU",
                                                   "ship_to_name": "T", "ship_line1": "x", "ship_city": "Sydney", "ship_postcode": "2000"})
    assert r.status_code == 409 and "lot" in r.json()["detail"], r.text

    r = await client.post(f"/staff/lots/{lot['id']}/activate", headers=_h(tok))
    assert r.status_code == 200, r.text

    r = await client.post("/store/checkout", json={"asset_ids": [aid], "shipping_country": "AU",
                                                   "ship_to_name": "T", "ship_line1": "x", "ship_city": "Sydney", "ship_postcode": "2000"})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["subtotal_cents"] == 19900 and out["total_cents"] == 19900 + 1990, out

    r = await client.post(f"/store/orders/{out['order_public_id']}/pay")
    assert r.status_code == 200, r.text
    r = await client.post(f"/store/orders/{out['order_public_id']}/simulate-payment")
    assert r.status_code == 200 and r.json()["status"] == "paid", r.text

    async with eng.begin() as c:
        st = (await c.execute(text("SELECT status FROM assets WHERE id = :i"), {"i": aid})).scalar_one()
        mv = (await c.execute(text("SELECT count(*) FROM stock_movements WHERE asset_id = :i AND qty = -1"), {"i": aid})).scalar_one()
    assert st == "sold" and mv == 1


async def _staff_cleanup():
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("DELETE FROM refresh_tokens WHERE identity_id IN (SELECT id FROM staff_users WHERE email LIKE 'pytest-%')"))
        await c.execute(text("DELETE FROM staff_users WHERE email LIKE 'pytest-%'"))