import uuid

from sqlalchemy import text

from app.bootstrap_staff import bootstrap
from app.core.db import get_engine
from app.workers.worker import release_expired_reservations


async def _cleanup():
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("DELETE FROM refresh_tokens WHERE identity_id IN (SELECT id FROM staff_users WHERE email LIKE 'pytest-%')"))
        await c.execute(text("DELETE FROM staff_users WHERE email LIKE 'pytest-%'"))


def _h(tok: str) -> dict:
    return {"Authorization": "Bearer " + tok}


async def test_ttl_release_and_idempotence(client):
    await _cleanup()
    email = "pytest-" + uuid.uuid4().hex + "@test.rfo"
    sid, pw = await bootstrap(email, "admin")
    r = await client.post("/staff/auth/login", json={"email": email, "password": pw})
    tok = r.json()["access_token"]

    r = await client.post("/staff/lots", json={"notes": "pytest"}, headers=_h(tok))
    ln = r.json()["lot_number"]
    sn = "pytest-" + uuid.uuid4().hex
    r = await client.post("/staff/assets/scan-in", json={"lot_number": ln, "serial_number": sn}, headers=_h(tok))
    aid = r.json()["id"]
    await client.post(f"/staff/assets/{aid}/status", json={"status": "tested"}, headers=_h(tok))
    await client.post(f"/staff/assets/{aid}/grade", json={"grade": "A"}, headers=_h(tok))
    await client.post(f"/staff/assets/{aid}/price", json={"sale_price_cents": 19900}, headers=_h(tok))
    await client.post(f"/staff/assets/{aid}/status", json={"status": "listed"}, headers=_h(tok))

    r = await client.post("/store/reservations", json={"asset_id": aid, "hold_minutes": 5})
    assert r.status_code == 201, r.text

    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("UPDATE reservations SET expires_at = now() - INTERVAL '1 minute' WHERE asset_id = :i"),
                        {"i": aid})

    n = await release_expired_reservations({})
    assert n == 1, f"expected 1 release, got {n}"
    async with eng.begin() as c:
        st = (await c.execute(text("SELECT status FROM assets WHERE id = :i"), {"i": aid})).scalar_one()
        rs = (await c.execute(text("SELECT status FROM reservations WHERE asset_id = :i"), {"i": aid})).scalar_one()
    assert st == "listed" and rs == "released", (st, rs)

    n2 = await release_expired_reservations({})
    assert n2 == 0, "second run must release nothing (idempotent)"