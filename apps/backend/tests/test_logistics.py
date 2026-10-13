"""Logistics: the alert feed, carrier performance, and reconciling a bank credit.

TWO LAYERS, as in the pricing suite, because they claim different things. The first half is pure:
`services/logistics.py` takes rows and returns structures, so the thresholds, the sample floor and
the match scoring are asserted as arithmetic at their own boundaries (day 2 vs day 3, three delivered
parcels vs two, an exact total vs a near miss). The second half drives the REAL doors, because the
interesting failures there are not arithmetic - they are whether shipping twice is refused, whether
a mismatch is stopped before it moves money, and whether the walls hold.

NO ORDER IS EVER FABRICATED BY SQL. Every order, payment and shipment below is produced through the
storefront's own checkout and the staff doors, so the tests cannot pass against a shape the app
could not actually create. The one exception is deliberate and named where it happens: the alert
test BACKDATES a payment to age an order, because "three days ago" cannot be waited for in a test.
"""

import uuid
from datetime import date

from sqlalchemy import text

from app.api.v1 import staff_logistics
from app.bootstrap_staff import bootstrap
from app.core.db import get_engine
from app.services import logistics as lg


# ===========================================================================
# The engines, on their own.
# ===========================================================================

def _row(**over) -> dict:
    """One order as the alert scan hands it over: facts only, no judgements."""
    base = {"order_id": 501, "status": "paid", "days_since_placed": 6, "days_since_paid": 6,
            "total_cents": 27900, "shipment": None, "unmatched_paid_cents": 0}
    base.update(over)
    return base


def _moving(carrier="ShipFast", dispatched=1, promised=None) -> dict:
    return {"carrier": carrier, "dispatched_days_ago": dispatched, "promised_days_ago": promised,
            "delivered": False, "delivered_days_ago": None}


def test_paid_and_unshipped_is_critical_on_the_published_day():
    """The brief's own example: an order paid for and not posted."""
    assert lg.order_alerts([_row(days_since_paid=lg.OVERDUE_SHIP_DAYS - 1)]) == [], \
        "the day before the threshold is not overdue"

    found = lg.order_alerts([_row(days_since_paid=lg.OVERDUE_SHIP_DAYS)])
    assert len(found) == 1
    a = found[0]
    assert (a.kind, a.severity, a.order_id) == ("paid_not_shipped", "critical", 501)
    assert a.message == "Order #501 has been paid for 3 days and has not shipped.", a.message


def test_a_parcel_past_its_promise_is_one_alert_not_two():
    """A late parcel that is ALSO long in transit is one problem; the promise is the actionable one."""
    found = lg.order_alerts([_row(status="shipped",
                                 shipment=_moving(dispatched=12, promised=4))])
    assert [a.kind for a in found] == ["promise_slipped"], found
    assert "ShipFast" in found[0].message and "4 days" in found[0].message


def test_a_parcel_with_no_promise_falls_to_the_transit_rule():
    """No promise date means the promise rule cannot fire, so the transit rule is the only backstop."""
    assert lg.order_alerts([_row(status="shipped", shipment=_moving(dispatched=lg.STALE_TRANSIT_DAYS - 1))]) == []
    found = lg.order_alerts([_row(status="shipped", shipment=_moving(dispatched=lg.STALE_TRANSIT_DAYS))])
    assert [a.kind for a in found] == ["stale_transit"]
    assert "no delivery scan" in found[0].message


def test_delivered_money_that_is_unreconciled_is_flagged_after_the_grace():
    delivered = lambda days: {"carrier": "ShipFast", "dispatched_days_ago": 6,
                              "promised_days_ago": -2, "delivered": True,
                              "delivered_days_ago": days}
    assert lg.order_alerts([_row(status="delivered", shipment=delivered(lg.UNRECONCILED_DAYS - 1),
                                 unmatched_paid_cents=27900)]) == [], \
        "a card settlement lands after the delivery scan; that lag is not an alert"

    found = lg.order_alerts([_row(status="delivered", shipment=delivered(lg.UNRECONCILED_DAYS),
                                  unmatched_paid_cents=27900)])
    assert [a.kind for a in found] == ["delivered_unreconciled"]
    assert found[0].amount_cents == 27900 and "$279.00" in found[0].message

    # And the same order with its money reconciled says nothing at all.
    assert lg.order_alerts([_row(status="delivered", shipment=delivered(9), unmatched_paid_cents=0)]) == []


