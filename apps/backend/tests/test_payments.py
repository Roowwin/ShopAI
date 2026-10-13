"""Payment providers: signature verification, event parsing, and webhook idempotency.

TWO HALVES. The first is pure - no database, no HTTP - and pins each provider's signature scheme and
the mapping from its event vocabulary onto the three normalised events the lifecycle understands.
Those are the parts that would otherwise only ever be exercised by a real Stripe delivery, which
this environment cannot produce. The second drives the webhook door over HTTP with a signed body and
proves the property that matters most about money arriving twice: it lands once.

WHY THE SIGNATURE TESTS ARE UNIT TESTS. A test that POSTed a Stripe-shaped body to the app would
still be testing this module's HMAC, just with more moving parts. Pinning `verify`/`parse` directly
makes the scheme itself the subject - including the cases that are easy to get wrong quietly: a
signature computed over the wrong bytes, a signature from another secret, a missing header, and a
timestamp far enough in the past that a captured request would still verify forever.
"""

import hashlib
import hmac
import json
import time
import uuid

import pytest
from sqlalchemy import text

from app.bootstrap_staff import bootstrap
from app.core.config import get_settings
from app.core.db import get_engine
from app.services import payments as pay

STRIPE_SECRET = "whsec_mission_test"
PAYPAL_SECRET = "paypal_mission_test"


def _stripe_sig(payload: bytes, secret: str, t: int | None = None) -> str:
    stamp = int(time.time()) if t is None else t
    mac = hmac.new(secret.encode(), str(stamp).encode() + b"." + payload, hashlib.sha256).hexdigest()
    return f"t={stamp},v1={mac}"


def _paypal_sig(payload: bytes, secret: str) -> str:
    return hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()


# ---------------------------------------------------------------------------
# Stripe
# ---------------------------------------------------------------------------
def test_stripe_signature_accepts_its_own_and_refuses_everything_else():
    body = json.dumps({"id": "evt_1", "type": "payment_intent.succeeded",
                       "data": {"object": {"id": "pi_1", "amount_received": 25000}}}).encode()
    good = {"stripe-signature": _stripe_sig(body, STRIPE_SECRET)}
    pay.verify(pay.STRIPE, body, good, STRIPE_SECRET)           # does not raise

    ev = pay.parse(pay.STRIPE, body)
    assert ev["event_id"] == "evt_1" and ev["type"] == pay.EV_SUCCEEDED, ev
    assert ev["provider_ref"] == "pi_1" and ev["amount_cents"] == 25000, ev

    # another secret's signature, a signature over DIFFERENT bytes, and no header at all
    with pytest.raises(pay.WebhookRejected):
        pay.verify(pay.STRIPE, body, {"stripe-signature": _stripe_sig(body, "whsec_other")},
                   STRIPE_SECRET)
    with pytest.raises(pay.WebhookRejected):
        pay.verify(pay.STRIPE, body, {"stripe-signature": _stripe_sig(body + b" ", STRIPE_SECRET)},
                   STRIPE_SECRET)
    with pytest.raises(pay.WebhookRejected):
        pay.verify(pay.STRIPE, body, {}, STRIPE_SECRET)


def test_stripe_refuses_a_signature_older_than_the_replay_window():
    body = b'{"id":"evt_old","type":"payment_intent.succeeded","data":{"object":{"id":"pi_old"}}}'
    stale = {"stripe-signature": _stripe_sig(body, STRIPE_SECRET,
                                             t=int(time.time()) - pay.STRIPE_TOLERANCE_SECONDS - 60)}
    with pytest.raises(pay.WebhookRejected):
        pay.verify(pay.STRIPE, body, stale, STRIPE_SECRET)


def test_stripe_maps_a_refund_and_reads_the_charge_it_refers_to():
    """A `charge.refunded` object is the CHARGE: its payment_intent is the id we stored, and the
    refunded amount is the charge's own, not the charge's total."""
    body = json.dumps({"id": "evt_r", "type": "charge.refunded",
                       "data": {"object": {"id": "ch_1", "payment_intent": "pi_1",
                                           "amount": 25000, "amount_refunded": 25000}}}).encode()
    ev = pay.parse(pay.STRIPE, body)
    assert ev["type"] == pay.EV_REFUNDED and ev["provider_ref"] == "pi_1", ev
    assert ev["amount_cents"] == 25000, ev


def test_a_provider_event_this_app_does_not_act_on_is_recorded_as_ignored():
    body = json.dumps({"id": "evt_x", "type": "customer.created",
                       "data": {"object": {"id": "cus_1"}}}).encode()
    assert pay.parse(pay.STRIPE, body)["type"] == pay.EV_IGNORED


