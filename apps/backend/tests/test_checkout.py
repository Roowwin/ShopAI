import hashlib
import hmac
import json
import uuid

from sqlalchemy import text

from app.bootstrap_staff import bootstrap
from app.core.config import get_settings
from app.core.db import get_engine


async def _cleanup():
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("DELETE FROM refresh_tokens WHERE identity_id IN (SELECT id FROM staff_users WHERE email LIKE 'pytest-%')"))
        await c.execute(text("DELETE FROM users WHERE email LIKE 'pytest-%'"))
        await c.execute(text("DELETE FROM staff_users WHERE email LIKE 'pytest-%'"))


def _h(tok: str) -> dict:
    return {"Authorization": "Bearer " + tok}


async def _wh(client, ref: str, event: str) -> int:
    s = get_settings()
    body = json.dumps({"ref": ref, "event": event})
    sig = hmac.new(s.PAYMENT_WEBHOOK_SECRET.encode(), body.encode(), hashlib.sha256).hexdigest()
    r = await client.post("/store/webhooks/payments/stub", content=body,
                          headers={"Content-Type": "application/json", "x-stub-signature": sig})
    return r.status_code


async def test_pricing_reserve_checkout_webhook_sellout(client):
    await _cleanup()
    tok = await _staff_token(client, "admin")
    r = await client.post("/staff/lots", json={"notes": "pytest"}, headers=_h(tok))
    ln = r.json()["lot_number"]

    sn = "pytest-" + uuid.uuid4().hex
    r = await client.post("/staff/assets/scan-in", json={"lot_number": ln, "serial_number": sn}, headers=_h(tok))
    aid = r.json()["id"]

    r = await client.post(f"/staff/assets/{aid}/status", json={"status": "tested"}, headers=_h(tok))
    assert r.status_code == 200
    r = await client.post(f"/staff/assets/{aid}/grade", json={"grade": "A", "cost_cents": 15000}, headers=_h(tok))
    assert r.status_code == 200
    r = await client.post(f"/staff/assets/{aid}/price", json={"sale_price_cents": 19900}, headers=_h(tok))
    assert r.status_code == 200 and r.json()["sale_price_cents"] == 19900

    r = await client.post(f"/staff/assets/{aid}/status", json={"status": "listed"}, headers=_h(tok))
    assert r.status_code == 200, r.text
    r = await client.post("/store/reservations", json={"asset_id": aid, "hold_minutes": 5})
    assert r.status_code == 201, r.text
    res_id = r.json()["reservation_id"]
    r = await client.post("/store/reservations", json={"asset_id": aid})
    assert r.status_code == 409, "double reserve must fail"
    r = await client.post(f"/store/reservations/{res_id}/release")
    assert r.status_code == 200, r.text

    r = await client.post("/store/checkout", json={"asset_ids": [aid], "shipping_country": "NZ",
                                                   "ship_to_name": "T", "ship_line1": "1 St", "ship_city": "Auckland", "ship_postcode": "1010"})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["subtotal_cents"] == 19900 and out["total_cents"] == 19900 + 2985, out   # NZ 15%

    r = await client.post(f"/store/orders/{out['order_public_id']}/pay")
    assert r.status_code == 200, r.text
    ref = r.json()["payment_ref"]

    code = await _wh(client, ref, "payment.succeeded")
    assert code == 200, f"webhook failed: {code}"
    code = await _wh(client, ref, "payment.succeeded")   # replay
    assert code == 200, "replay must be idempotent (no double effects - proven by mv==1 below)"

    eng = get_engine()
    async with eng.begin() as c:
        sold = (await c.execute(text("SELECT status FROM assets WHERE id = :i"), {"i": aid})).scalar_one()
        paid = (await c.execute(text("SELECT o.status FROM orders o JOIN payments p ON p.order_id = o.id WHERE p.provider_ref = :r"), {"r": ref})).scalar_one()
        mv = (await c.execute(text("SELECT count(*) FROM stock_movements WHERE asset_id = :i AND qty = -1"), {"i": aid})).scalar_one()
    assert sold == "sold" and paid == "paid" and mv == 1


async def test_webhook_failed_returns_unit(client):
    await _cleanup()
    tok = await _staff_token(client, "manager")
    r = await client.post("/staff/lots", json={"notes": "pytest"}, headers=_h(tok))
    ln = r.json()["lot_number"]
    sn = "pytest-" + uuid.uuid4().hex
    r = await client.post("/staff/assets/scan-in", json={"lot_number": ln, "serial_number": sn}, headers=_h(tok))
    aid = r.json()["id"]
    # seed lot with a product? scan-in without product -> price via endpoint works regardless
    await client.post(f"/staff/assets/{aid}/status", json={"status": "tested"}, headers=_h(tok))
    await client.post(f"/staff/assets/{aid}/grade", json={"grade": "B"}, headers=_h(tok))
    await client.post(f"/staff/assets/{aid}/price", json={"sale_price_cents": 9900}, headers=_h(tok))
    await client.post(f"/staff/assets/{aid}/status", json={"status": "listed"}, headers=_h(tok))

    r = await client.post("/store/checkout", json={"asset_ids": [aid], "shipping_country": "AU",
                                                   "ship_to_name": "T", "ship_line1": "2 St", "ship_city": "Melbourne", "ship_postcode": "3000"})
    out = r.json()
    assert out["subtotal_cents"] == 9900 and out["total_cents"] == 9900 + 990, out   # AU 10%

    r = await client.post(f"/store/orders/{out['order_public_id']}/pay")
    ref = r.json()["payment_ref"]
    code = await _wh(client, ref, "payment.failed")
    assert code == 200, f"webhook failed: {code}"
    eng = get_engine()
    async with eng.begin() as c:
        st = (await c.execute(text("SELECT status FROM assets WHERE id = :i"), {"i": aid})).scalar_one()
        os = (await c.execute(text("SELECT o.status FROM orders o JOIN payments p ON p.order_id = o.id WHERE p.provider_ref = :r"), {"r": ref})).scalar_one()
    assert st == "listed" and os == "cancelled", "failed payment must return unit to storefront"


async def test_price_rbac_403(client):
    await _cleanup()
    tok_tech = await _staff_token(client, "technician")
    tok_wh = await _staff_token(client, "warehouse")
    r = await client.post("/staff/lots", json={"notes": "pytest"}, headers=_h(tok_wh))
    ln = r.json()["lot_number"]
    r = await client.post("/staff/assets/scan-in", json={"lot_number": ln, "serial_number": "pytest-" + uuid.uuid4().hex}, headers=_h(tok_wh))
    aid = r.json()["id"]
    r = await client.post(f"/staff/assets/{aid}/price", json={"sale_price_cents": 500}, headers=_h(tok_tech))
    assert r.status_code == 403
    r = await client.post(f"/staff/assets/{aid}/price", json={"sale_price_cents": 500}, headers=_h(tok_wh))
    assert r.status_code == 403   # warehouse cannot price either


async def _staff_token(client, role: str) -> str:
    email = "pytest-" + uuid.uuid4().hex + "@test.rfo"
    sid, pw = await bootstrap(email, role)
    r = await client.post("/staff/auth/login", json={"email": email, "password": pw})
    return r.json()["access_token"]