def test_an_unpaid_order_is_flagged_only_after_the_abandoned_window():
    assert lg.order_alerts([_row(status="pending", days_since_paid=None,
                                 days_since_placed=lg.ABANDONED_DAYS - 1)]) == []
    found = lg.order_alerts([_row(status="pending", days_since_paid=None,
                                  days_since_placed=lg.ABANDONED_DAYS)])
    assert [a.kind for a in found] == ["never_paid"]
    assert "never paid" in found[0].message


def test_the_feed_is_ordered_critical_first_then_the_longest_standing():
    found = lg.order_alerts([
        _row(order_id=1, status="pending", days_since_paid=None, days_since_placed=30),
        _row(order_id=2, days_since_paid=4),
        _row(order_id=3, days_since_paid=9),
    ])
    assert [a.order_id for a in found] == [3, 2, 1], "critical by age, then the warning"
    assert lg.alert_counts(found) == {"total": 3, "critical": 2, "warning": 1,
                                      "by_kind": {"paid_not_shipped": 2, "promise_slipped": 0,
                                                  "stale_transit": 0, "delivered_unreconciled": 0,
                                                  "never_paid": 1}}


def _ship(carrier, cost, delivered, transit=None, on_time=None, days_ago=1) -> dict:
    return {"carrier": carrier, "cost_cents": cost, "delivered": delivered,
            "dispatched_days_ago": days_ago, "transit_days": transit, "on_time": on_time}


def _three(carrier, cost, transit) -> list[dict]:
    return [_ship(carrier, cost, True, transit, True) for _ in range(lg.MIN_CARRIER_SAMPLE)]


def test_carrier_averages_count_delivered_parcels_only():
    stats = lg.carrier_stats([
        _ship("Fast", 2000, True, 2.0, True),
        _ship("Fast", 2000, True, 4.0, True),
        _ship("Fast", 2000, False),          # still moving: volume, but not a transit time
    ])
    s = stats[0]
    assert (s.carrier, s.shipments, s.delivered, s.in_transit) == ("Fast", 3, 2, 1)
    assert s.avg_transit_days == 3.0, "the average is over DELIVERED parcels, not all of them"
    assert s.avg_cost_cents == 2000 and s.on_time_pct == 100.0


def test_on_time_is_unknown_until_a_carrier_quotes_a_promise():
    s = lg.carrier_stats([_ship("Quiet", 900, True, 3.0, None)])[0]
    assert s.on_time_pct is None, "no promise recorded is not a perfect record"


def test_a_thin_carrier_is_listed_but_never_recommended():
    stats = lg.carrier_stats(_three("Old", 3000, 5.0) + [_ship("New", 100, True, 1.0, True)])
    by_name = {s.carrier: s for s in stats}
    assert by_name["New"].thin is True and by_name["Old"].thin is False
    assert lg.recommend_carrier(stats, preference="fastest")["carrier"] == "Old"


def test_the_recommendation_refuses_rather_than_pick_from_too_little():
    rec = lg.recommend_carrier(lg.carrier_stats([_ship("Only", 100, True, 1.0, True)]))
    assert rec["carrier"] is None and rec["eligible"] == 0
    assert str(lg.MIN_CARRIER_SAMPLE) in rec["note"], rec["note"]


def test_fastest_cheapest_and_balanced_name_different_carriers_from_measured_numbers():
    stats = lg.carrier_stats(_three("Swift", 5000, 1.0) + _three("Middle", 2000, 2.0)
                             + _three("Saver", 1000, 6.0))
    assert lg.recommend_carrier(stats, preference="fastest")["carrier"] == "Swift"
    assert lg.recommend_carrier(stats, preference="cheapest")["carrier"] == "Saver"
    # 1/1 + 5000/1000 = 6.0 for Swift, 2/1 + 2000/1000 = 4.0 for Middle, 7.0 for Saver.
    balanced = lg.recommend_carrier(stats, preference="balanced")
    assert balanced["carrier"] == "Middle", balanced
    assert balanced["fastest"]["carrier"] == "Swift" and balanced["cheapest"]["carrier"] == "Saver"


PAYOUT = {"amount_cents": 27900, "received_on": date(2026, 10, 8), "bank_ref": "BANKREF-1"}