# ---------------------------------------------------------------------------
# PayPal
# ---------------------------------------------------------------------------
def test_paypal_signature_and_parsing():
    body = json.dumps({"id": "WH-1", "event_type": "PAYMENT.CAPTURE.COMPLETED",
                       "resource": {"id": "CAP-1", "amount": {"value": "250.00", "currency_code": "AUD"}}
                       }).encode()
    pay.verify(pay.PAYPAL, body, {"x-paypal-signature": _paypal_sig(body, PAYPAL_SECRET)},
               PAYPAL_SECRET)
    ev = pay.parse(pay.PAYPAL, body)
    assert ev["type"] == pay.EV_SUCCEEDED and ev["provider_ref"] == "CAP-1", ev
    assert ev["amount_cents"] == 25000, ev
    with pytest.raises(pay.WebhookRejected):
        pay.verify(pay.PAYPAL, body, {"x-paypal-signature": _paypal_sig(body, "nope")}, PAYPAL_SECRET)


# ---------------------------------------------------------------------------
# The refusal that matters most
# ---------------------------------------------------------------------------
def test_no_configured_secret_refuses_rather_than_admitting_everything():
    body = b'{"id":"evt_1","type":"payment_intent.succeeded","data":{"object":{"id":"pi_1"}}}'
    for provider in pay.PROVIDERS:
        with pytest.raises(pay.WebhookRejected):
            pay.verify(provider, body, {"stripe-signature": "t=1,v1=x"}, "")


# ---------------------------------------------------------------------------
# Over HTTP: the door, and the redelivery
# ---------------------------------------------------------------------------
async def _staff(client) -> tuple[dict, str]:
    # `mission-` identities: see the note in test_margin_guard for why not `pytest-`.
    email = "mission-" + uuid.uuid4().hex + "@test.rfo"
    _, pw = await bootstrap(email, "admin")
    r = await client.post("/staff/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["access_token"]}, email


async def _drop_staff(email: str) -> None:
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("DELETE FROM refresh_tokens WHERE identity_id IN "
                             "(SELECT id FROM staff_users WHERE email = :e)"), {"e": email})
        await c.execute(text("DELETE FROM staff_users WHERE email = :e"), {"e": email})


async def _purge_order(public_id: str) -> None:
    eng = get_engine()
    async with eng.begin() as c:
        for table in ("order_tax_lines", "payments", "order_lines"):
            await c.execute(text(f"DELETE FROM {table} WHERE order_id IN "
                                 "(SELECT id FROM orders WHERE public_id = :o)"), {"o": public_id})
        await c.execute(text("DELETE FROM orders WHERE public_id = :o"), {"o": public_id})


async def _one(sql: str, **params):
    eng = get_engine()
    async with eng.begin() as c:
        return (await c.execute(text(sql), params)).mappings().first()


async def _pending_order(client, h: dict, tag: str) -> dict:
    """A pending order with one reserved unit, built through the public doors."""
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("INSERT INTO brands (name, slug) VALUES (:n, :n)"
                             " ON CONFLICT (slug) DO NOTHING"), {"n": "mission-pay-brand"})
        await c.execute(text("INSERT INTO categories (name, slug) VALUES (:n, :n)"
                             " ON CONFLICT (slug) DO NOTHING"), {"n": "mission-pay-category"})
    r = await client.post("/staff/products", headers=h, json={
        "brand_slug": "mission-pay-brand", "category_slug": "mission-pay-category",
        "model": "Model " + tag[-6:], "title": tag + " pay", "slug": tag.lower() + "-pay"})
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    r = await client.post("/staff/lots", headers=h, json={"lot_number": tag + "-LOT", "warehouse": "WH-T"})
    lot_id, lot_number = r.json()["id"], r.json()["lot_number"]
    r = await client.post("/staff/assets/scan-in", headers=h,
                          json={"lot_number": lot_number, "serial_number": tag + "-S1", "product_id": pid})
    aid = r.json()["id"]
    await client.post(f"/staff/assets/{aid}/grade", headers=h,
                      json={"grade": "A", "cost_cents": 15000, "test_first": True})
    await client.post(f"/staff/assets/{aid}/price", headers=h, json={"sale_price_cents": 25000})
    await client.post(f"/staff/lots/{lot_id}/activate", headers=h)
    await client.post(f"/staff/assets/{aid}/status", headers=h, json={"status": "listed"})
    r = await client.post("/store/checkout", json={"asset_ids": [aid], "shipping_country": "AU"})
    assert r.status_code == 200, r.text
    public_id = r.json()["order_public_id"]
    row = await _one("SELECT id FROM orders WHERE public_id = :o", o=public_id)
    return {"order_public_id": public_id, "order_id": row["id"], "asset_id": aid, "product_id": pid}


async def _archive(pid: int) -> None:
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("UPDATE products SET status = 'archived' WHERE id = :i"), {"i": pid})


