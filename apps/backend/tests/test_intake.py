import uuid

from sqlalchemy import text

from app.bootstrap_staff import bootstrap
from app.core.db import get_engine


async def _cleanup():
    # The stock ledger is append-only by design (Phase 2 probes): movement rows and
    # their assets can never be deleted. pytest-% rows accumulate harmlessly in dev
    # and are invisible to storefront logic; only auth-side rows are cleaned.
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("DELETE FROM refresh_tokens WHERE identity_id IN (SELECT id FROM staff_users WHERE email LIKE 'pytest-%')"))
        await c.execute(text("DELETE FROM staff_users WHERE email LIKE 'pytest-%'"))
        await c.execute(text("DELETE FROM users WHERE email LIKE 'pytest-%'"))


def _h(tok: str) -> dict:
    return {"Authorization": "Bearer " + tok}


async def _staff(client, role: str) -> str:
    email = "pytest-" + uuid.uuid4().hex + "@test.rfo"
    sid, pw = await bootstrap(email, role)
    r = await client.post("/staff/auth/login", json={"email": email, "password": pw})
    return r.json()["access_token"]


async def test_full_asset_lifecycle(client):
    await _cleanup()
    tok = await _staff(client, "admin")
    r = await client.post("/staff/lots", json={"warehouse": "WH-T", "notes": "pytest"}, headers=_h(tok))
    assert r.status_code == 201, r.text
    lot = r.json()
    assert lot["status"] == "intake" and lot["lot_number"].startswith("LOT-")

    sn1 = "pytest-" + uuid.uuid4().hex
    r1 = await client.post("/staff/assets/scan-in", json={"lot_number": lot["lot_number"], "serial_number": sn1}, headers=_h(tok))
    r2 = await client.post("/staff/assets/scan-in", json={"lot_number": lot["lot_number"], "serial_number": "pytest-" + uuid.uuid4().hex}, headers=_h(tok))
    assert r1.status_code == 201 and r2.status_code == 201, (r1.text, r2.text)
    a1 = r1.json()

    mv = (await client.get("/staff/movements?asset_id=" + str(a1["id"]), headers=_h(tok))).json()
    assert len(mv) >= 1 and mv[0]["qty"] == 1 and mv[0]["reason"] == "intake_scan"

    r = await client.post(f"/staff/assets/{a1['id']}/grade", json={"grade": "A"}, headers=_h(tok))
    assert r.status_code == 409, "received -> graded must be rejected by trigger"

    r = await client.post(f"/staff/assets/{a1['id']}/status", json={"status": "tested"}, headers=_h(tok))
    assert r.status_code == 200
    r = await client.post(f"/staff/assets/{a1['id']}/grade", json={"grade": "A", "cost_cents": 15000}, headers=_h(tok))
    assert r.status_code == 200 and r.json()["grade"] == "A"

    eng = get_engine()
    async with eng.begin() as c:
        n = (await c.execute(text("SELECT count(*) FROM audit_log WHERE entity = :e AND entity_id = :i"),
                             {"e": "asset", "i": a1["id"]})).scalar_one()
    assert n >= 1, "audit rows missing"

    r = await client.post(f"/staff/assets/{a1['id']}/price", json={"sale_price_cents": 15000}, headers=_h(tok))
    assert r.status_code == 200, r.text
    r = await client.post(f"/staff/assets/{a1['id']}/status", json={"status": "listed"}, headers=_h(tok))
    assert r.status_code == 200
    r = await client.post(f"/staff/lots/{lot['id']}/activate", headers=_h(tok))
    assert r.status_code == 200
    async with eng.begin() as c:
        n = (await c.execute(text("SELECT count(*) FROM v_storefront_assets WHERE serial_number = :s"),
                             {"s": sn1})).scalar_one()
    assert n == 1, "listed asset not on storefront view"

    r = await client.post(f"/staff/assets/{a1['id']}/status", json={"status": "sold"}, headers=_h(tok))
    assert r.status_code == 200
    async with eng.begin() as c:
        n = (await c.execute(text("SELECT count(*) FROM v_storefront_assets WHERE serial_number = :s"),
                             {"s": sn1})).scalar_one()
        ls = (await c.execute(text("SELECT status FROM lots WHERE lot_number = :l"),
                              {"l": lot["lot_number"]})).scalar_one()
    assert n == 0 and ls == "completed", "sellout rule failed"


async def test_dup_serial_409(client):
    await _cleanup()
    tok = await _staff(client, "warehouse")
    r = await client.post("/staff/lots", json={"notes": "pytest"}, headers=_h(tok))
    ln = r.json()["lot_number"]
    sn = "pytest-" + uuid.uuid4().hex
    a = await client.post("/staff/assets/scan-in", json={"lot_number": ln, "serial_number": sn}, headers=_h(tok))
    assert a.status_code == 201
    b = await client.post("/staff/assets/scan-in", json={"lot_number": ln, "serial_number": sn}, headers=_h(tok))
    assert b.status_code == 409


async def test_rbac_scan_in_sales_403(client):
    await _cleanup()
    tok_sales = await _staff(client, "sales")
    tok_wh = await _staff(client, "warehouse")
    r2 = await client.post("/staff/lots", json={"notes": "pytest"}, headers=_h(tok_wh))
    assert r2.status_code == 201
    r3 = await client.post("/staff/assets/scan-in",
                           json={"lot_number": r2.json()["lot_number"], "serial_number": "pytest-" + uuid.uuid4().hex},
                           headers=_h(tok_sales))
    assert r3.status_code == 403


async def test_move_audited(client):
    await _cleanup()
    tok = await _staff(client, "warehouse")
    r = await client.post("/staff/lots", json={"notes": "pytest"}, headers=_h(tok))
    ln = r.json()["lot_number"]
    a = await client.post("/staff/assets/scan-in", json={"lot_number": ln, "serial_number": "pytest-" + uuid.uuid4().hex}, headers=_h(tok))
    aid = a.json()["id"]
    m = await client.post(f"/staff/assets/{aid}/move", json={"location": "WH-B-02"}, headers=_h(tok))
    assert m.status_code == 200 and m.json()["location"] == "WH-B-02"
    eng = get_engine()
    async with eng.begin() as c:
        n = (await c.execute(text("SELECT count(*) FROM audit_log WHERE entity = :e AND entity_id = :i AND action = :a"),
                             {"e": "asset", "i": aid, "a": "move"})).scalar_one()
    assert n >= 1