def _pay(pid, oid, amount, paid_on, ref=None, status="succeeded") -> dict:
    return {"payment_id": pid, "order_id": oid, "amount_cents": amount, "status": status,
            "paid_on": paid_on, "provider_ref": ref}


def test_the_exact_amount_match_leads_and_shows_its_working():
    found = lg.match_payout(PAYOUT, [_pay(7, 501, 27900, date(2026, 10, 5))])
    assert len(found) == 1
    m = found[0]
    assert (m.payment_ids, m.order_ids, m.total_cents) == ([7], [501], 27900)
    assert m.score == 80, "60 for the exact amount, 20 for dates three days apart"
    assert m.confidence == lg.CONFIDENCE_LIKELY
    assert any("exactly" in r for r in m.reasons) and any("3 day" in r for r in m.reasons), m.reasons


def test_the_banks_reference_naming_the_order_is_the_strongest_signal():
    found = lg.match_payout({"amount_cents": 27900, "received_on": date(2026, 10, 8),
                             "bank_ref": "DEP 501 SETTLE"},
                            [_pay(7, 501, 27900, date(2026, 10, 5))])
    assert found[0].score == 100 and found[0].confidence == lg.CONFIDENCE_STRONG


def test_a_payment_dated_after_the_credit_is_contradicted_not_quietly_ranked_low():
    found = lg.match_payout(PAYOUT, [_pay(7, 501, 27900, date(2026, 10, 12))])
    assert found[0].score == 60, "no date bonus: the statement cannot settle money taken after it"
    assert any("AFTER the credit" in r for r in found[0].reasons), found[0].reasons


def test_a_basket_that_sums_exactly_is_offered_but_scored_below_a_single():
    found = lg.match_payout(PAYOUT, [_pay(1, 11, 20000, date(2026, 10, 5)),
                                     _pay(2, 12, 7900, date(2026, 10, 6))])
    basket = found[0]
    assert basket.payment_ids == [1, 2] and basket.total_cents == 27900
    assert basket.score < 60 and basket.confidence == lg.CONFIDENCE_POSSIBLE
    assert any("add up to the credit exactly" in r for r in basket.reasons)


def test_only_exact_totals_are_offered():
    assert lg.match_payout(PAYOUT, [_pay(1, 11, 27899, date(2026, 10, 5))]) == [], \
        "a near miss is a different order or a fee that needs its own line, never a match"


def test_a_failed_payment_is_offered_but_flagged_and_scored_down():
    found = lg.match_payout(PAYOUT, [_pay(1, 11, 27900, date(2026, 10, 5), status="failed")])
    assert found[0].score == 65, "60 + 20 dates - 15 for not being a completed payment"
    assert any("not a completed one" in r for r in found[0].reasons)


def test_a_single_payment_always_outranks_a_basket_of_the_same_total():
    found = lg.match_payout(PAYOUT, [_pay(9, 99, 27900, date(2026, 10, 7)),
                                     _pay(1, 11, 20000, date(2026, 10, 7)),
                                     _pay(2, 12, 7900, date(2026, 10, 7))])
    assert found[0].payment_ids == [9], found
    assert found[0].score > found[1].score


# ===========================================================================
# The doors.
# ===========================================================================

def _h(tok: str) -> dict:
    return {"Authorization": "Bearer " + tok}


def _tag() -> str:
    return "pytest-log-" + uuid.uuid4().hex[:10]


async def _staff(client, role: str) -> tuple[str, str]:
    email = "pytest-" + uuid.uuid4().hex + "@test.rfo"
    sid, pw = await bootstrap(email, role)
    r = await client.post("/staff/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return r.json()["access_token"], email


async def _cleanup_identity(email: str):
    """Only this test's identity - NOT the `LIKE 'pytest-%'` sweep the older suites use, which
    deletes the identities of suites running CONCURRENTLY in this shared dev database."""
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("DELETE FROM refresh_tokens WHERE identity_id IN"
                             " (SELECT id FROM staff_users WHERE email = :e)"), {"e": email})
        await c.execute(text("DELETE FROM staff_users WHERE email = :e"), {"e": email})
        await c.execute(text("DELETE FROM users WHERE email = :e"), {"e": email})