async def _stub_webhook(client, ref: str, event: str) -> tuple[int, dict]:
    s = get_settings()
    body = json.dumps({"ref": ref, "event": event})
    sig = hmac.new(s.PAYMENT_WEBHOOK_SECRET.encode(), body.encode(), hashlib.sha256).hexdigest()
    r = await client.post("/store/webhooks/payments/stub", content=body,
                          headers={"Content-Type": "application/json", "x-stub-signature": sig})
    return r.status_code, r.json()


async def test_an_unsigned_or_unknown_provider_webhook_is_refused(client):
    r = await client.post("/store/webhooks/payments/stub", content=b'{"ref":"x","event":"payment.succeeded"}',
                          headers={"Content-Type": "application/json"})
    assert r.status_code == 401, r.text
    r = await client.post("/store/webhooks/payments/notaprovider", content=b"{}",
                          headers={"Content-Type": "application/json"})
    assert r.status_code == 404, r.text


async def test_a_redelivered_succeeded_event_lands_once(client):
    """The property the whole event log exists for: replaying a delivery must not double-sell."""
    h, email = await _staff(client)
    tag = "missionPay" + uuid.uuid4().hex[:10]
    fixture = None
    try:
        fixture = await _pending_order(client, h, tag)
        rid = fixture["order_id"]
        ref = (await client.post(f"/store/orders/{fixture['order_public_id']}/pay")).json()["payment_ref"]

        first = await _stub_webhook(client, ref, "payment.succeeded")
        second = await _stub_webhook(client, ref, "payment.succeeded")
        assert first[0] == 200 and first[1]["status"] == "processed", first
        assert second[0] == 200 and second[1]["status"] == "already processed", second

        moves = await _one("SELECT count(*) AS n FROM stock_movements WHERE asset_id = :i AND qty = -1",
                           i=fixture["asset_id"])
        assert moves["n"] == 1, dict(moves)
        events = await _one("SELECT count(*) AS n FROM payment_events WHERE order_id = :i", i=rid)
        assert events["n"] == 1, "one delivery, one event row: " + str(dict(events))
    finally:
        if fixture:
            await _purge_order(fixture["order_public_id"])
            await _archive(fixture["product_id"])
        await _drop_staff(email)


async def test_a_signed_stripe_webhook_moves_the_order_all_the_way_to_paid(client):
    """The real provider path, end to end: a Stripe-shaped event, verified, settling an order.

    The signing secret is stored through the Settings API's own table under `<provider>.webhook`, so
    this also proves the lookup that production would use - and it is restored afterwards, because
    the settings row is global.
    """
    h, email = await _staff(client)
    tag = "missionPay" + uuid.uuid4().hex[:10]
    fixture, original = None, None
    eng = get_engine()
    try:
        fixture = await _pending_order(client, h, tag)
        async with eng.begin() as c:
            row = (await c.execute(text("SELECT value FROM site_settings WHERE key = 'api_keys'"))).first()
            original = row[0] if row is not None else None
        r = await client.post("/staff/settings/api-keys", headers=h, json={
            "provider": "stripe.webhook", "label": "Stripe webhooks", "secret": STRIPE_SECRET})
        assert r.status_code == 201, r.text

        # A Stripe payment row for this order, then the provider's own event for it.
        ref = "pi_" + uuid.uuid4().hex[:12]
        async with eng.begin() as c:
            await c.execute(text(
                "INSERT INTO payments (order_id, provider, provider_ref, idempotency_key,"
                " amount_cents, status) VALUES (:o, 'stripe', :r, :k,"
                " (SELECT total_cents FROM orders WHERE id = :o), 'initiated')"),
                {"o": fixture["order_id"], "r": ref, "k": "mission-" + uuid.uuid4().hex})

        body = json.dumps({"id": "evt_" + uuid.uuid4().hex[:8], "type": "payment_intent.succeeded",
                           "data": {"object": {"id": ref, "amount_received": 25000}}}).encode()
        sig = _stripe_sig(body, STRIPE_SECRET)
        r = await client.post("/store/webhooks/payments/stripe", content=body,
                              headers={"Content-Type": "application/json", "stripe-signature": sig})
        assert r.status_code == 200 and r.json()["order"] == "paid", r.text
        assert (await _one("SELECT status FROM orders WHERE id = :i",
                           i=fixture["order_id"]))["status"] == "paid"
        assert (await _one("SELECT status FROM assets WHERE id = :i",
                           i=fixture["asset_id"]))["status"] == "sold"
    finally:
        if fixture:
            await _purge_order(fixture["order_public_id"])
            await _archive(fixture["product_id"])
        async with eng.begin() as c:
            if original is None:
                await c.execute(text("DELETE FROM site_settings WHERE key = 'api_keys'"))
            else:
                await c.execute(text("UPDATE site_settings SET value = CAST(:v AS jsonb)"
                                     " WHERE key = 'api_keys'"), {"v": json.dumps(original)})
        await _drop_staff(email)
