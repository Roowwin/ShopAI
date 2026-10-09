import uuid

from sqlalchemy import text

from app.bootstrap_staff import bootstrap
from app.core.db import get_engine


def _h(tok: str) -> dict:
    return {"Authorization": "Bearer " + tok}


async def _admin(client) -> str:
    email = "pytest-" + uuid.uuid4().hex + "@test.rfo"
    sid, pw = await bootstrap(email, "admin")
    r = await client.post("/staff/auth/login", json={"email": email, "password": pw})
    return r.json()["access_token"]


async def test_assistant_proposes_without_writing(client):
    tok = await _admin(client)
    eng = get_engine()
    async with eng.begin() as c:
        before = (await c.execute(text("SELECT count(*) FROM assets"))).scalar_one()
    r = await client.post("/staff/assistant", json={"message": "scan in serial RX-A-NEW-9 into lot LOT-2026-0002"}, headers=_h(tok))
    assert r.status_code == 200, r.text
    assert r.json()["type"] == "proposed", r.json()
    async with eng.begin() as c:
        after = (await c.execute(text("SELECT count(*) FROM assets"))).scalar_one()
    assert after == before, "proposal must not write"


async def test_assistant_executes_scan_in(client):
    tok = await _admin(client)
    sn = "RX-AI-" + uuid.uuid4().hex[:8]
    r = await client.post("/staff/assistant", json={"message": "scan in serial " + sn + " into lot LOT-2026-0002", "execute": True}, headers=_h(tok))
    assert r.status_code == 200 and r.json()["type"] == "executed", r.text
    from app.core.db import get_engine
    eng = get_engine()
    async with eng.begin() as c:
        n = (await c.execute(text("SELECT count(*) FROM assets WHERE serial_number = :s"), {"s": sn})).scalar_one()
        mv = (await c.execute(text("SELECT count(*) FROM stock_movements m JOIN assets a ON a.id = m.asset_id WHERE a.serial_number = :s AND m.qty = 1"), {"s": sn})).scalar_one()
        au = (await c.execute(text("SELECT count(*) FROM audit_log WHERE entity='asset' AND action='scan_in'"))).scalar_one()
    assert n == 1 and mv >= 1 and au >= 1