async def _purge(tag: str):
    """Remove what this suite created that the app role may remove.

    Shipments and payouts were given DELETE by default privileges, so they go - along with the
    `payout_matches` rows that cascade from a payout. The orders, payments and units stay: the sale
    wrote a -1 to `stock_movements`, which is INSERT+SELECT only BY GRANT, and its foreign key then
    pins the asset (the same concession `test_intake` and `test_product_import` record). They are
    tagged and invisible: the units are `shipped`, not `listed`, so no shop page can show them.
    """
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text(
            "DELETE FROM shipments WHERE order_id IN (SELECT ol.order_id FROM order_lines ol"
            " JOIN assets a ON a.id = ol.asset_id WHERE a.serial_number::text LIKE :p)"),
            {"p": tag + "%"})
        await c.execute(text("DELETE FROM payouts WHERE bank_ref LIKE :p"), {"p": tag + "%"})
        await c.execute(text(
            "DELETE FROM products WHERE slug LIKE :p AND NOT EXISTS"
            " (SELECT 1 FROM assets a WHERE a.product_id = products.id)"), {"p": tag + "%"})
        await c.execute(text(
            "DELETE FROM lots WHERE lot_number LIKE :p AND NOT EXISTS"
            " (SELECT 1 FROM assets a WHERE a.lot_id = lots.id)"), {"p": tag + "%"})


async def _paid_order(client, tok, tag: str, *, price=27900) -> dict:
    """One paid order, built entirely through the real doors: lot -> unit -> listed -> checkout.

    Nothing here is inserted with SQL. The point is that the tests cannot pass against an order
    shape the application could not have produced - and the alert/reconciliation doors read exactly
    the rows the checkout wrote.

    Both the lot number and the serial carry the test's tag, which is what makes `_purge` able to
    find them again: a lot the API numbers for itself would be untraceable, and the asset it holds
    is pinned by the ledger and cannot be deleted at all.
    """
    r = await client.post("/staff/lots", json={"lot_number": tag + "-LOT-" + uuid.uuid4().hex[:6], "notes": "pytest-logistics"},
                          headers=_h(tok))
    assert r.status_code == 201, r.text
    ln, lot_id = r.json()["lot_number"], r.json()["id"]
    await client.post(f"/staff/lots/{lot_id}/activate", headers=_h(tok))

    serial = tag + "-" + uuid.uuid4().hex[:8]
    r = await client.post("/staff/assets/scan-in",
                          json={"lot_number": ln, "serial_number": serial}, headers=_h(tok))
    assert r.status_code == 201, r.text
    aid = r.json()["id"]
    assert (await client.post(f"/staff/assets/{aid}/status", json={"status": "tested"},
                              headers=_h(tok))).status_code == 200
    assert (await client.post(f"/staff/assets/{aid}/grade",
                              json={"grade": "A", "cost_cents": 15000}, headers=_h(tok))).status_code == 200
    assert (await client.post(f"/staff/assets/{aid}/price", json={"sale_price_cents": price},
                              headers=_h(tok))).status_code == 200
    assert (await client.post(f"/staff/assets/{aid}/status", json={"status": "listed"},
                              headers=_h(tok))).status_code == 200

    r = await client.post("/store/checkout", json={
        "asset_ids": [aid], "shipping_country": "AU", "ship_to_name": "Pytest",
        "ship_line1": "1 Test St", "ship_city": "Sydney", "ship_postcode": "2000"})
    assert r.status_code == 200, r.text
    pub = r.json()["order_public_id"]
    # `pay` is what creates the payment row; `simulate-payment` is the dev stand-in for the provider
    # webhook that completes it. Both are the storefront's own doors, in the order a shopper walks
    # them.
    assert (await client.post(f"/store/orders/{pub}/pay")).status_code == 200
    assert (await client.post(f"/store/orders/{pub}/simulate-payment")).status_code == 200

    eng = get_engine()
    async with eng.begin() as c:
        row = (await c.execute(text("""
            SELECT o.id AS order_id, o.total_cents, p.id AS payment_id, p.amount_cents
            FROM orders o JOIN payments p ON p.order_id = o.id
            WHERE o.public_id = :p AND p.status = 'succeeded' ORDER BY p.id LIMIT 1
        """), {"p": pub})).mappings().first()
    return {"order_id": int(row["order_id"]), "payment_id": int(row["payment_id"]),
            "amount_cents": int(row["amount_cents"]), "asset_id": aid, "public_id": pub}


