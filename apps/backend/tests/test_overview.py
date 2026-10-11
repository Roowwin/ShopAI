"""GET /staff/overview - the dashboard's one read door, asserted against the DB it reports on.

Two things this file exists to catch, and neither is a status code:

* the door's role gate (a sales staff token can price units but must not read the overview), and
* DISAGREEMENT with the database. A dashboard that reports a number its own DB does not have is
  the failure this endpoint can only make once - so `inventory.total_units` and every
  by_status count are compared to a direct SELECT rather than to a literal that would rot the
  moment someone scans a unit in.

Hermetic, like its siblings: owns its identities (bootstrap + login, removed in a finally) and
creates no stock - the read is a read, so the counts it asserts cannot be moved by this file.
"""
import uuid

from sqlalchemy import text

from app.bootstrap_staff import bootstrap
from app.core.db import get_engine

TOP_KEYS = {"generated_at", "inventory", "lots", "stock_value", "reservations", "orders",
            "newsletter", "audit_feed", "needs_attention"}
INVENTORY_KEYS = {"by_status", "by_grade", "total_units"}
STOCK_VALUE_KEYS = {"at_cost_cents", "at_list_cents", "listed_units", "cost_known_units"}
RESERVATION_KEYS = {"active", "expiring_24h"}
ORDER_KEYS = {"by_state", "revenue_paid_cents_30d", "orders_30d", "aov_cents"}
ATTENTION_KINDS = ["intake_waiting", "restock", "reservations_expiring", "in_repair_stale"]


def _h(tok: str) -> dict:
    return {"Authorization": "Bearer " + tok}


async def _cleanup():
    eng = get_engine()
    async with eng.begin() as c:
        await c.execute(text("DELETE FROM refresh_tokens WHERE identity_id IN "
                             "(SELECT id FROM staff_users WHERE email LIKE 'pytest-%')"))
        await c.execute(text("DELETE FROM refresh_tokens WHERE identity_id IN "
                             "(SELECT id FROM users WHERE email LIKE 'pytest-%')"))
        await c.execute(text("DELETE FROM staff_users WHERE email LIKE 'pytest-%'"))
        await c.execute(text("DELETE FROM users WHERE email LIKE 'pytest-%'"))


async def _staff(client, role: str = "admin") -> str:
    email = "pytest-" + uuid.uuid4().hex + "@test.rfo"
    sid, pw = await bootstrap(email, role)
    r = await client.post("/staff/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


async def test_overview_door_is_role_gated(client):
    """No credential -> 401; a sales staff token -> 403; an admin -> 200.

    Sales is the sharp edge: it is a real staff role that writes prices, so 403 here (not 401)
    proves the gate is the ROLE gate and not merely "is there a staff token".
    """
    await _cleanup()
    try:
        r = await client.get("/staff/overview")
        assert r.status_code == 401, r.text
        h = _h(await _staff(client, "sales"))
        r = await client.get("/staff/overview", headers=h)
        assert r.status_code == 403, r.text
        h = _h(await _staff(client, "admin"))
        r = await client.get("/staff/overview", headers=h)
        assert r.status_code == 200, r.text
    finally:
        await _cleanup()


async def test_overview_shape_and_counts_agree_with_the_database(client):
    """The payload's keys, its ordered needs_attention kinds, and its counts - against the DB.

    Every count asserted here comes from a SELECT run in this test, so the claim is "the endpoint
    and the database agree", not "the endpoint returned the number that was hard-coded when this
    test was written".
    """
    await _cleanup()
    try:
        h = _h(await _staff(client, "admin"))
        r = await client.get("/staff/overview", headers=h)
        assert r.status_code == 200, r.text
        j = r.json()

        assert TOP_KEYS <= set(j), sorted(j)
        assert INVENTORY_KEYS <= set(j["inventory"]), j["inventory"]
        assert STOCK_VALUE_KEYS <= set(j["stock_value"]), j["stock_value"]
        assert RESERVATION_KEYS <= set(j["reservations"]), j["reservations"]
        assert ORDER_KEYS <= set(j["orders"]), j["orders"]
        assert "by_status" in j["lots"] and "total" in j["newsletter"]
        assert isinstance(j["audit_feed"], list) and len(j["audit_feed"]) <= 20
        assert [a["kind"] for a in j["needs_attention"]] == ATTENTION_KINDS, j["needs_attention"]

        eng = get_engine()
        async with eng.begin() as c:
            total = (await c.execute(text("SELECT count(*) FROM assets"))).scalar_one()
            grouped = dict((await c.execute(
                text("SELECT status, count(*) FROM assets GROUP BY status"))).all())
            newsletter = (await c.execute(
                text("SELECT count(*) FROM newsletter_subscribers"))).scalar_one()

        # the headline number, against a direct count of the table it summarises
        assert j["inventory"]["total_units"] == total, (j["inventory"]["total_units"], total)
        # ... and the breakdown is that same read, not a filler: every status the DB reports is
        # present with the DB's count, and the zero-filled states contribute nothing.
        for status, n in grouped.items():
            assert j["inventory"]["by_status"].get(status) == n, (status, n, j["inventory"]["by_status"])
        assert sum(j["inventory"]["by_status"].values()) == total
        assert j["newsletter"]["total"] == newsletter

        # money is cents and non-negative; the AOV is the paid revenue over the 30-day count
        o = j["orders"]
        assert o["revenue_paid_cents_30d"] >= 0 and o["orders_30d"] >= 0 and o["aov_cents"] >= 0
        assert o["aov_cents"] == (round(o["revenue_paid_cents_30d"] / o["orders_30d"])
                                  if o["orders_30d"] else 0)
    finally:
        await _cleanup()