async def _pending_order(client, tok, tag: str) -> str:
    """An order taken to checkout and never paid - the shape the ship door must refuse."""
    r = await client.post("/staff/lots", json={"lot_number": tag + "-LOT-" + uuid.uuid4().hex[:6], "notes": "pytest-logistics"},
                          headers=_h(tok))
    ln, lot_id = r.json()["lot_number"], r.json()["id"]
    await client.post(f"/staff/lots/{lot_id}/activate", headers=_h(tok))
    aid = (await client.post("/staff/assets/scan-in",
                             json={"lot_number": ln,
                                   "serial_number": tag + "-" + uuid.uuid4().hex[:8]},
                             headers=_h(tok))).json()["id"]
    await client.post(f"/staff/assets/{aid}/status", json={"status": "tested"}, headers=_h(tok))
    await client.post(f"/staff/assets/{aid}/grade", json={"grade": "A", "cost_cents": 1000}, headers=_h(tok))
    await client.post(f"/staff/assets/{aid}/price", json={"sale_price_cents": 5000}, headers=_h(tok))
    await client.post(f"/staff/assets/{aid}/status", json={"status": "listed"}, headers=_h(tok))
    r = await client.post("/store/checkout", json={
        "asset_ids": [aid], "shipping_country": "AU", "ship_to_name": "Pytest",
        "ship_line1": "1 Test St", "ship_city": "Sydney", "ship_postcode": "2000"})
    assert r.status_code == 200, r.text
    return r.json()["order_public_id"]


async def test_shipping_a_paid_order_records_the_parcel_and_moves_the_order_and_its_unit(client):
    """The write that did not exist: paid -> shipped, for the order AND for the unit.

    Setup takes a manager token and the shipment takes a WAREHOUSE one, because that is the real
    handoff: warehouse cannot price a unit, and the person who packs it is not the person who listed
    it. A suite that did both as an admin would never notice if the ship door had been left on the
    wrong role tuple.
    """
    mgr, mgr_email = await _staff(client, "manager")
    wh, wh_email = await _staff(client, "warehouse")
    tag = _tag()
    try:
        order = await _paid_order(client, mgr, tag)
        r = await client.post(f"/staff/logistics/orders/{order['order_id']}/ship", headers=_h(wh),
                              json={"carrier": "ShipFast", "service": "Express", "cost_cents": 1295,
                                    "promised_days": 2, "tracking_ref": "SF-" + tag})
        assert r.status_code == 201, r.text
        out = r.json()
        assert out["order_status"] == "shipped" and out["carrier"] == "ShipFast"
        assert out["cost_cents"] == 1295 and out["promised_at"] is not None
        assert out["units_shipped"] == 1 and out["delivered_at"] is None

        eng = get_engine()
        async with eng.begin() as c:
            o = (await c.execute(text("SELECT status FROM orders WHERE id = :i"),
                                 {"i": order["order_id"]})).scalar_one()
            a = (await c.execute(text("SELECT status FROM assets WHERE id = :i"),
                                 {"i": order["asset_id"]})).scalar_one()
            trail = (await c.execute(text(
                "SELECT count(*) FROM audit_log WHERE entity = 'order' AND entity_id = :i"
                " AND action = 'order_shipped'"), {"i": order["order_id"]})).scalar_one()
        assert o == "shipped" and a == "shipped", "the order and its unit both moved"
        assert trail == 1, "the shipment is on the audit trail"
    finally:
        await _purge(tag)
        await _cleanup_identity(mgr_email)
        await _cleanup_identity(wh_email)


async def test_the_ship_door_refuses_an_unpaid_order_and_a_second_parcel(client):
    tok, email = await _staff(client, "manager")
    tag = _tag()
    try:
        pending = await _pending_order(client, tok, tag)
        order_id = (await _id_of(pending))
        r = await client.post(f"/staff/logistics/orders/{order_id}/ship", headers=_h(tok),
                              json={"carrier": "ShipFast"})
        assert r.status_code == 409 and "only a paid order" in r.json()["detail"], r.text

        order = await _paid_order(client, tok, tag)
        body = {"carrier": "ShipFast"}
        assert (await client.post(f"/staff/logistics/orders/{order['order_id']}/ship", headers=_h(tok),
                                  json=body)).status_code == 201
        again = await client.post(f"/staff/logistics/orders/{order['order_id']}/ship", headers=_h(tok),
                                  json=body)
        assert again.status_code == 409, "one parcel per order, and the refusal says why"
        assert "shipped" in again.json()["detail"], again.text
    finally:
        await _purge(tag)
        await _cleanup_identity(email)


async def _id_of(public_id: str) -> int:
    eng = get_engine()
    async with eng.begin() as c:
        return int((await c.execute(text("SELECT id FROM orders WHERE public_id = :p"),
                                    {"p": public_id})).scalar_one())


async def test_the_delivery_scan_closes_the_order_and_leaves_the_units_on_shipped(client):
    """The asset ladder ends at `shipped`; reaching for a rung that does not exist is not an option."""
    mgr, mgr_email = await _staff(client, "manager")
    wh, wh_email = await _staff(client, "warehouse")
    tag = _tag()
    try:
        order = await _paid_order(client, mgr, tag)
        ship = await client.post(f"/staff/logistics/orders/{order['order_id']}/ship",
                                 headers=_h(wh), json={"carrier": "ShipFast"})
        shipment_id = ship.json()["shipment_id"]

        r = await client.post(f"/staff/logistics/shipments/{shipment_id}/deliver", headers=_h(wh))
        assert r.status_code == 200, r.text
        assert r.json()["delivered_at"] is not None and r.json()["order_status"] == "delivered"

        again = await client.post(f"/staff/logistics/shipments/{shipment_id}/deliver", headers=_h(wh))
        assert again.status_code == 409 and "already" in again.json()["detail"]

        eng = get_engine()
        async with eng.begin() as c:
            a = (await c.execute(text("SELECT status FROM assets WHERE id = :i"),
                                 {"i": order["asset_id"]})).scalar_one()
        assert a == "shipped", "there is no delivered rung on the asset ladder"
    finally:
        await _purge(tag)
        await _cleanup_identity(mgr_email)
        await _cleanup_identity(wh_email)


async def test_an_order_left_paid_appears_in_the_alert_feed(client):
    """The brief's sentence, from the real door. The payment is BACKDATED because three days of
    waiting is not something a test can do - and backdating `created_at` is exactly the one SQL
    shortcut this suite takes, named here rather than hidden."""
    tok, email = await _staff(client, "manager")
    tag = _tag()
    try:
        order = await _paid_order(client, tok, tag)
        eng = get_engine()
        async with eng.begin() as c:
            await c.execute(text(
                "UPDATE payments SET created_at = now() - make_interval(days => :d) WHERE id = :i"),
                {"d": lg.OVERDUE_SHIP_DAYS + 1, "i": order["payment_id"]})
            await c.execute(text(
                "UPDATE orders SET placed_at = now() - make_interval(days => :d) WHERE id = :i"),
                {"d": lg.OVERDUE_SHIP_DAYS + 1, "i": order["order_id"]})

        r = await client.get("/staff/logistics/alerts", headers=_h(tok))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["rules"]["overdue_ship_days"] == lg.OVERDUE_SHIP_DAYS
        mine = [a for a in body["alerts"] if a["order_id"] == order["order_id"]]
        assert len(mine) == 1, mine
        assert mine[0]["kind"] == "paid_not_shipped" and mine[0]["severity"] == "critical"
        assert f"Order #{order['order_id']} has been paid for" in mine[0]["message"]
        assert mine[0]["href"].endswith(f"order={order['order_id']}")
        assert body["counts"]["by_kind"]["paid_not_shipped"] >= 1

        # And the alert CLEARS the moment the parcel exists - nothing is stored, so nothing can
        # linger after the problem is gone.
        assert (await client.post(f"/staff/logistics/orders/{order['order_id']}/ship",
                                  headers=_h(tok), json={"carrier": "ShipFast"})).status_code == 201
        after = (await client.get("/staff/logistics/alerts", headers=_h(tok))).json()
        assert [a for a in after["alerts"] if a["order_id"] == order["order_id"]] == []
    finally:
        await _purge(tag)
        await _cleanup_identity(email)


async def test_the_carrier_door_reports_what_the_ship_door_recorded(client):
    tok, email = await _staff(client, "manager")
    tag = _tag()
    try:
        order = await _paid_order(client, tok, tag)
        carrier = "Carrier-" + tag
        ship = await client.post(f"/staff/logistics/orders/{order['order_id']}/ship", headers=_h(tok),
                                 json={"carrier": carrier, "cost_cents": 1500, "promised_days": 1})
        await client.post(f"/staff/logistics/shipments/{ship.json()['shipment_id']}/deliver",
                          headers=_h(tok))

        r = await client.get(f"/staff/logistics/carriers?preference=balanced", headers=_h(tok))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["window_days"] == staff_logistics.CARRIER_WINDOW_DAYS
        mine = [c for c in body["carriers"] if c["carrier"] == carrier]
        assert len(mine) == 1, mine
        c = mine[0]
        assert c["shipments"] == 1 and c["delivered"] == 1 and c["avg_cost_cents"] == 1500
        assert c["thin"] is True, "one parcel is not a performance record"
        # And a brand-new carrier cannot be recommended on the strength of it.
        assert body["recommendation"]["carrier"] != carrier

        bad = await client.get("/staff/logistics/carriers?preference=nope", headers=_h(tok))
        assert bad.status_code == 422, "an unknown preference is refused, not read as balanced"
    finally:
        await _purge(tag)
        await _cleanup_identity(email)


async def test_a_bank_payout_is_recorded_once_however_often_it_is_entered(client):
    tok, email = await _staff(client, "manager")
    tag = _tag()
    try:
        order = await _paid_order(client, tok, tag)
        ref = tag + "-CREDIT"
        body = {"bank_ref": ref, "amount_cents": order["amount_cents"],
                "received_on": date.today().isoformat(), "note": "pytest"}
        r = await client.post("/staff/logistics/payouts", json=body, headers=_h(tok))
        assert r.status_code == 201, r.text
        assert r.json()["settled"] is False and r.json()["unmatched_cents"] == order["amount_cents"]

        again = await client.post("/staff/logistics/payouts", json=body, headers=_h(tok))
        assert again.status_code == 409 and ref in again.json()["detail"], again.text
    finally:
        await _purge(tag)
        await _cleanup_identity(email)


async def test_the_matching_door_offers_the_exact_payment_then_settles_the_credit(client):
    tok, email = await _staff(client, "admin")
    tag = _tag()
    try:
        order = await _paid_order(client, tok, tag)
        ref = tag + "-CREDIT"
        created = await client.post("/staff/logistics/payouts", headers=_h(tok), json={
            "bank_ref": ref, "amount_cents": order["amount_cents"],
            "received_on": date.today().isoformat()})
        payout_id = created.json()["payout_id"]
        # The bank's reference names the order, which is the strongest signal there is.
        await _set_payout_ref(payout_id, f"{tag} ORDER {order['order_id']}")

        r = await client.get(f"/staff/logistics/payouts/{payout_id}/matches", headers=_h(tok))
        assert r.status_code == 200, r.text
        suggestions = r.json()["suggestions"]
        assert suggestions, r.text
        top = suggestions[0]
        assert top["payment_ids"] == [order["payment_id"]]
        assert top["order_ids"] == [order["order_id"]]
        assert top["confidence"] == lg.CONFIDENCE_STRONG, top

        r = await client.post(f"/staff/logistics/payouts/{payout_id}/match", headers=_h(tok),
                              json={"payment_ids": [order["payment_id"]]})
        assert r.status_code == 200, r.text
        assert r.json()["payout"]["settled"] is True
        assert r.json()["payout"]["unmatched_cents"] == 0

        # The payment is now spent: it is no longer offered, and the same match is refused.
        after = (await client.get(f"/staff/logistics/payouts/{payout_id}/matches", headers=_h(tok))).json()
        assert all(order["payment_id"] not in s["payment_ids"] for s in after["suggestions"])
        repeat = await client.post(f"/staff/logistics/payouts/{payout_id}/match", headers=_h(tok),
                                   json={"payment_ids": [order["payment_id"]]})
        assert repeat.status_code == 409 and "already matched" in repeat.json()["detail"], repeat.text

        # And it no longer shows as an unexplained payment on the list door.
        listed = (await client.get("/staff/logistics/payouts", headers=_h(tok))).json()
        mine = [p for p in listed["payouts"] if p["payout_id"] == payout_id]
        assert mine and mine[0]["settled"] is True and mine[0]["matched_payments"] == 1
    finally:
        await _purge(tag)
        await _cleanup_identity(email)


async def _set_payout_ref(payout_id: int, bank_ref: str):
    """Rewrite a payout's reference so the door's own reference-matching can be exercised against a
    known order number. The reference is the bank's, not the app's, so this stands in for the
    statement the operator would be reading."""
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("UPDATE payouts SET bank_ref = :r WHERE id = :i"),
                        {"r": bank_ref, "i": payout_id})


async def test_a_reconciliation_that_does_not_balance_is_refused(client):
    tok, email = await _staff(client, "manager")
    tag = _tag()
    try:
        order = await _paid_order(client, tok, tag)
        created = await client.post("/staff/logistics/payouts", headers=_h(tok), json={
            "bank_ref": tag + "-SHORT", "amount_cents": order["amount_cents"] + 1,
            "received_on": date.today().isoformat()})
        payout_id = created.json()["payout_id"]

        r = await client.post(f"/staff/logistics/payouts/{payout_id}/match", headers=_h(tok),
                              json={"payment_ids": [order["payment_id"]]})
        assert r.status_code == 422, r.text
        detail = r.json()["detail"]
        # Both figures, so a refusal that names the wrong one is caught: the operator is being told
        # which two numbers disagree, and that is the whole content of the message.
        assert "must balance exactly" in detail, detail
        assert f"${order['amount_cents'] / 100:,.2f}" in detail, detail
        assert f"${(order['amount_cents'] + 1) / 100:,.2f}" in detail, detail

        # Nothing was written by the refusal.
        eng = get_engine()
        async with eng.begin() as c:
            n = (await c.execute(text("SELECT count(*) FROM payout_matches WHERE payout_id = :i"),
                                 {"i": payout_id})).scalar_one()
        assert n == 0
    finally:
        await _purge(tag)
        await _cleanup_identity(email)


async def test_matching_a_payment_that_never_completed_is_refused(client):
    tok, email = await _staff(client, "manager")
    tag = _tag()
    try:
        pending = await _pending_order(client, tok, tag)
        order_id = await _id_of(pending)
        # `pay` and then NOT `simulate-payment`: the payment exists and is `initiated`, never
        # completed. This is the row a reconciliation must refuse - money that was never actually
        # taken cannot have settled a bank credit.
        assert (await client.post(f"/store/orders/{pending}/pay")).status_code == 200
        eng = get_engine()
        async with eng.begin() as c:
            pay = (await c.execute(text("SELECT id FROM payments WHERE order_id = :i ORDER BY id LIMIT 1"),
                                   {"i": order_id})).scalar_one()
            amount = (await c.execute(text("SELECT amount_cents FROM payments WHERE id = :i"),
                                      {"i": pay})).scalar_one()
        created = await client.post("/staff/logistics/payouts", headers=_h(tok), json={
            "bank_ref": tag + "-UNPAID", "amount_cents": int(amount),
            "received_on": date.today().isoformat()})
        r = await client.post(f"/staff/logistics/payouts/{created.json()['payout_id']}/match",
                              headers=_h(tok), json={"payment_ids": [int(pay)]})
        assert r.status_code == 409 and "not completed" in r.json()["detail"], r.text
    finally:
        await _purge(tag)
        await _cleanup_identity(email)


async def test_the_logistics_walls_hold(client):
    """Warehouse ships and reads the feed; only admin and manager touch the bank credits."""
    wh, wh_email = await _staff(client, "warehouse")
    tech, tech_email = await _staff(client, "technician")
    try:
        assert (await client.get("/staff/logistics/alerts", headers=_h(wh))).status_code == 200
        assert (await client.get("/staff/logistics/carriers", headers=_h(wh))).status_code == 200

        assert (await client.get("/staff/logistics/payouts", headers=_h(wh))).status_code == 403
        assert (await client.post("/staff/logistics/payouts", headers=_h(wh),
                                  json={"bank_ref": "x", "amount_cents": 1,
                                        "received_on": date.today().isoformat()})).status_code == 403

        for path in ("/staff/logistics/alerts", "/staff/logistics/carriers",
                     "/staff/logistics/payouts"):
            assert (await client.get(path, headers=_h(tech))).status_code == 403, path
            # 401 or 403 for an anonymous caller, depending on which guard answers first - the claim
            # is that it is refused, not which of the two doors said so.
            assert (await client.get(path)).status_code in (401, 403), path

        r = await client.post("/staff/logistics/orders/1/ship", headers=_h(tech),
                              json={"carrier": "ShipFast"})
        assert r.status_code == 403
    finally:
        await _cleanup_identity(wh_email)
        await _cleanup_identity(tech_email)
